// Explicit packaged-runtime diagnostic. Writes only a new temporary child of the supplied folder.
exports.run = async function (parent) {
  const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
  const { pathToFileURL } = require('node:url');
  if (!parent || !path.isAbsolute(parent)) throw new Error('Self-test requires an absolute temporary parent folder');
  const root = await fs.mkdtemp(path.join(parent, 'maine-source-self-test-'));
  const load = name => import(pathToFileURL(path.join(__dirname, '..', 'src', name)).href);
  const [{ Collector }, { defaultRecipe }, { validateDataset }] = await Promise.all([load('engine.mjs'), load('catalog.mjs'), load('datasets.mjs')]);
  const c = new Collector({ root, adapters: { cisa: async function* () {
    yield { id: 'packaged-test', title: 'Packaged runtime test', text: 'Original document', contentRequests: [{ data: '<html><title>Installed runtime test</title><body><article><h1>Test manuscript</h1><p>Complete source text in the installed Windows application. Unicode: café 😀</p></article></body></html>', filename: 'source.html', mediaType: 'text/html' }] };
  } } });
  const chosen = path.join(root, 'chosen-downloads'), movedParent = path.join(root, 'moved-downloads');
  await fs.mkdir(chosen); await fs.mkdir(movedParent);
  await c.init(); const id = await c.start({ ...defaultRecipe(), downloadDirectory: chosen, name: 'Packaged runtime check', sourceIds: ['cisa'], limits: { files: 1, minutes: 1, megabytes: 5 } }); await c.running;
  assert.equal(c.jobs[0].accepted, 1); assert.equal(c.jobs[0].errors, 0);
  await c.moveDataset(id, movedParent);
  const validation = await validateDataset(await c.folder(id)); assert.deepEqual(validation.issues, []);
  const out = path.join(root, 'dataset.jsonl'); await c.exportTo(id, out);
  const record = JSON.parse((await fs.readFile(out, 'utf8')).trim()); assert.match(record.text, /café 😀/);
  assert.equal(record.attachments.length, 1);
  const reopened = new Collector({ root }); await reopened.init(); assert.equal(reopened.jobs[0].accepted, 1);
  assert.equal(await reopened.folder(id), path.join(movedParent, id));
  let legacyWorkspaceVerified = false;
  const legacyAt = process.argv.indexOf('--legacy-data');
  if (legacyAt >= 0) {
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Legacy workspace verification is restricted to disposable CI');
    const data = process.argv[legacyAt + 1], legacy = new Collector({ root: path.join(data, 'datasets') }); await legacy.init();
    assert.equal(legacy.jobs[0].accepted, 1);
    const saved = JSON.parse(await fs.readFile(path.join(data, 'datasets', legacy.jobs[0].id, 'records', '00000001.json'), 'utf8'));
    assert.match(saved.text, /Saved by version 0.1.5/); assert.match(saved.text, /café 😀/); legacyWorkspaceVerified = true;
  }
  const result = { passed: true, appVersion: require('../package.json').version, node: process.versions.node, electron: process.versions.electron, root, validation, customDatasetLocationVerified: true, legacyWorkspaceVerified };
  await fs.writeFile(path.join(parent, 'maine-source-self-test.json'), JSON.stringify(result, null, 2));
};
