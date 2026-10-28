import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, symlink, rename, unlink } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { Collector } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { browseRecords, recordDetail, validateDataset, jobFolder, inspectForResume } from '../src/datasets.mjs';
import { prepareStorage, relocateStorage, ensureFreeSpace } from '../src/storage.mjs';

const item = n => ({ id: n, title: `Record ${n}`, text: `Full engineering manuscript number ${n} with enough content to satisfy the collection policy.`, contentRequests: [{ data: `Original manuscript ${n}`, filename: 'original.txt' }] });
async function setup(adapter, options = {}) {
  await mkdir('.test-data', { recursive: true }); const root = await mkdtemp(path.resolve('.test-data', 'recovery-'));
  const collector = new Collector({ root, adapters: { nvd: adapter }, ...options }); await collector.init(); return { root, collector };
}
const recipe = { ...defaultRecipe(), sourceIds: ['nvd'], minLength: 1, limits: { files: 3, minutes: 0, megabytes: 0 } };

test('resume preserves sparse record indices and does not restore removed or quarantined records', async () => {
  const { root, collector } = await setup(async function* () { for (let n = 1; n <= 5; n++) yield item(n); });
  const id = await collector.start(recipe); await collector.running;
  const run = path.join(root, id), original = await readFile(path.join(run, 'records/00000003.json'));
  await unlink(path.join(run, 'records/00000002.json'));
  const journal = await readFile(path.join(run, 'processed.jsonl'));
  collector.jobs[0].status = 'interrupted';
  await collector.resume(id, { files: 4, minutes: 0, megabytes: 0 }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 4);
  assert.deepEqual(await readdir(path.join(run, 'records')), ['00000001.json', '00000003.json', '00000004.json', '00000005.json']);
  assert.deepEqual(await readFile(path.join(run, 'records/00000003.json')), original);
  assert.ok((await readFile(path.join(run, 'processed.jsonl'))).subarray(0, journal.length).equals(journal));
  assert.deepEqual(collector.jobs[0].recoveryGaps, [[2, 2]]);
  assert.ok(collector.jobs[0].events.some(e => /not automatically restored/.test(e.message)));
  assert.equal((await browseRecords(run)).total, 4);
  await collector.exportTo(id, path.join(root, 'sparse.jsonl'));
  assert.equal((await readFile(path.join(root, 'sparse.jsonl'), 'utf8')).trim().split('\n').length, 4);
});

test('a missing final record does not reuse its committed slot on resume', async () => {
  const { root, collector } = await setup(async function* () { for (let n = 1; n <= 4; n++) yield item(n); });
  const id = await collector.start(recipe); await collector.running;
  const run = path.join(root, id); await unlink(path.join(run, 'records/00000003.json'));
  collector.jobs[0].status = 'interrupted'; await collector.resume(id); await collector.running;
  assert.deepEqual(await readdir(path.join(run, 'records')), ['00000001.json', '00000002.json', '00000004.json']);
  assert.equal(collector.jobs[0].accepted, 3); assert.equal(collector.jobs[0].lastSequence, 4);
});

test('failed recovery validation leaves saved counters intact and reports the actual filename', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); });
  const id = await collector.start(recipe); await collector.running;
  const job = collector.jobs[0], accepted = job.accepted, bytes = job.bytes, counts = structuredClone(job.counts);
  await writeFile(path.join(root, id, 'records/00000001.json'), '{"broken":true}'); job.status = 'interrupted';
  await assert.rejects(collector.resume(id), /00000001.json/);
  assert.equal(job.accepted, accepted); assert.equal(job.bytes, bytes); assert.deepEqual(job.counts, counts);
  assert.equal(job.recoveryProgress, undefined); assert.equal(collector.starting, false);
});

