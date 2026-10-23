import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { archiveText } from './content.mjs';
import { validateTextOutput } from './output-options.mjs';
import { containedFile } from './datasets.mjs';

export function transformText(text, options) {
  const settings = validateTextOutput(options);
  let result = String(text);
  if (settings.normalization !== 'none') result = result.normalize(settings.normalization);
  if (settings.newlines !== 'preserve') result = result.replace(/\r\n|\r|\n/g, settings.newlines === 'lf' ? '\n' : '\r\n');
  return result;
}
export function encodeText(text, options, { first = false } = {}) {
  const settings = validateTextOutput(options);
  if (!text.isWellFormed()) throw new Error('Text contains unpaired Unicode surrogates; cannot encode it losslessly');
  let body;
  if (settings.encoding === 'utf8') body = Buffer.from(text, 'utf8');
  else if (settings.encoding.startsWith('utf16')) { body = Buffer.from(text, 'utf16le'); if (settings.encoding === 'utf16be') body.swap16(); }
  else {
    let count = 0; for (const character of text) count++;
    body = Buffer.alloc(count * 4); let offset = 0;
    for (const character of text) { body[settings.encoding === 'utf32le' ? 'writeUInt32LE' : 'writeUInt32BE'](character.codePointAt(0), offset); offset += 4; }
  }
  const bom = first && (settings.bom === 'always' || settings.bom === 'auto' && settings.encoding !== 'utf8');
  if (!bom) return body;
  const prefix = { utf8: [0xef, 0xbb, 0xbf], utf16le: [0xff, 0xfe], utf16be: [0xfe, 0xff], utf32le: [0xff, 0xfe, 0, 0], utf32be: [0, 0, 0xfe, 0xff] }[settings.encoding];
  return Buffer.concat([Buffer.from(prefix), body]);
}
export function attachmentPath(root, relative) {
  if (typeof relative !== 'string' || !/^assets\/[0-9]{8}\/[a-zA-Z0-9._-]+$/.test(relative)) throw new Error('Invalid saved attachment path');
  return path.join(root, relative);
}
export async function latexSources(record, runRoot) {
  const sources = []; let bytes = 0;
  for (const file of record.attachments || []) {
    const name = file.filename || '';
    if (!/\.(tex|gz|tgz|tar|zip)$/i.test(name)) continue;
    attachmentPath(runRoot, file.path);
    const data = await readFile(await containedFile(runRoot, file.path));
    let members;
    if (/\.tex$/i.test(name)) members = [{ name, text: decodeSource(data) }];
    else if (/\.zip$/i.test(name)) {
      const { unzipSync } = await import('fflate'); let size = 0;
      const files = unzipSync(data, { filter(file) {
        if (!/\.tex$/i.test(file.name)) return false;
        size += file.originalSize; if (size > 100 * 1024 * 1024) throw new Error('LaTeX archive text exceeds export size limit');
        return true;
      } });
      members = Object.entries(files).map(([name, data]) => ({ name, text: decodeSource(Buffer.from(data)) }));
    } else {
      members = archiveText(data, name, { decode: decodeSource, include: name => /\.tex$/i.test(name) });
      // Some paper endpoints return one gzipped .tex file rather than a tar bundle.
      // Identify the actual source syntax; never relabel arbitrary prose as LaTeX.
      members = members.flatMap(file => /\.tex$/i.test(file.name) ? [file] : file.name === name && /\\(?:documentclass\b|begin\{document\})/.test(file.text) ? [{ ...file, name: name.replace(/\.(?:tar\.gz|tgz|tar|gz)$/i, '') + '.tex' }] : []);
    }
    for (const member of members) {
      bytes += Buffer.byteLength(member.text); if (bytes > 100 * 1024 * 1024) throw new Error('LaTeX source exceeds export size limit');
      sources.push(member);
    }
  }
  return sources;
}
function decodeSource(data) {
  if (data.subarray(0, 4).equals(Buffer.from([0xff, 0xfe, 0, 0])) || data.subarray(0, 4).equals(Buffer.from([0, 0, 0xfe, 0xff]))) throw new Error('UTF-32 LaTeX input is not supported; preserve originals to retain its bytes');
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(data);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new Error('LaTeX source is not UTF-8/UTF-16; preserve originals to retain its bytes'); }
}
export async function renderText(record, options, runRoot) {
  const settings = validateTextOutput(options);
  if (settings.representation === 'latex') {
    const sources = await latexSources(record, runRoot);
    if (!sources.length) return null;
    // This is a corpus of source files, not a synthetic/compilable replacement document.
    return sources.map(source => `% === ${String(source.name).replace(/[\r\n]/g, ' ')} ===\n${source.text}`).join('\n\n') + '\n\n';
  }
  if (settings.representation === 'markdown') {
    const title = String(record.title || record.id || 'Document').replace(/[\r\n]/g, ' ').replace(/[\\`*_{}\[\]<>#]/g, '\\$&');
    let longest = 0; for (const run of record.text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `# ${title}\n\n${record.url ? `Source: ${record.url}\n\n` : ''}${fence}text\n${record.text}\n${fence}\n\n`;
  }
  return `${record.title || ''}\n${record.url || ''}\n\n${record.text}\n\n---\n\n`;
}
