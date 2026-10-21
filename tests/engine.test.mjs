import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Collector, validateRecipe } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
const record = n => ({ id: n, title: `Document ${n}`, text: `Engineering record ${n}: robust collection and license policy for a reproducible training corpus.`, url: `https://example.org/${n}`, rights: { expression: 'MIT', basis: 'source-declaration', url: 'https://example.org/license', scope: 'record' }, version: 'v1' });
const recipe = changes => ({ ...defaultRecipe(), sourceIds: ['nvd'], ...changes });
async function setup(adapter) { const parent = path.resolve('.test-data'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, 'run-')); const collector = new Collector({ root, adapters: { nvd: adapter } }); await collector.init(); return { root, collector }; }
test('validates limits, source IDs, strictness, and allowlist before running', () => {
  for (const r of [recipe({ limits: { minutes: 0, megabytes: 0, files: 0 } }), recipe({ strictness: 11 }), recipe({ sourceIds: ['not-real'] }), recipe({ licenseMode: 'allowlist' }), recipe({ limits: { minutes: NaN, megabytes: 1, files: 1 } })]) assert.throws(() => validateRecipe(r));
});
test('document count limit and streamed export preserve metadata', async () => {
  const { root, collector } = await setup(async function* () { for (let i = 0; i < 10; i++) yield record(i); });
  const id = await collector.start(recipe({ limits: { files: 3, minutes: 0, megabytes: 0 } })); await collector.running;
  assert.equal(collector.jobs[0].accepted, 3); assert.match(collector.jobs[0].reason, /Document count/);
  const files = await readdir(path.join(root, id, 'records')); assert.equal(files.length, 3);
  const out = path.join(root, 'export.jsonl'); await collector.exportTo(id, out);
  const rows = (await readFile(out, 'utf8')).trim().split('\n').map(JSON.parse); assert.equal(rows.length, 3); assert.equal(rows[0].rights.expression, 'MIT'); assert.equal(rows[0].source, 'nvd'); assert.ok(rows[0].hash);
  const manifest = JSON.parse(await readFile(out + '.manifest.json', 'utf8')); assert.equal(manifest.accepted, 3);
});
test('metadata bytes are included and storage limit never overfills', async () => {
  const { root, collector } = await setup(async function* () { yield record(1); });
  const id = await collector.start(recipe({ limits: { files: 0, minutes: 0, megabytes: 0.00001 } })); await collector.running;
  assert.equal(collector.jobs[0].accepted, 0); assert.equal(collector.jobs[0].bytes, 0); assert.match(collector.jobs[0].reason, /Storage limit/); assert.deepEqual(await readdir(path.join(root, id, 'records')), []);
});
test('time limit interrupts API waits without accepting late data', async () => {
  const { collector } = await setup(async function* ({ http }) { await http.wait(60000); yield record(1); });
  const start = Date.now(); await collector.start(recipe({ limits: { files: 0, minutes: 0.001, megabytes: 0 } })); await collector.running;
  assert.ok(Date.now() - start < 3000); assert.equal(collector.jobs[0].accepted, 0); assert.match(collector.jobs[0].reason, /Wall-clock/);
});
test('rejections do not consume document budget, duplicates are excluded', async () => {
  const { collector } = await setup(async function* () { yield { ...record(0), text: 'cats in engineering documentation and data collection pipelines' }; yield record(1); yield record(1); yield record(2); });
  await collector.start(recipe({ blacklist: 'cats', limits: { files: 2, minutes: 0, megabytes: 0 } })); await collector.running;
  assert.equal(collector.jobs[0].accepted, 2); assert.equal(collector.jobs[0].rejected, 2); assert.equal(collector.jobs[0].outcomes.keyword, 1); assert.equal(collector.jobs[0].outcomes.duplicate, 1);
});
test('one failed source does not prevent other sources collecting', async () => {
  const { collector } = await setup(async function* () { throw new Error('Source outage'); });
  collector.adapters.cisa = async function* () { yield record(1); };
  await collector.start(recipe({ sourceIds: ['nvd', 'cisa'] })); await collector.running;
  assert.equal(collector.jobs[0].accepted, 1); assert.equal(collector.jobs[0].errors, 1); assert.equal(collector.jobs[0].status, 'completed_with_errors');
});
test('pause and stop remain responsive while a job is waiting', async () => {
  const { collector } = await setup(async function* ({ http }) { yield record(1); await http.wait(60000); yield record(2); });
  await collector.start(recipe()); collector.pause(); await sleep(20); assert.equal(collector.jobs[0].status, 'paused'); collector.stop(); await collector.running; assert.equal(collector.jobs[0].status, 'stopped');
});
test('only one collection can run at a time', async () => {
  const { collector } = await setup(async function* ({ http }) { await http.wait(60000); });
  await collector.start(recipe()); await assert.rejects(collector.start(recipe()), /already active/); collector.stop(); await collector.running;
});
test('a restarted app marks abandoned runs interrupted', async () => {
  const { root, collector } = await setup(async function* ({ http }) { await http.wait(60000); });
  await collector.start(recipe()); const fresh = new Collector({ root }); await fresh.init(); assert.equal(fresh.jobs[0].status, 'interrupted'); collector.stop(); await collector.running;
});
test('local JSONL preserves user-supplied rights without exposing file paths', async () => {
  const { root, collector } = await setup(async function* () {});
  const { writeFile } = await import('node:fs/promises'); const file = path.join(root, 'input.jsonl'); await writeFile(file, JSON.stringify(record(1)) + '\n'); collector.localPaths = [file];
  await collector.start(recipe({ sourceIds: ['local'] })); await collector.running; assert.equal(collector.jobs[0].accepted, 1); assert.equal(collector.jobs[0].licenses.MIT, 1);
});
