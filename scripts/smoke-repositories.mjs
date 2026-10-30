// Optional live check. Uses public endpoints, reads no saved credentials, and
// writes only a new child of the ignored .test-data directory.
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Collector } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { validateDataset } from '../src/datasets.mjs';

await mkdir('.test-data', { recursive: true });
const parent = await mkdtemp(path.resolve('.test-data/repository-live-'));
const cases = [
  { source: 'github', input: 'Lithium357/Maine-Source', settings: { downloadMode: 'archive', ref: 'main' }, files: 1 },
  { source: 'huggingface', input: 'databricks/databricks-dolly-15k', settings: { downloadMode: 'files', extensions: '.jsonl' }, files: 1 },
  { source: 'stackexchange', input: 'nlp', settings: { site: 'stackoverflow', sort: 'creation', order: 'asc' }, files: 2 },
];
let failures = 0;
for (const item of cases) {
  const collector = new Collector({ root: path.join(parent, item.source) });
  await collector.init();
  const id = await collector.start({ ...defaultRecipe(), name: `Live ${item.source}`, sourceIds: [item.source], inputs: { [item.source]: item.input }, settings: { [item.source]: item.settings }, limits: { files: item.files, minutes: 2, megabytes: 100 } });
  await collector.running;
  const job = collector.jobs.find(job => job.id === id);
  const folder = await collector.folder(id);
  const inspection = await validateDataset(folder);
  const record = job.accepted ? JSON.parse(await readFile(path.join(folder, 'records', '00000001.json'), 'utf8')) : null;
  const ok = job.accepted === item.files && job.errors === 0 && inspection.issues.length === 0 && inspection.extractionFailures === 0;
  if (!ok) failures++;
  console.log(JSON.stringify({ source: item.source, ok, accepted: job.accepted, errors: job.errors, version: record?.version, textCharacters: record?.text?.length, originalFiles: record?.attachments?.length, validation: inspection, folder }));
}
if (failures) process.exitCode = 1;
