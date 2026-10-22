import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { materialize, extractText, archiveText } from '../src/content.mjs';
import { Collector } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { connectors } from '../src/connectors.mjs';

function pdf(text) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
function tar(name, text) {
  const header = Buffer.alloc(512); header.write(name); header.write('0000644\0', 100); header.write(`${Buffer.byteLength(text).toString(8).padStart(11, '0')}\0`, 124); header[156] = 48; header.write('ustar', 257);
  return Buffer.concat([header, Buffer.from(text), Buffer.alloc((512 - Buffer.byteLength(text) % 512) % 512), Buffer.alloc(1024)]);
}
const base = () => ({ id: 'paper1', title: 'A paper', text: 'Abstract without the excluded word', rights: { expression: null }, contentRequests: [{ data: pdf('Full paper contains dogs and complete engineering results.'), filename: 'paper.pdf', mediaType: 'application/pdf' }, { data: gzipSync(tar('main.tex', '\\section{Results}\nComplete source manuscript.')), filename: 'source.tar.gz' }] });

test('full content extracts PDF text and LaTeX members and retains both originals', async () => {
  const record = await materialize(base(), {});
  assert.match(record.text, /Full paper contains dogs/); assert.match(record.text, /Complete source manuscript/);
  assert.equal(record.attachments.length, 2); assert.equal(record.metadata.contentStatus, 'downloaded'); assert.equal(record.attachments[0].data.subarray(0, 5).toString(), '%PDF-');
});
test('metadata-only collection is an explicit opt-in and makes no file request', async () => {
  const record = await materialize(base(), { binary() { throw new Error('Unexpected download'); } }, { contentMode: 'metadata' });
  assert.equal(record.text, base().text); assert.equal(record.attachments, undefined); assert.equal(record.contentRequests, undefined); assert.equal(record.metadata.contentStatus, 'metadata');
});
test('download failures cannot silently substitute an abstract for full text', async () => {
  await assert.rejects(materialize({ ...base(), contentRequests: [{ url: 'https://example.org/paper.pdf', filename: 'paper.pdf' }] }, { binary() { throw new Error('HTTP 403'); } }), /Underlying content unavailable/);
});
test('partial records retain originals and name unavailable components', async () => {
  const record = base(); record.contentRequests.push({ filename: 'supplement.zip', error: 'Not publicly accessible' });
  const result = await materialize(record, {}); assert.equal(result.metadata.contentStatus, 'partial'); assert.equal(result.metadata.contentFailures[0].file, 'supplement.zip');
});
test('download URLs retained in provenance do not contain credentials', async () => {
  const record = await materialize({ ...base(), contentRequests: [{ url: 'https://example.org/data.txt?api_key=secret&revision=1', filename: 'data.txt' }] }, { async binary() { return { data: Buffer.from('Underlying dataset body'), mediaType: 'text/plain' }; } });
  assert.doesNotMatch(record.attachments[0].url, /secret|api_key/); assert.match(record.attachments[0].url, /revision=1/);
});
test('HTML full-text extraction never runs scripts or retrieves resources', async () => {
  const text = '<html><head><title>Article</title><script>throw new Error("must not execute")</script></head><body><article><h1>Article</h1><p>Complete substantive article body with original engineering results and observations.</p></article><img src="https://example.org/tracker"></body></html>';
  const result = await extractText(Buffer.from(text), 'article.html', 'text/html'); assert.match(result.text, /substantive article/); assert.doesNotMatch(result.text, /must not execute/);
});
test('archives never extract member paths onto the filesystem and enforce size checks', () => {
  const files = archiveText(gzipSync(tar('../../escape.tex', 'Source text'))); assert.equal(files[0].text, 'Source text');
  const invalid = tar('main.tex', 'x'); invalid.write('77777777777\0', 124); assert.throws(() => archiveText(invalid), /Invalid tar/);
});
test('non-PDF login/error pages are not saved as successful paper PDFs', async () => {
  await assert.rejects(materialize({ ...base(), contentRequests: [{ url: 'https://example.org/file', filename: 'paper.pdf' }] }, { async binary() { return { data: Buffer.from('<html>Sign in</html>'), mediaType: 'text/html' }; } }), /non-PDF/);
});
test('cancelling extraction terminates its subprocess promptly', async () => {
  const controller = new AbortController(); const started = Date.now();
  const pending = extractText(pdf('A complete paper'), 'paper.pdf', 'application/pdf', { signal: controller.signal });
  controller.abort(new Error('Stopped by user')); await assert.rejects(pending, /Stopped by user/); assert.ok(Date.now() - started < 3000);
});
async function setup() {
  await mkdir('.test-data', { recursive: true }); const root = await mkdtemp(path.resolve('.test-data', 'content-'));
  const collector = new Collector({ root, adapters: { arxiv: async function* () { yield base(); } } }); await collector.init(); return { root, collector };
}
test('collector filters full paper text rather than just its abstract', async () => {
  const { collector } = await setup(); await collector.start({ ...defaultRecipe(), sourceIds: ['arxiv'], blacklist: 'dogs' }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 0); assert.equal(collector.jobs[0].outcomes.keyword, 1);
});
test('storage budget counts original files and rejected records leave no assets', async () => {
  const { root, collector } = await setup(); const id = await collector.start({ ...defaultRecipe(), sourceIds: ['arxiv'], limits: { minutes: 1, megabytes: 0.0001, files: 1 } }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 0); assert.match(collector.jobs[0].reason, /Storage limit/); assert.deepEqual(await readdir(path.join(root, id)), ['manifest.json', 'records']);
});
test('record storage and portable exports preserve originals, hashes, and relative paths', async () => {
  const { root, collector } = await setup(); const id = await collector.start({ ...defaultRecipe(), sourceIds: ['arxiv'], limits: { minutes: 1, megabytes: 10, files: 1 } }); await collector.running;
  assert.equal(collector.jobs[0].accepted, 1); const saved = JSON.parse(await readFile(path.join(root, id, 'records/00000001.json')));
  assert.equal(saved.attachments.length, 2); assert.equal(saved.attachments[0].sha256.length, 64); assert.equal(saved.attachments[0].data, undefined);
  const actualBytes = (await stat(path.join(root, id, 'records/00000001.json'))).size + saved.attachments.reduce((n, a) => n + a.bytes, 0); assert.equal(collector.jobs[0].bytes, actualBytes);
  const destination = path.join(root, 'export.jsonl'); await collector.exportTo(id, destination); const exported = JSON.parse((await readFile(destination, 'utf8')).trim());
  for (const attachment of exported.attachments) assert.equal((await stat(path.join(root, attachment.path))).size, attachment.bytes);
});
test('Dataverse follows dataset version and downloads original public files', async () => {
  let calls = 0; const it = connectors.dataverse({ input: 'energy', settings: {}, http: { async get() { calls++; return calls === 1 ? { status: 'OK', data: { total_count: 1, items: [{ global_id: 'doi:10.1/test', name: 'Study', authors: [] }] } } : { status: 'OK', data: { latestVersion: { versionNumber: 2, versionMinorNumber: 1, files: [{ dataFile: { id: 9, filename: 'measurements.csv' } }] } } }; } } });
  const { value } = await it.next(); assert.equal(value.version, '2.1'); assert.match(value.contentRequests[0].url, /datafile\/9\?format=original/); await it.return();
});