test('files removed during the recovery scan become reported gaps instead of aborting the run', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); });
  const id = await collector.start(recipe); await collector.running;
  const run = path.join(root, id);
  const result = await inspectForResume(run, { highWater: 1, onProgress: p => { if (!p.checked) unlinkSync(path.join(run, 'records/00000001.json')); } });
  assert.equal(result.accepted, 0); assert.deepEqual(result.gaps, [[1, 1]]); assert.equal(result.lastSequence, 1);
});
test('resume keeps the dataset ID, skips saved content, and retries failed materialization', async () => {
  let failed = true, firstDownloads = 0;
  const adapter = async function* () { for (let n = 1; n <= 3; n++) { const r = item(n); if (n === 1) firstDownloads++; if (n === 2 && failed) r.contentRequests = [{ error: 'Temporary missing content' }]; yield r; } };
  const { root, collector } = await setup(adapter);
  const id = await collector.start(recipe); await collector.running; assert.equal(collector.jobs[0].accepted, 2); assert.equal(collector.jobs[0].status, 'completed_with_errors');
  const before = await readFile(path.join(root, id, 'records/00000001.json'));
  failed = false;
  const reopened = new Collector({ root, adapters: { nvd: adapter } }); await reopened.init();
  await reopened.resume(id); await reopened.running;
  assert.equal(reopened.jobs[0].accepted, 3); assert.equal(reopened.jobs[0].errors, 0);
  assert.deepEqual(await readFile(path.join(root, id, 'records/00000001.json')), before);
  assert.equal((await validateDataset(jobFolder(root, id))).issues.length, 0);
  assert.equal(firstDownloads, 2); // Discovery revisits; accepted content is skipped by recoveryKey.
  assert.equal((await readdir(path.join(root, id, 'records'))).length, 3);
});
test('a committed record is recovered when history lags behind a crash', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); });
  const id = await collector.start(recipe); await collector.running;
  const history = JSON.parse(await readFile(path.join(root, 'jobs.json'), 'utf8')); history[0].status = 'running'; history[0].accepted = 0; history[0].bytes = 0;
  await writeFile(path.join(root, 'jobs.json'), JSON.stringify(history));
  const reopened = new Collector({ root, adapters: { nvd: async function* () { yield item(1); yield item(2); } } }); await reopened.init();
  await reopened.resume(id); await reopened.running;
  assert.equal(reopened.jobs[0].accepted, 2);
  assert.ok(reopened.jobs[0].bytes > 0);
});
test('completed page checkpoints are supplied to adapters on resume', async () => {
  let outage = true;
  const adapter = async function* ({ resume = {}, checkpoint }) {
    for (let n = resume.next || 1; n <= 3; n++) { if (outage && n === 2) throw new Error('Network outage'); yield item(n); await checkpoint({ next: n + 1 }); }
  };
  const { root, collector } = await setup(adapter); const id = await collector.start(recipe); await collector.running;
  assert.deepEqual(collector.jobs[0].checkpoints.nvd, { next: 2 });
  outage = false; const reopened = new Collector({ root, adapters: { nvd: adapter } }); await reopened.init(); await reopened.resume(id); await reopened.running;
  assert.equal(reopened.jobs[0].accepted, 3);
});
test('disk-full stops safely before a record is committed and can resume after space is freed', async () => {
  let blocked = true;
  const checkSpace = async (_root, bytes) => { if (bytes && blocked) throw new Error('Not enough free disk space'); };
  const adapter = async function* () { yield item(1); };
  const { root, collector } = await setup(adapter, { checkSpace }); const id = await collector.start(recipe); await collector.running;
  assert.equal(collector.jobs[0].status, 'failed'); assert.equal(collector.jobs[0].accepted, 0); assert.match(collector.jobs[0].reason, /free disk/);
  assert.deepEqual(await readdir(path.join(root, id, 'records')), []);
  blocked = false; await collector.resume(id); await collector.running; assert.equal(collector.jobs[0].accepted, 1);
});
test('interrupted temporary writes do not block recovery or overwrite committed data', async () => {
  const { root, collector } = await setup(async function* () { throw new Error('Outage'); }); const id = await collector.start(recipe); await collector.running;
  const run = jobFolder(root, id); await writeFile(path.join(run, 'records/00000001.json.tmp'), 'partial');
  await mkdir(path.join(run, 'assets/00000001'), { recursive: true }); await writeFile(path.join(run, 'assets/00000001/001-original.txt.tmp'), 'partial');
  collector.adapters.nvd = async function* () { yield item(1); }; await collector.resume(id); await collector.running;
  assert.equal(collector.jobs[0].accepted, 1); assert.equal((await validateDataset(run)).issues.length, 0);
});
test('history backup is used when jobs.json is corrupt', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); }); await collector.start(recipe); await collector.running;
  await writeFile(path.join(root, 'jobs.json'), 'broken JSON'); const reopened = new Collector({ root }); await reopened.init(); assert.equal(reopened.jobs[0].accepted, 1);
});
test('record browser searches full text, paginates, and reports changed originals', async () => {
  const { root, collector } = await setup(async function* () { for (let i = 1; i <= 3; i++) yield item(i); }); const id = await collector.start(recipe); await collector.running;
  const run = jobFolder(root, id), result = await browseRecords(run, { query: 'manuscript', limit: 1, offset: 1 });
  assert.equal(result.total, 3); assert.equal(result.rows.length, 1);
  const detail = await recordDetail(run, result.rows[0].file); assert.match(detail.text, /manuscript/);
  assert.equal((await browseRecords(run, { source: 'github' })).total, 0);
  await writeFile(path.join(run, detail.attachments[0].path), Buffer.alloc(detail.attachments[0].bytes, 99));
  assert.match((await validateDataset(run)).issues[0], /SHA-256/);
  await assert.rejects(recordDetail(run, '../jobs.json'), /Invalid record/);
  assert.throws(() => jobFolder(root, '../outside'), /Invalid dataset/);
});
test('concurrent start requests cannot both create active runs', async () => {
  const { collector } = await setup(async function* ({ http }) { await http.wait(60000); });
  const results = await Promise.allSettled([collector.start(recipe), collector.start(recipe)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(collector.jobs.length, 1); collector.stop(); await collector.running;
});
test('provider errors cannot echo connected credentials into run events', async () => {
  const secret = 'secret/key+value';
  const { collector } = await setup(async function* () { throw new Error(`Failed api_key=${encodeURIComponent(secret)} Authorization: Bearer ${secret}`); }, { getKey: () => secret });
  await collector.start(recipe); await collector.running;
  const events = JSON.stringify(collector.jobs[0].events);
  assert.ok(!events.includes(secret)); assert.ok(!events.includes(encodeURIComponent(secret))); assert.match(events, /redacted/);
});
test('a larger collection retains all searchable records and exports them without loss', async () => {
  const { root, collector } = await setup(async function* () { for (let n = 0; n < 500; n++) yield { id: n, title: `Large record ${n}`, text: `Distinct original row ${n}: ${'engineering content '.repeat(50)}` }; });
  const id = await collector.start({ ...recipe, limits: { minutes: 0, megabytes: 0, files: 500 } }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 500);
  const found = await browseRecords(jobFolder(root, id), { query: 'Distinct original row 499:' }); assert.equal(found.total, 1);
  const output = path.join(root, 'large.jsonl'); await collector.exportTo(id, output);
  assert.equal((await readFile(output, 'utf8')).trim().split('\n').length, 500);
});
test('relocation preserves originals, refuses nested/existing destinations, and checks capacity', async () => {
  await mkdir('.test-data', { recursive: true }); const parent = await mkdtemp(path.resolve('.test-data', 'relocate-'));
  const desktop = path.join(parent, 'Desktop'); await mkdir(desktop); const paths = await prepareStorage({ desktop, userData: path.join(parent, 'private') });
  await writeFile(path.join(paths.datasets, 'original.json'), 'keep unchanged');
  const destination = path.join(parent, 'Other drive'); await mkdir(destination);
  const moved = await relocateStorage(paths, destination);
  assert.equal(await readFile(path.join(moved.datasets, 'original.json'), 'utf8'), 'keep unchanged');
  assert.equal(await readFile(path.join(paths.datasets, 'original.json'), 'utf8'), 'keep unchanged');
  await assert.rejects(relocateStorage(paths, destination), /already contains/);
  await assert.rejects(relocateStorage(paths, paths.data), /outside/);
  await assert.rejects(ensureFreeSpace(parent, Number.MAX_SAFE_INTEGER), /free disk/);
});
test('resume cannot remove files through an assets junction outside its dataset', async () => {
  const { root, collector } = await setup(async function* () { throw new Error('Outage'); }); const id = await collector.start(recipe); await collector.running;
  const outside = path.join(root, 'outside'); await mkdir(path.join(outside, '00000001'), { recursive: true }); await writeFile(path.join(outside, '00000001', 'keep.txt'), 'preserve');
  await symlink(outside, path.join(root, id, 'assets'), 'junction');
  collector.adapters.nvd = async function* () { yield item(1); }; await collector.resume(id); await collector.running;
  assert.equal(collector.jobs[0].accepted, 0); assert.match(collector.jobs[0].reason, /outside/);
  assert.equal(await readFile(path.join(outside, '00000001/keep.txt'), 'utf8'), 'preserve');
});
test('export rejects originals redirected outside the dataset', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); }); const id = await collector.start(recipe); await collector.running;
  const run = path.join(root, id), outside = path.join(root, 'outside'); await mkdir(outside);
  await rename(path.join(run, 'assets'), path.join(outside, 'assets'));
  await symlink(path.join(outside, 'assets'), path.join(run, 'assets'), 'junction');
  await assert.rejects(collector.exportTo(id, path.join(root, 'unsafe.jsonl')), /outside/);
});
test('validation reports structurally corrupted records instead of accepting them', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); }); const id = await collector.start(recipe); await collector.running;
  await writeFile(path.join(root, id, 'records/00000001.json'), '{"text":{"bad":"object"}}');
  assert.match((await validateDataset(path.join(root, id))).issues[0], /Invalid saved record/);
});
test('export cannot write through a companion-assets junction', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); }); const id = await collector.start(recipe); await collector.running;
  const outside = path.join(root, 'external-destination'); await mkdir(outside);
  const destination = path.join(root, 'output.jsonl'); await symlink(outside, destination + '.assets', 'junction');
  await assert.rejects(collector.exportTo(id, destination), /filesystem link/);
  assert.deepEqual(await readdir(outside), []);
});
test('export rejects nested destination junctions before creating outside directories', async () => {
  const { root, collector } = await setup(async function* () { yield item(1); }); const id = await collector.start(recipe); await collector.running;
  const outside = path.join(root, 'outside-nested'); await mkdir(outside);
  const destination = path.join(root, 'output.jsonl'); await mkdir(destination + '.assets'); await symlink(outside, path.join(destination + '.assets', 'assets'), 'junction');
  await assert.rejects(collector.exportTo(id, destination), /filesystem link/);
  assert.deepEqual(await readdir(outside), []);
});
