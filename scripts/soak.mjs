// Replay public KEV rows in an isolated test workspace; never touches the user's datasets/keys.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Collector } from '../src/engine.mjs';
import { HttpClient } from '../src/http.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { validateDataset } from '../src/datasets.mjs';
const minutes = Number(process.argv.find(a => a.startsWith('--minutes='))?.split('=')[1] || 120);
if (!Number.isFinite(minutes) || minutes < 0.01 || minutes > 240) throw new Error('Soak minutes must be 0.01–240');
const live = process.argv.includes('--live');
const rows = live ? (await new HttpClient({ signal: AbortSignal.timeout(30000) }).get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json')).vulnerabilities : [{ cveID: 'TEST-1', vulnerabilityName: 'Synthetic replay fixture', shortDescription: 'Engineering content used only for an isolated synthetic reliability test.' }];
assert.ok(rows?.length);
await mkdir('.test-data', { recursive: true });
const root = await mkdtemp(path.resolve('.test-data', 'soak-'));
const start = Date.now(), deadline = start + minutes * 60000;
const metrics = { root, input: live ? 'Public CISA KEV rows replayed with unique test IDs' : 'Synthetic fixture', requestedMinutes: minutes, restarts: 0, simulatedOutages: 0, maxRSS: 0, maxStopMs: 0, progress: [] };
let nextStop = 2000, nextOutage = 1500, stopAt, id;
const adapter = async function* ({ http, resume = {}, checkpoint }) {
  for (let index = resume.offset || 0; Date.now() < deadline; index++) {
    if (index >= nextOutage) { nextOutage += 1500; metrics.simulatedOutages++; throw new Error('Injected source outage for recovery verification'); }
    await http.wait(200);
    const original = rows[index % rows.length];
    yield { id: `${original.cveID}:test-replay-${index}`, title: original.vulnerabilityName, text: original.shortDescription, version: `replay-${index}`, rights: { expression: null }, contentRequests: [{ data: JSON.stringify(original), filename: 'kev.json', mediaType: 'application/json' }], metadata: { original, soakReplay: true } };
    await checkpoint({ offset: index + 1 });
  }
};
function collector() {
  const c = new Collector({ root, adapters: { cisa: adapter }, onChange() {
    if (c.active?.job.accepted >= nextStop) { nextStop += 2000; stopAt = Date.now(); c.stop(); }
  } }); return c;
}
let c = collector(); await c.init();
id = await c.start({ ...defaultRecipe(), name: 'Isolated reliability soak', sourceIds: ['cisa'], deduplicate: false, minLength: 0, limits: { files: 0, minutes: 0, megabytes: 1024 } });
const timer = setInterval(() => {
  metrics.maxRSS = Math.max(metrics.maxRSS, process.memoryUsage().rss);
  const progress = { elapsedSeconds: Math.round((Date.now() - start) / 1000), accepted: c.jobs[0]?.accepted || 0, rssMB: Math.round(process.memoryUsage().rss / 1048576) };
  metrics.progress.push(progress); console.log(JSON.stringify(progress));
}, 60000);
console.log(JSON.stringify({ root, minutes, input: metrics.input }));
try {
  do {
    await c.running;
    if (stopAt) { metrics.maxStopMs = Math.max(metrics.maxStopMs, Date.now() - stopAt); stopAt = undefined; }
    if (Date.now() >= deadline) break;
    assert.ok(['stopped', 'completed_with_errors'].includes(c.jobs[0].status), c.jobs[0].reason);
    c = collector(); await c.init(); metrics.restarts++;
    await c.resume(id);
  } while (Date.now() < deadline);
  if (c.active) { c.stop(); await c.running; }
  const report = await validateDataset(path.join(root, id)); assert.deepEqual(report.issues, []);
  assert.equal(report.records, c.jobs[0].accepted);
  const output = path.join(root, 'export.jsonl'); await c.exportTo(id, output);
  // Count records incrementally so the verifier does not buffer the whole exported dataset.
  const { createReadStream } = await import('node:fs'); const { createInterface } = await import('node:readline'); let count = 0;
  for await (const line of createInterface({ input: createReadStream(output) })) { JSON.parse(line); count++; }
  assert.equal(count, report.records); assert.ok(metrics.maxStopMs < 10000);
  metrics.elapsedSeconds = Math.round((Date.now() - start) / 1000); metrics.records = report.records; metrics.integrity = report; metrics.status = 'passed';
  await writeFile(path.join(root, 'soak-report.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
} catch (error) {
  c.stop(); await c.running; metrics.status = 'failed'; metrics.error = error.message;
  await writeFile(path.join(root, 'soak-report.json'), JSON.stringify(metrics, null, 2)); throw error;
} finally { clearInterval(timer); }
