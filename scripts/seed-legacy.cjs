// Run with the legacy installed Electron executable in RunAsNode mode, only on CI.
(async () => {
  const path = require('node:path'), fs = require('node:fs/promises'), { pathToFileURL } = require('node:url');
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Legacy fixture creation is restricted to disposable CI');
  const [installed, data] = process.argv.slice(2);
  const base = path.join(installed, 'resources', 'app.asar', 'src');
  const { Collector } = await import(pathToFileURL(path.join(base, 'engine.mjs')).href);
  const { defaultRecipe } = await import(pathToFileURL(path.join(base, 'catalog.mjs')).href);
  const c = new Collector({ root: path.join(data, 'datasets'), adapters: { cisa: async function* () {
    yield { id: 'legacy-data', title: 'Legacy 0.1.5 fixture', text: 'Saved by version 0.1.5: original data must survive installer upgrades. Unicode café 😀', rights: { expression: null } };
  } } });
  await c.init(); const id = await c.start({ ...defaultRecipe(), name: 'Legacy 0.1.5 fixture', sourceIds: ['cisa'], limits: { files: 1, minutes: 1, megabytes: 1 } }); await c.running;
  if (c.jobs[0].accepted !== 1) throw new Error('Legacy fixture failed');
  await fs.writeFile(path.join(data, 'legacy-fixture-id.txt'), id);
})().catch(e => { console.error(e); process.exitCode = 1; });
