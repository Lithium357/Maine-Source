import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { connectors } from './connectors.mjs';
import { sources } from './catalog.mjs';
import { evaluate } from './policy.mjs';
import { HttpClient } from './http.mjs';

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new Error('Invalid recipe');
  if (!String(recipe.name || '').trim()) throw new Error('Give your dataset a name');
  if (!Array.isArray(recipe.sourceIds) || !recipe.sourceIds.length) throw new Error('Select at least one source');
  if (new Set(recipe.sourceIds).size !== recipe.sourceIds.length) throw new Error('Duplicate source selection');
  for (const id of recipe.sourceIds) if (!sources.some(s => s.id === id && !s.planned)) throw new Error(`Unsupported source: ${id}`);
  if (!['off', 'any', 'allowlist'].includes(recipe.licenseMode)) throw new Error('Invalid license policy');
  if (!Number.isInteger(recipe.strictness) || recipe.strictness < 1 || recipe.strictness > 10) throw new Error('Strictness must be 1–10');
  if (recipe.licenseMode === 'allowlist' && !recipe.allowLicenses?.length) throw new Error('Choose at least one allowed license');
  const limits = recipe.limits || {};
  for (const key of ['minutes', 'megabytes', 'files']) if (!Number.isFinite(Number(limits[key])) || Number(limits[key]) < 0) throw new Error('Limits must be finite, nonnegative numbers');
  if (![limits.minutes, limits.megabytes, limits.files].some(v => Number(v) > 0)) throw new Error('Set at least one stop condition');
  if (limits.files && !Number.isInteger(Number(limits.files))) throw new Error('Document count must be a whole number');
  if (!Number.isFinite(Number(recipe.minLength)) || recipe.minLength < 0) throw new Error('Minimum length must be nonnegative');
  if (JSON.stringify(recipe).length > 200000) throw new Error('Recipe is too large');
  return structuredClone(recipe);
}
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
export class Collector {
  constructor({ root, onChange = () => {}, getKey = () => '', adapters = connectors, fetcher = fetch, localPaths = [] }) {
    Object.assign(this, { root, onChange, getKey, adapters, fetcher, localPaths });
    this.jobs = []; this.active = null; this.pendingSave = Promise.resolve();
  }
  async init() {
    await mkdir(this.root, { recursive: true });
    try { this.jobs = JSON.parse(await readFile(path.join(this.root, 'jobs.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const job of this.jobs) if (['running', 'paused', 'stopping'].includes(job.status)) { job.status = 'interrupted'; job.reason = 'App closed before this run finished. Start a new run from its recipe.'; job.endedAt = new Date().toISOString(); }
    await this.save();
  }
  save() {
    const snapshot = structuredClone(this.jobs);
    this.pendingSave = this.pendingSave.catch(() => {}).then(() => atomicJSON(path.join(this.root, 'jobs.json'), snapshot));
    return this.pendingSave;
  }
  emit() { this.onChange(); }
  log(job, kind, message, source) {
    job.events.push({ time: new Date().toISOString(), kind, message, source });
    if (job.events.length > 160) job.events.shift();
    this.emit();
  }
  async start(input) {
    if (this.active) throw new Error('A collection is already active. Stop it before starting another.');
    const recipe = validateRecipe(input);
    const job = { id: randomUUID(), name: recipe.name, recipe, status: 'running', startedAt: new Date().toISOString(), accepted: 0, rejected: 0, bytes: 0, seen: 0, errors: 0, counts: {}, licenses: {}, outcomes: {}, samples: [], events: [], activity: [], reason: '' };
    const active = { job, controller: new AbortController(), paused: false, paths: [...this.localPaths] };
    this.active = active; this.jobs.unshift(job);
    try { await mkdir(path.join(this.root, job.id, 'records'), { recursive: true }); await this.save(); }
    catch (error) { this.active = null; this.jobs = this.jobs.filter(j => j.id !== job.id); throw error; }
    this.emit();
    this.running = this.run(active).catch(error => { job.status = 'failed'; job.reason = `Could not save collection state: ${error.message}`; this.active = null; this.emit(); });
    return job.id;
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
          yield { ...item, id: item.id || `${path.basename(file)}:${row}`, title: item.title || `${path.basename(file)} · ${row}`, text: item.text || item.content || '', url: item.url || `local:${path.basename(file)}`, rights: item.rights || { expression: null, basis: 'unknown' } };
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
    const deadline = Number(recipe.limits.minutes) > 0 ? Date.now() + Number(recipe.limits.minutes) * 60000 : Infinity;
    let timer;
    if (Number.isFinite(deadline)) {
      const checkDeadline = () => {
        if (Date.now() >= deadline) { job.reason = 'Wall-clock time limit reached'; controller.abort(); }
        else timer = setTimeout(checkDeadline, Math.min(deadline - Date.now(), 2147483647));
      };
      checkDeadline();
    }
    const seen = new Set();
    const iterators = recipe.sourceIds.map(source => {
      const context = { input: recipe.inputs?.[source] || '', settings: recipe.settings?.[source] || {}, key: this.getKey(source), http: new HttpClient({ signal: controller.signal, fetcher: this.fetcher, log: (kind, message) => this.log(job, kind, message, source) }) };
      return { source, iterator: source === 'local' ? this.localFiles(active.paths) : this.adapters[source](context) };
    });
    try {
      this.log(job, 'info', 'Collection started. Limits apply to accepted output; wall-clock time includes waits.');
      while (iterators.length && !controller.signal.aborted) {
        for (let i = 0; i < iterators.length && !controller.signal.aborted;) {
          if (active.paused) { await new Promise(resolve => { const wake = () => { controller.signal.removeEventListener('abort', wake); resolve(); }; active.wake = wake; controller.signal.addEventListener('abort', wake, { once: true }); }); active.wake = null; if (controller.signal.aborted) break; }
          const { source, iterator } = iterators[i];
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
          const raw = next.value;
          const record = { schema: 'maine-source.record.v1', ...raw, source, text: String(raw.text || ''), collectedAt: new Date().toISOString() };
          record.hash = createHash('sha256').update(record.text.normalize('NFKC').replace(/\s+/g, ' ').trim()).digest('hex');
          const result = evaluate(record, recipe, seen);
          job.seen++;
          if (!result.accepted) {
            job.rejected++; job.outcomes[result.kind] = (job.outcomes[result.kind] || 0) + 1;
            this.log(job, 'filtered', `${raw.title || raw.id}: ${result.reason}`, source);
            continue;
          }
          record.policy = { strictness: recipe.strictness, mode: recipe.licenseMode, decision: result.reason, warning: result.warning || null };
          const serialized = JSON.stringify(record) + '\n';
          const bytes = Buffer.byteLength(serialized);
          if (Number(recipe.limits.megabytes) > 0 && job.bytes + bytes > recipe.limits.megabytes * 1024 * 1024) { job.reason = 'Storage limit reached; next record would exceed budget'; controller.abort(); break; }
          if (controller.signal.aborted || Date.now() >= deadline) { job.reason ||= 'Wall-clock time limit reached'; break; }
          const recordPath = path.join(this.root, job.id, 'records', `${String(job.accepted + 1).padStart(8, '0')}.json`);
          const tempPath = `${recordPath}.tmp`;
          await writeFile(tempPath, serialized, { flag: 'wx', mode: 0o600 });
          await rename(tempPath, recordPath);
          seen.add(record.hash); job.accepted++; job.bytes += bytes;
          job.counts[source] = (job.counts[source] || 0) + 1;
          job.licenses[result.license] = (job.licenses[result.license] || 0) + 1;
          const bucket = new Date().toISOString().slice(0, 16);
          if (job.activity.at(-1)?.bucket === bucket) job.activity.at(-1).count++; else job.activity.push({ bucket, count: 1 });
          job.samples.unshift({ title: record.title, source, license: result.license, preview: record.text.slice(0, 400), url: record.url }); job.samples = job.samples.slice(0, 12);
          this.log(job, 'accepted', `Accepted ${raw.title || raw.id}`, source);
          await this.save();
          if (Number(recipe.limits.files) > 0 && job.accepted >= recipe.limits.files) { job.reason = 'Document count limit reached'; controller.abort(); break; }
        }
      }
      job.reason ||= controller.signal.aborted ? 'Stopped by user' : 'All selected sources exhausted';
      job.status = job.errors ? 'completed_with_errors' : 'completed';
      if (job.reason === 'Stopped by user') job.status = 'stopped';
    } catch (e) { job.status = controller.signal.aborted ? 'stopped' : 'failed'; job.reason ||= controller.signal.aborted ? 'Stopped by user' : e.message; }
    finally {
      clearTimeout(timer);
      for (const { iterator } of iterators) await iterator.return?.().catch(() => {});
      job.endedAt = new Date().toISOString(); this.active = null;
      await atomicJSON(path.join(this.root, job.id, 'manifest.json'), { ...job, samples: undefined, events: undefined });
      await this.save(); this.emit();
    }
  }
  pause() { if (!this.active) return; this.active.paused = !this.active.paused; this.active.job.status = this.active.paused ? 'paused' : 'running'; this.active.wake?.(); this.save(); this.emit(); }
  stop() { if (!this.active) return; this.active.job.reason ||= 'Stopped by user'; this.active.job.status = 'stopping'; this.active.controller.abort(); this.active.wake?.(); this.emit(); }
  async exportTo(id, destination, format = 'jsonl') {
    const job = this.jobs.find(j => j.id === id);
    if (!job || this.active?.job.id === id) throw new Error('Finish or stop this run before exporting');
    if (!['jsonl', 'text'].includes(format)) throw new Error('Invalid export format');
    const directory = path.join(this.root, id, 'records');
    const handle = await open(destination, 'w');
    try {
      for (const file of (await readdir(directory)).filter(f => f.endsWith('.json')).sort()) {
        const data = await readFile(path.join(directory, file), 'utf8');
        if (format === 'jsonl') await handle.writeFile(data); else { const r = JSON.parse(data); await handle.writeFile(`${r.title || ''}\n${r.url || ''}\n\n${r.text}\n\n---\n\n`); }
      }
    } finally { await handle.close(); }
    await atomicJSON(`${destination}.manifest.json`, { schema: 'maine-source.dataset.v1', exportedAt: new Date().toISOString(), format, ...job, samples: undefined, events: undefined });
  }
}
