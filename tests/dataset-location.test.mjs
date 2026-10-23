import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Collector, validateRecipe } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { browseRecords, validateDataset } from '../src/datasets.mjs';

const recipe = { ...defaultRecipe(), sourceIds: ['nvd'], minLength: 1, limits: { files: 1, minutes: 0, megabytes: 0 } };
const adapter = async function* () { for (let n = 1; n < 4; n++) yield { id: n, title: `Record ${n}`, text: `Engineering text ${n}`, contentRequests: [{ data: `Original ${n}`, filename: 'original.txt' }] }; };
async function setup() {
  await mkdir('.test-data', { recursive: true });
  const parent = await mkdtemp(path.resolve('.test-data', 'location-'));
  const root = path.join(parent, 'workspace'), chosen = path.join(parent, 'Chosen folder'), other = path.join(parent, 'Other drive');
  await mkdir(chosen); await mkdir(other);
  const collector = new Collector({ root, adapters: { nvd: adapter } }); await collector.init();
  return { parent, root, chosen, other, collector };
}

test('custom download folder persists and supports restart, resume, browsing, and portable export', async () => {
  const { root, chosen, collector, parent } = await setup();
  const id = await collector.start({ ...recipe, downloadDirectory: chosen }); await collector.running;
  assert.equal((await readdir(root)).includes(id), false);
  assert.equal((await validateDataset(await collector.folder(id))).records, 1);
  const reopened = new Collector({ root, adapters: { nvd: adapter } }); await reopened.init();
  reopened.jobs[0].status = 'stopped';
  await reopened.resume(id, { files: 3, minutes: 0, megabytes: 0 }); await reopened.running;
  const folder = await reopened.folder(id);
  assert.equal(path.dirname(folder), chosen);
  assert.equal((await browseRecords(folder)).total, 3);
  assert.deepEqual((await validateDataset(folder)).issues, []);
  const out = path.join(parent, 'portable.jsonl'); await reopened.exportTo(id, out);
  const manifest = JSON.parse(await readFile(out + '.manifest.json', 'utf8'));
  assert.equal('storageParent' in manifest, false);
  assert.equal('downloadDirectory' in manifest.recipe, false);
  assert.equal((await readFile(out, 'utf8')).trim().split('\n').length, 3);
});

test('moving one dataset verifies originals, preserves the previous copy, and leaves other datasets alone', async () => {
  const { root, chosen, collector } = await setup();
  const id = await collector.start(recipe); await collector.running;
  const second = await collector.start(recipe); await collector.running;
  const original = await collector.folder(id), before = await readFile(path.join(original, 'records/00000001.json'));
  const moved = await collector.moveDataset(id, chosen);
  assert.deepEqual(await readFile(path.join(moved, 'records/00000001.json')), before);
  assert.deepEqual(await readFile(path.join(original, 'records/00000001.json')), before);
  const reopened = new Collector({ root }); await reopened.init();
  assert.equal(await reopened.folder(id), moved);
  assert.equal(await reopened.folder(second), path.join(root, second));
  assert.deepEqual((await validateDataset(moved)).issues, []);
  await assert.rejects(reopened.moveDataset(id, chosen), /outside|already contains/);
  await assert.rejects(reopened.moveDataset(id, moved), /outside/);
});

test('failed copies and unavailable drives preserve the active location and do not recreate missing folders', async () => {
  const { collector, chosen, other } = await setup();
  const id = await collector.start({ ...recipe, downloadDirectory: chosen }); await collector.running;
  const original = await collector.folder(id);
  collector.checkSpace = async () => { throw new Error('Not enough free disk space'); };
  await assert.rejects(collector.moveDataset(id, other), /free disk/);
  assert.equal(await collector.folder(id), original);
  assert.deepEqual(await readdir(other), []);
  await rename(chosen, chosen + '-disconnected');
  await assert.rejects(collector.folder(id), /ENOENT/);
  await assert.rejects(collector.start({ ...recipe, downloadDirectory: chosen }), /ENOENT/);
  assert.throws(() => validateRecipe({ ...recipe, downloadDirectory: 'relative/path' }), /absolute/);
});

test('dataset moves reject linked originals and linked custom parent replacements', async () => {
  const { collector, chosen, other } = await setup();
  const id = await collector.start({ ...recipe, downloadDirectory: chosen }); await collector.running;
  const directory = await collector.folder(id);
  await symlink(other, path.join(directory, 'linked-assets'), 'junction');
  await assert.rejects(collector.moveDataset(id, other), /filesystem link/);
  assert.deepEqual(await readdir(other), []);
  await rename(chosen, chosen + '-old'); await symlink(chosen + '-old', chosen, 'junction');
  await assert.rejects(collector.folder(id), /changed|linked/);
});

test('moving is refused while collection is active', async () => {
  const { collector, chosen } = await setup();
  collector.adapters.nvd = async function* ({ http }) { await new Promise((resolve, reject) => http.signal.addEventListener('abort', () => reject(http.signal.reason), { once: true })); };
  const id = await collector.start(recipe);
  await assert.rejects(collector.moveDataset(id, chosen), /already active/);
  collector.stop(); await collector.running;
});
