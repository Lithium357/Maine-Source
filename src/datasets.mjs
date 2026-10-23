import path from 'node:path';
import { readFile, readdir, stat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';

export function jobFolder(root, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid dataset identifier');
  return path.join(root, id);
}
export async function containedFile(root, relative) {
  const base = await realpath(root), file = await realpath(path.join(root, relative));
  const inside = path.relative(base, file);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('File is outside this dataset');
  return file;
}
export async function recordFiles(root) { return (await readdir(path.join(root, 'records'))).filter(f => /^[0-9]{8}\.json$/.test(f)).sort(); }
export async function readRecord(root, file) {
  if (!/^[0-9]{8}\.json$/.test(file)) throw new Error('Invalid record filename');
  return JSON.parse(await readFile(await containedFile(root, `records/${file}`), 'utf8'));
}
export async function browseRecords(root, { query = '', source = '', license = '', status = '', offset = 0, limit = 25 } = {}) {
  if (![query, source, license, status].every(s => typeof s === 'string' && s.length <= 1000) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid dataset search');
  const rows = []; let total = 0; const needle = query.toLocaleLowerCase();
  for (const file of await recordFiles(root)) {
    const r = await readRecord(root, file);
    if (source && r.source !== source || license && (r.rights?.expression || 'Unknown') !== license || status && r.metadata?.contentStatus !== status) continue;
    if (needle && !`${r.title || ''}\n${r.text || ''}`.toLocaleLowerCase().includes(needle)) continue;
    if (total >= offset && rows.length < limit) rows.push({ file, title: r.title, source: r.source, license: r.rights?.expression || 'Unknown', status: r.metadata?.contentStatus, preview: String(r.text || '').slice(0, 300), characters: String(r.text || '').length });
    total++;
  }
  return { rows, total, offset, limit };
}
export async function recordDetail(root, file, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid text offset');
  const r = await readRecord(root, file), text = String(r.text || '');
  return { file, id: r.id, title: r.title, source: r.source, url: r.url, version: r.version, rights: r.rights, attribution: r.attribution, attachments: r.attachments, contentStatus: r.metadata?.contentStatus, contentFailures: r.metadata?.contentFailures, text: text.slice(offset, offset + 25000), offset, characters: text.length };
}
export async function validateDataset(root) {
  const result = { records: 0, attachments: 0, emptyText: 0, duplicateText: 0, unknownLicense: 0, extractionFailures: 0, issues: [] };
  const seen = new Set(); const issue = message => { if (result.issues.length < 100) result.issues.push(message); };
  for (const file of await recordFiles(root)) {
    let r; try { r = await readRecord(root, file); } catch (e) { issue(`${file}: ${e.message}`); continue; }
    result.records++;
    if (!String(r.text || '').trim()) result.emptyText++;
    if (!r.rights?.expression) result.unknownLicense++;
    result.extractionFailures += (r.metadata?.contentFailures?.length || 0) + (r.attachments || []).filter(a => a.extractionError).length;
    const hash = createHash('sha256').update(String(r.text || '').normalize('NFKC').replace(/\s+/g, ' ').trim()).digest('hex');
    if (r.text?.trim()) { if (seen.has(hash)) result.duplicateText++; seen.add(hash); }
    for (const a of r.attachments || []) {
      result.attachments++;
      try {
        if (!/^assets\/[0-9]{8}\/[a-zA-Z0-9._-]+$/.test(a.path)) throw new Error('Invalid attachment reference');
        const filename = await containedFile(root, a.path);
        if ((await stat(filename)).size !== a.bytes) throw new Error('File size differs from record');
        const digest = createHash('sha256'); for await (const part of createReadStream(filename)) digest.update(part);
        if (digest.digest('hex') !== a.sha256) throw new Error('SHA-256 mismatch');
      } catch (e) { issue(`${file} / ${a.filename}: ${e.message}`); }
    }
  }
  return result;
}
