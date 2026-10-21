// Optional live storage check. Creates a two-record CISA dataset on the Desktop.
const { app } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
  const { prepareStorage } = await import('../src/storage.mjs');
  const { Collector } = await import('../src/engine.mjs');
  const { defaultRecipe } = await import('../src/catalog.mjs');
  const paths = await prepareStorage({ desktop: app.getPath('desktop'), userData: path.join(app.getPath('appData'), require('../package.json').name) });
  const collector = new Collector({ root: paths.datasets }); await collector.init();
  const id = await collector.start({ ...defaultRecipe(), name: 'Desktop storage check — CISA', sourceIds: ['cisa'], strictness: 1, limits: { minutes: 1, megabytes: 1, files: 2 } });
  await collector.running;
  const job = collector.jobs.find(j => j.id === id);
  if (job.accepted !== 2 || job.status !== 'completed') throw new Error(job.reason || 'Expected two accepted records');
  const output = path.join(paths.exports, `storage-check-${id}.jsonl`); await collector.exportTo(id, output);
  const { readFile } = require('node:fs/promises');
  const rows = (await readFile(output, 'utf8')).trim().split('\n').map(JSON.parse);
  if (rows.length !== 2 || rows.some(row => row.source !== 'cisa')) throw new Error('Export verification failed');
  const reopened = new Collector({ root: paths.datasets }); await reopened.init();
  if (!reopened.jobs.some(j => j.id === id && j.accepted === 2)) throw new Error('Persisted job verification failed');
  console.log(JSON.stringify({ accepted: job.accepted, reason: job.reason, dataPath: paths.data, exportPath: output, verified: 'real API → Desktop records → JSONL export → reopened history' }));
  app.exit(0);
}).catch(error => { console.error(error.message); app.exit(1); });
