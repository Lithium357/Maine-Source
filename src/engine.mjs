import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, readdir, open, copyFile, unlink, appendFile, rm, stat, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { connectors } from './connectors.mjs';
import { sources } from './catalog.mjs';
import { evaluate } from './policy.mjs';
import { HttpClient, redactSecrets } from './http.mjs';
import { materialize } from './content.mjs';
import { defaultTextOutput, validateTextOutput } from './output-options.mjs';
import { ensureFreeSpace, relocateDataset } from './storage.mjs';
import { jobFolder, recordFiles, readRecord, containedFile, inspectForResume } from './datasets.mjs';
import { attachmentPath, renderText, transformText, encodeText } from './text-output.mjs';

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new Error('Invalid recipe');
  if (!String(recipe.name || '').trim()) throw new Error('Give your dataset a name');
  if (!Array.isArray(recipe.sourceIds) || !recipe.sourceIds.length) throw new Error('Select at least one source');
  if (new Set(recipe.sourceIds).size !== recipe.sourceIds.length) throw new Error('Duplicate source selection');
  for (const id of recipe.sourceIds) if (!sources.some(s => s.id === id && !s.planned)) throw new Error(`Unsupported source: ${id}`);
  if (!['off', 'any', 'allowlist'].includes(recipe.licenseMode)) throw new Error('Invalid license policy');
  if (recipe.contentMode !== undefined && !['full', 'metadata'].includes(recipe.contentMode)) throw new Error('Invalid content mode');
  for (const [key, max] of [['maxFileMB', 500], ['maxRecordMB', 1000]]) if (recipe.contentLimits?.[key] !== undefined && (!Number.isFinite(Number(recipe.contentLimits[key])) || Number(recipe.contentLimits[key]) < 1 || Number(recipe.contentLimits[key]) > max)) throw new Error(`Invalid ${key} content limit`);
  if (!Number.isInteger(recipe.strictness) || recipe.strictness < 1 || recipe.strictness > 10) throw new Error('Strictness must be 1–10');
  if (recipe.licenseMode === 'allowlist' && !recipe.allowLicenses?.length) throw new Error('Choose at least one allowed license');
  const limits = recipe.limits || {};
  for (const key of ['minutes', 'megabytes', 'files']) if (!Number.isFinite(Number(limits[key])) || Number(limits[key]) < 0) throw new Error('Limits must be finite, nonnegative numbers');
  if (![limits.minutes, limits.megabytes, limits.files].some(v => Number(v) > 0)) throw new Error('Set at least one stop condition');
  if (limits.files && !Number.isInteger(Number(limits.files))) throw new Error('Document count must be a whole number');
  if (!Number.isFinite(Number(recipe.minLength)) || recipe.minLength < 0) throw new Error('Minimum length must be nonnegative');
  if (recipe.downloadDirectory !== undefined && recipe.downloadDirectory !== '' && (typeof recipe.downloadDirectory !== 'string' || !path.isAbsolute(recipe.downloadDirectory))) throw new Error('Download folder must be absolute');
  if (JSON.stringify(recipe).length > 200000) throw new Error('Recipe is too large');
  return structuredClone(recipe);
}
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, file); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}
export class Collector {
  constructor({ root, onChange = () => {}, getKey = () => '', adapters = connectors, fetcher = fetch, localPaths = [], checkSpace = ensureFreeSpace }) {
    Object.assign(this, { root, onChange, getKey, adapters, fetcher, localPaths, checkSpace });
    this.jobs = []; this.active = null; this.pendingSave = Promise.resolve();
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    try { this.jobs = JSON.parse(await readFile(path.join(this.root, 'jobs.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') { try { this.jobs = JSON.parse(await readFile(path.join(this.root, 'jobs.json.bak'), 'utf8')); } catch { throw new Error('Run history is damaged. Restore jobs.json or jobs.json.bak from backup; existing dataset files have been preserved.'); } } }
    if (!Array.isArray(this.jobs)) throw new Error('Invalid run history');
    for (const job of this.jobs) if (['running', 'paused', 'stopping'].includes(job.status)) { job.status = 'interrupted'; job.reason = 'App closed before this run finished. Resume to continue using saved records.'; job.endedAt = new Date().toISOString(); }
    await this.save();
  }
  save() {
    if (this.active?.sessionStarted) this.active.job.elapsedMs = this.active.elapsedBefore + Date.now() - this.active.sessionStarted;
    const snapshot = structuredClone(this.jobs);
    this.pendingSave = this.pendingSave.catch(() => {}).then(async () => { await atomicJSON(path.join(this.root, 'jobs.json.bak'), snapshot); await atomicJSON(path.join(this.root, 'jobs.json'), snapshot); });
    return this.pendingSave;
  }
  emit() { this.onChange(); }
  log(job, kind, message, source) {
    message = redactSecrets(message, job.recipe.sourceIds.map(id => this.getKey(id)));
    job.events.push({ time: new Date().toISOString(), kind, message, source });
    if (job.events.length > 160) job.events.shift();
    this.emit();
  }
  async begin(fn) {
    if (this.active || this.starting) throw new Error('A collection is already active. Stop it before starting another.');
    this.starting = true; try { return await fn(); } finally { this.starting = false; this.emit(); }
  }
  start(input) { return this.begin(() => this.startNew(input)); }
  async resume(id, limits) {
    if (this.active?.job.id === id && this.active.paused) {
      if (limits) throw new Error('Resume this paused run without changing limits; stop it first to change total budgets');
      this.active.paused = false; this.active.job.status = 'running'; this.active.wake?.();
      await this.save(); this.emit(); return id;
    }
    return this.begin(() => this.resumeSaved(id, limits));
  }
  async folder(id) {
    jobFolder(this.root, id);
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new Error('Dataset not found');
    const parent = job.storageParent || this.root;
    if (job.storageParent && (!path.isAbsolute(parent) || path.relative(path.resolve(parent), await realpath(parent)))) throw new Error('Dataset parent folder has changed or is linked');
    return containedFile(parent, id);
  }
  async moveDataset(id, parent) {
    return this.begin(async () => {
      const job = this.jobs.find(j => j.id === id);
      if (!job) throw new Error('Dataset not found');
      const original = job.storageParent, originalRecipe = job.recipe;
      const moved = await relocateDataset(await this.folder(id), parent, id, this.checkSpace);
      job.storageParent = moved.storageParent; job.recipe = { ...job.recipe, downloadDirectory: moved.storageParent };
      try { await this.save(); } catch (error) { job.storageParent = original; job.recipe = originalRecipe; throw error; }
      this.emit(); return moved.destination;
    });
  }
  async startNew(input) {
    if (this.active) throw new Error('A collection is already active. Stop it before starting another.');
    const recipe = validateRecipe(input);
    const storageParent = recipe.downloadDirectory ? await realpath(recipe.downloadDirectory) : undefined;
    await this.checkSpace(storageParent || this.root);
    const job = { id: randomUUID(), ...(storageParent ? { storageParent } : {}), name: recipe.name, recipe, status: 'running', startedAt: new Date().toISOString(), accepted: 0, rejected: 0, bytes: 0, seen: 0, errors: 0, counts: {}, licenses: {}, outcomes: {}, samples: [], events: [], activity: [], reason: '' };
    const active = { job, controller: new AbortController(), paused: false, paths: [...this.localPaths], elapsedBefore: 0, sessionStarted: Date.now() };
    this.active = active; this.jobs.unshift(job);
    try { const directory = jobFolder(storageParent || this.root, job.id); await mkdir(directory); await mkdir(path.join(directory, 'records')); await this.save(); }
    catch (error) { this.active = null; this.jobs = this.jobs.filter(j => j.id !== job.id); throw error; }
    this.emit();
    this.running = this.run(active).catch(async error => { job.status = 'failed'; job.reason = `Could not save collection state: ${error.message}`; this.active = null; this.emit(); await this.save().catch(() => {}); });
    return job.id;
  }
  async resumeSaved(id, limits) {
    if (this.active) throw new Error('A collection is already active');
    const job = this.jobs.find(j => j.id === id);
    if (!job || !['interrupted', 'stopped', 'failed', 'completed_with_errors'].includes(job.status)) throw new Error('This run cannot be resumed');
    const recipe = validateRecipe({ ...job.recipe, ...(limits ? { limits } : {}) });
    if (recipe.sourceIds.includes('local') && !this.localPaths.length) throw new Error('Reselect the original local files in Settings before resuming');
    jobFolder(this.root, id);
    const root = await this.folder(id);
    // Inspect without changing history counters until the entire saved set passes.
    let report;
    try { report = await inspectForResume(root, { highWater: Math.max(job.lastSequence || 0, job.accepted || 0), onProgress: progress => { job.recoveryProgress = progress; this.emit(); } }); }
    finally { delete job.recoveryProgress; this.emit(); }
    if (recipe.limits.files > 0 && report.accepted >= recipe.limits.files || recipe.limits.megabytes > 0 && report.bytes >= recipe.limits.megabytes * 1048576 || recipe.limits.minutes > 0 && (job.elapsedMs || 0) >= recipe.limits.minutes * 60000) throw new Error('This run reached its limit. Increase the total budget to continue.');
    await this.checkSpace(root);
    if (report.lastSequence >= 99999999) throw new Error('This dataset reached the maximum supported record index');
    const replay = report.gaps.length && JSON.stringify(report.gaps) !== JSON.stringify(job.recoveryGaps || []);
    if (replay) {
      this.log(job, 'warning', `Missing saved record slots detected (${report.gaps.slice(0, 5).map(([a, b]) => a === b ? a : `${a}–${b}`).join(', ')}). Existing records, checkpoints, and processed-item history are preserved. Missing or quarantined items are not automatically restored; new records use indices above ${report.lastSequence}.`);
    }
    job.recoveryGaps = report.gaps;
    Object.assign(job, { accepted: report.accepted, bytes: report.bytes, counts: report.counts, licenses: report.licenses, lastSequence: report.lastSequence });
    const saved = report.saved;
    job.recipe = recipe; job.reason = ''; job.status = 'running'; job.priorErrors = (job.priorErrors || 0) + job.errors; job.errors = 0; delete job.endedAt;
    const active = { job, controller: new AbortController(), paused: false, paths: [...this.localPaths], elapsedBefore: job.elapsedMs || 0, sessionStarted: Date.now(), saved, nextSequence: report.lastSequence + 1 };
    this.active = active; try { await this.save(); } catch (error) { job.status = 'interrupted'; this.active = null; throw error; } this.emit();
    this.running = this.run(active).catch(async error => { job.status = 'failed'; job.reason = `Could not save collection state: ${error.message}`; this.active = null; this.emit(); await this.save().catch(() => {}); });
    return id;
  }
  async *localFiles(paths) {
    if (!paths.length) throw new Error('Choose local files in Sources before starting a local import');
    for (const file of paths) {
      if (path.extname(file).toLowerCase() === '.jsonl') {
        const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
        let row = 0;
        try { for await (const line of lines) {
          if (!line.trim()) continue;
          if (Buffer.byteLength(line) > 12 * 1024 * 1024) throw new Error('JSONL row exceeds 12 MB');
          const item = JSON.parse(line); row++;
          const { attachments, ...fields } = item;
          yield { ...fields, ...(attachments ? { metadata: { ...item.metadata, importedAttachmentReferences: attachments, note: 'Referenced files are not automatically read by a JSONL import.' } } : {}), id: item.id || `${path.basename(file)}:${row}`, title: item.title || `${path.basename(file)} · ${row}`, text: item.text || item.content || '', url: item.url || `local:${path.basename(file)}`, rights: item.rights || { expression: null, basis: 'unknown' } };
        } } finally { lines.close(); lines.input.destroy(); }
      } else {
        const handle = await open(file, 'r');
        try {
          if ((await handle.stat()).size > 12 * 1024 * 1024) throw new Error('Local text files must be under 12 MB');
          const text = await handle.readFile('utf8');
          if (text.includes('\0')) throw new Error('Binary files are not supported');
          yield { id: path.basename(file), title: path.basename(file), text, url: `local:${path.basename(file)}`, rights: { expression: null, basis: 'unknown' } };
        } finally { await handle.close(); }
      }
    }
  }
  async run(active) {
    const { job, controller } = active; const recipe = job.recipe;
    const deadline = Number(recipe.limits.minutes) > 0 ? Date.now() + Math.max(0, Number(recipe.limits.minutes) * 60000 - (job.elapsedMs || 0)) : Infinity;
    let timer;
    if (Number.isFinite(deadline)) {
      const checkDeadline = () => {
        if (Date.now() >= deadline) { job.reason = 'Wall-clock time limit reached'; controller.abort(); }
        else timer = setTimeout(checkDeadline, Math.min(deadline - Date.now(), 2147483647));
      };
      checkDeadline();
    }
    const seen = new Set((active.saved || []).map(item => item.record.hash));
    const completed = new Set((active.saved || []).map(item => item.record.recoveryKey).filter(Boolean));
    const recoveryRoot = await this.folder(job.id), journal = path.join(recoveryRoot, 'processed.jsonl');
    try { const journalFile = await containedFile(recoveryRoot, 'processed.jsonl'); const lines = createInterface({ input: createReadStream(journalFile), crlfDelay: Infinity }); for await (const line of lines) if (/^[a-f0-9]{64}$/.test(line)) completed.add(line); } catch (e) { if (e.code !== 'ENOENT') { clearTimeout(timer); throw e; } }
    const processed = async key => { await appendFile(journal, key + '\n', { mode: 0o600 }); };
    const failedSources = new Set();
    job.checkpoints ||= {};
    const iterators = recipe.sourceIds.map(source => {
      const context = { resume: job.checkpoints[source] || {}, checkpoint: async value => { if (!failedSources.has(source)) { job.checkpoints[source] = value; await this.save(); } }, input: recipe.inputs?.[source] || '', settings: { ...recipe.settings?.[source], ...recipe.contentLimits, contentMode: recipe.contentMode || 'full' }, key: this.getKey(source), http: new HttpClient({ signal: controller.signal, fetcher: this.fetcher, log: (kind, message) => this.log(job, kind, message, source) }) };
      return { source, context, iterator: source === 'local' ? this.localFiles(active.paths) : this.adapters[source](context) };
    });
    try {
      this.log(job, 'info', 'Collection started. Limits apply to accepted output; wall-clock time includes waits.');
      while (iterators.length && !controller.signal.aborted) {
        for (let i = 0; i < iterators.length && !controller.signal.aborted;) {
          if (active.paused) { await new Promise(resolve => { const wake = () => { controller.signal.removeEventListener('abort', wake); resolve(); }; active.wake = wake; controller.signal.addEventListener('abort', wake, { once: true }); }); active.wake = null; if (controller.signal.aborted) break; }
          const { source, iterator, context } = iterators[i];
          let next;
          try { next = await iterator.next(); }
          catch (e) {
            if (controller.signal.aborted) break;
            job.errors++; this.log(job, 'error', e.message?.replace(/(api_key|apiKey|token)=[^&\s]+/gi, '$1=[redacted]') || 'Source failed', source);
            iterators.splice(i, 1); continue;
          }
          if (next.done) { this.log(job, 'info', 'Source exhausted', source); iterators.splice(i, 1); continue; }
          i++;
          if (controller.signal.aborted || Date.now() >= deadline) { job.reason ||= 'Wall-clock time limit reached'; break; }
          const recoveryKey = createHash('sha256').update(JSON.stringify([source, next.value.id, next.value.version, next.value.url, next.value.text])).digest('hex');
          if (completed.has(recoveryKey)) continue;
          let raw;
          try { raw = await materialize(next.value, context.http, context.settings); }
          catch (error) {
            if (controller.signal.aborted) break;
            failedSources.add(source); job.errors++; this.log(job, 'error', `${next.value.title || next.value.id}: ${error.message}`.replace(/(api_key|apiKey|token|key)=[^&\s]+/gi, '$1=[redacted]'), source); continue;
          }
          const { attachments: incoming = [], ...fields } = raw;
          const index = active.nextSequence || job.accepted + 1;
          if (index > 99999999) throw new Error('This dataset reached the maximum supported record index');
          const sequence = String(index).padStart(8, '0');
          const payloads = incoming.map((file, index) => {
            const data = Buffer.from(file.data);
            const filename = `${String(index + 1).padStart(3, '0')}-${String(file.filename || 'original.bin').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160)}`;
            const { data: ignored, ...details } = file;
            return { data, details: { ...details, filename, path: `assets/${sequence}/${filename}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') } };
          });
          const record = { schema: 'maine-source.record.v1', ...fields, source, recoveryKey, text: String(raw.text || ''), collectedAt: new Date().toISOString(), ...(payloads.length ? { attachments: payloads.map(p => p.details) } : {}) };
          const fingerprint = record.text.trim() ? record.text.normalize('NFKC').replace(/\s+/g, ' ').trim() : payloads.map(p => p.details.sha256).join(':');
          record.hash = createHash('sha256').update(fingerprint).digest('hex');
          const binaryOnly = payloads.length && !record.text.trim();
          const result = evaluate(record, binaryOnly && !recipe.requireText ? { ...recipe, minLength: 0 } : recipe, seen);
          job.seen++;
          if (!result.accepted) {
            job.rejected++; job.outcomes[result.kind] = (job.outcomes[result.kind] || 0) + 1;
            this.log(job, 'filtered', `${raw.title || raw.id}: ${result.reason}`, source);
            await processed(recoveryKey); await this.save(); continue;
          }
          record.policy = { strictness: recipe.strictness, mode: recipe.licenseMode, decision: result.reason, warning: [result.warning, binaryOnly ? 'No text could be extracted. Original files retained; keyword filtering could examine the title only.' : null].filter(Boolean).join(' ') || null };
          const serialized = JSON.stringify(record) + '\n';
          const bytes = Buffer.byteLength(serialized) + payloads.reduce((sum, p) => sum + p.data.length, 0);
          if (Number(recipe.limits.megabytes) > 0 && job.bytes + bytes > recipe.limits.megabytes * 1024 * 1024) { job.reason = 'Storage limit reached; next record would exceed budget'; controller.abort(); break; }
          if (controller.signal.aborted || Date.now() >= deadline) { job.reason ||= 'Wall-clock time limit reached'; break; }
          await this.checkSpace(recoveryRoot, bytes);
          await mkdir(path.join(recoveryRoot, 'assets'), { recursive: true });
          await containedFile(recoveryRoot, 'assets'); await containedFile(recoveryRoot, 'records');
          // Only the next, uncommitted record may have leftovers from an interrupted write.
          await rm(path.join(recoveryRoot, 'assets', sequence), { recursive: true, force: true });
          await unlink(path.join(recoveryRoot, 'records', `${sequence}.json.tmp`)).catch(e => { if (e.code !== 'ENOENT') throw e; });
          for (const payload of payloads) {
            const assetPath = path.join(recoveryRoot, payload.details.path);
            await mkdir(path.dirname(assetPath), { recursive: true });
            await writeFile(`${assetPath}.tmp`, payload.data, { flag: 'wx', mode: 0o600 });
            await rename(`${assetPath}.tmp`, assetPath);
          }
          const recordPath = path.join(recoveryRoot, 'records', `${sequence}.json`);
          const tempPath = `${recordPath}.tmp`;
          await writeFile(tempPath, serialized, { flag: 'wx', mode: 0o600 });
          await rename(tempPath, recordPath);
          seen.add(record.hash); job.accepted++; job.bytes += bytes; job.lastSequence = index; active.nextSequence = index + 1;
          job.counts[source] = (job.counts[source] || 0) + 1;
          job.licenses[result.license] = (job.licenses[result.license] || 0) + 1;
          const bucket = new Date().toISOString().slice(0, 16);
          if (job.activity.at(-1)?.bucket === bucket) job.activity.at(-1).count++; else job.activity.push({ bucket, count: 1 });
          job.samples.unshift({ title: record.title, source, license: result.license, preview: record.text.slice(0, 400), url: record.url, attachments: record.attachments, contentStatus: record.metadata?.contentStatus, contentFailures: record.metadata?.contentFailures }); job.samples = job.samples.slice(0, 12);
          this.log(job, 'accepted', `Accepted ${raw.title || raw.id}`, source);
          await processed(recoveryKey); await this.save();
          if (Number(recipe.limits.files) > 0 && job.accepted >= recipe.limits.files) { job.reason = 'Document count limit reached'; controller.abort(); break; }
        }
      }
      job.reason ||= controller.signal.aborted ? 'Stopped by user' : 'All selected sources exhausted';
      job.status = job.errors ? 'completed_with_errors' : 'completed';
      if (job.reason === 'Stopped by user') job.status = 'stopped';
    } catch (e) { job.status = controller.signal.aborted ? 'stopped' : 'failed'; job.reason ||= controller.signal.aborted ? 'Stopped by user' : redactSecrets(e.message, recipe.sourceIds.map(id => this.getKey(id))); }
    finally {
      clearTimeout(timer);
      for (const { iterator } of iterators) await iterator.return?.().catch(() => {});
      job.elapsedMs = active.elapsedBefore + Date.now() - active.sessionStarted;
      job.endedAt = new Date().toISOString(); this.active = null;
      await atomicJSON(path.join(recoveryRoot, 'manifest.json'), { ...job, samples: undefined, events: undefined });
      await this.save(); this.emit();
    }
  }
  pause() { if (!this.active) return; this.active.paused = !this.active.paused; this.active.job.status = this.active.paused ? 'paused' : 'running'; this.active.wake?.(); this.save(); this.emit(); }
  stop() { if (!this.active) return; this.active.job.reason ||= 'Stopped by user'; this.active.job.status = 'stopping'; this.active.controller.abort(); this.active.wake?.(); this.emit(); }
  async exportTo(id, destination, format = 'jsonl', textOutput = defaultTextOutput()) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || this.active?.job.id === id) throw new Error('Finish or stop this run before exporting');
    if (!['jsonl', 'text'].includes(format)) throw new Error('Invalid export format');
    const settings = validateTextOutput(textOutput);
    jobFolder(this.root, id);
    const runRoot = await this.folder(id);
    const originalsOnly = format === 'text' && settings.representation === 'originals';
    const structured = format === 'jsonl' || originalsOnly;
    const compressed = !structured && settings.compression === 'gzip';
    let exportedRecords = 0, skippedRecords = 0;
    const chunks = async function* () {
      for (const file of await recordFiles(runRoot)) {
        const r = await readRecord(runRoot, file);
        const text = structured ? null : await renderText(r, settings, runRoot);
        if (!structured && text === null) { skippedRecords++; continue; }
        for (const attachment of r.attachments || []) {
          const relative = attachment.path;
          attachmentPath(runRoot, relative);
          const source = await containedFile(runRoot, relative);
          const assetRoot = `${destination}.assets`, output = path.join(assetRoot, relative);
          await mkdir(assetRoot, { recursive: true });
          if ((await lstat(assetRoot)).isSymbolicLink()) throw new Error('Export assets folder must not be a filesystem link');
          let outputDirectory = assetRoot;
          for (const part of relative.split('/').slice(0, -1)) {
            outputDirectory = path.join(outputDirectory, part);
            try { await mkdir(outputDirectory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
            if ((await lstat(outputDirectory)).isSymbolicLink()) throw new Error('Export assets directory must not be a filesystem link');
          }
          try { if ((await lstat(output)).isSymbolicLink()) throw new Error('Export original must not overwrite a filesystem link'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await copyFile(source, output);
          attachment.path = `${path.basename(destination)}.assets/${relative}`;
        }
        if (originalsOnly) delete r.text;
        yield structured ? Buffer.from(JSON.stringify(r) + '\n', 'utf8') : encodeText(transformText(text, settings), settings, { first: exportedRecords === 0 });
        exportedRecords++;
      }
      if (!exportedRecords && !structured && settings.representation === 'latex') throw new Error('No original LaTeX .tex source is available in this dataset; PDF text is not converted into invented LaTeX');
    };
    await this.checkSpace(path.dirname(destination), (job.bytes || 0) * 5);
    const temp = `${destination}.${randomUUID()}.tmp`;
    try {
      await pipeline(Readable.from(chunks()), ...(compressed ? [createGzip()] : []), createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      await rename(temp, destination);
    } catch (error) { await unlink(temp).catch(() => {}); throw error; }
    const { storageParent: ignoredParent, recipe: savedRecipe, ...portableJob } = job;
    const { downloadDirectory: ignoredDirectory, ...portableRecipe } = savedRecipe || {};
    await atomicJSON(`${destination}.manifest.json`, { schema: 'maine-source.dataset.v1', exportedAt: new Date().toISOString(), format, ...portableJob, recipe: portableRecipe, samples: undefined, events: undefined, exportedRecords, skippedRecords, textOutput: structured ? { representation: originalsOnly ? 'originals' : 'records', encoding: 'utf8', bom: 'never', normalization: 'none', newlines: 'lf', compression: 'none' } : settings });
  }
}
