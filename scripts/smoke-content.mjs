// Optional live full-paper storage/export check. Reads no saved credentials.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Collector } from '../src/engine.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
import { archiveText } from '../src/content.mjs';

await mkdir('.test-data', { recursive: true });
const root = await mkdtemp(path.resolve('.test-data', 'live-paper-'));
const collector = new Collector({ root }); await collector.init();
const id = await collector.start({ ...defaultRecipe(), name: 'Live full arXiv paper verification', sourceIds: ['arxiv'], inputs: { arxiv: '1706.03762' }, limits: { minutes: 2, megabytes: 20, files: 1 } });
await collector.running;
const job = collector.jobs[0]; assert.equal(job.accepted, 1); assert.equal(job.errors, 0);
const record = JSON.parse(await readFile(path.join(root, id, 'records/00000001.json'), 'utf8'));
assert.equal(record.metadata.contentStatus, 'downloaded'); assert.equal(record.attachments.length, 2);
assert.ok(record.text.length > 20000); assert.match(record.text, /attention/i);
const pdf = record.attachments.find(a => a.role === 'paper');
assert.equal((await readFile(path.join(root, id, pdf.path))).subarray(0, 5).toString(), '%PDF-');
const source = record.attachments.find(a => a.role === 'submitted source');
assert.ok(archiveText(await readFile(path.join(root, id, source.path))).some(file => file.name.endsWith('.tex')));
const destination = path.join(root, 'paper.jsonl'); await collector.exportTo(id, destination);
const exported = JSON.parse((await readFile(destination, 'utf8')).trim());
for (const attachment of exported.attachments) assert.equal(createHash('sha256').update(await readFile(path.join(root, attachment.path))).digest('hex'), attachment.sha256);
console.log(JSON.stringify({ status: job.status, accepted: job.accepted, errors: job.errors, reason: job.reason, textCharacters: record.text.length, files: record.attachments.map(a => ({ filename: a.filename, bytes: a.bytes })), exportHashesVerified: true }));
