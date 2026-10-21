import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { storagePaths, prepareStorage } from '../src/storage.mjs';
import { Collector } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';

async function locations() {
  const parent = path.resolve('.test-data'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'storage-'));
  return { desktop: path.join(root, 'OneDrive - Example', 'Desktop'), userData: path.join(root, 'AppData', 'Maine Source') };
}
test('uses the actual OS Desktop location, including redirection and spaces', async () => {
  const folders = await locations(); const paths = await prepareStorage(folders);
  assert.equal(paths.data, path.join(folders.desktop, 'data', 'Maine-Source'));
  assert.equal((await stat(paths.datasets)).isDirectory(), true);
  assert.equal((await stat(paths.exports)).isDirectory(), true);
  await prepareStorage(folders);
});
test('rejects relative paths instead of writing into the install directory', () => { assert.throws(() => storagePaths({ desktop: 'Desktop', userData: 'AppData' }), /absolute/); });
test('leaves unrelated Desktop data files unchanged', async () => {
  const folders = await locations(); const folder = path.join(folders.desktop, 'data'); await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'personal-notes.txt'), 'keep me'); await prepareStorage(folders);
  assert.equal(await readFile(path.join(folder, 'personal-notes.txt'), 'utf8'), 'keep me');
});
test('copies old datasets while leaving originals and credentials in app storage', async () => {
  const folders = await locations(); const old = path.join(folders.userData, 'datasets'); await mkdir(path.join(old, 'example-job', 'records'), { recursive: true });
  await writeFile(path.join(old, 'jobs.json'), '[]'); await writeFile(path.join(old, 'example-job', 'records', '00000001.json'), '{"text":"kept"}');
  await writeFile(path.join(folders.userData, 'credentials.json'), 'private');
  const paths = await prepareStorage(folders);
  assert.equal(await readFile(path.join(paths.datasets, 'example-job', 'records', '00000001.json'), 'utf8'), '{"text":"kept"}');
  assert.equal(await readFile(path.join(old, 'jobs.json'), 'utf8'), '[]');
  assert.ok(!(await readdir(paths.data)).includes('credentials.json'));
  assert.equal(await readFile(path.join(folders.userData, 'credentials.json'), 'utf8'), 'private');
});
test('an existing Desktop dataset is never overwritten by legacy data', async () => {
  const folders = await locations(); const paths = storagePaths(folders);
  await mkdir(paths.datasets, { recursive: true }); await mkdir(paths.legacyDatasets, { recursive: true });
  await writeFile(path.join(paths.datasets, 'jobs.json'), '["current"]'); await writeFile(path.join(paths.legacyDatasets, 'jobs.json'), '["old"]');
  await prepareStorage(folders); assert.equal(await readFile(path.join(paths.datasets, 'jobs.json'), 'utf8'), '["current"]');
});
test('a collection writes records and exports beneath Desktop/data and survives restart', async () => {
  const paths = await prepareStorage(await locations());
  const collector = new Collector({ root: paths.datasets, adapters: { nvd: async function* () { yield { id: 'test', title: 'Engineering example', text: 'A sufficiently long engineering record used to verify the complete storage and export flow.', rights: { expression: 'CC0-1.0', basis: 'source-declaration', url: 'https://example.org/license', scope: 'record' } }; } } });
  await collector.init(); const id = await collector.start({ ...defaultRecipe(), sourceIds: ['nvd'], limits: { minutes: 1, megabytes: 1, files: 1 } }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 1);
  const output = path.join(paths.exports, 'engineering.jsonl'); await collector.exportTo(id, output);
  assert.equal(JSON.parse((await readFile(output, 'utf8')).trim()).rights.expression, 'CC0-1.0');
  assert.equal(JSON.parse(await readFile(output + '.manifest.json', 'utf8')).accepted, 1);
  const reopened = new Collector({ root: paths.datasets }); await reopened.init(); assert.equal(reopened.jobs[0].accepted, 1);
});
