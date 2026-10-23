import { sources } from './catalog.mjs';
import { open } from 'node:fs/promises';

export const credentialSchema = 'maine-source.credentials.v1';
export function parseCredentials(input) {
  let data = input;
  if (typeof data === 'string') {
    if (Buffer.byteLength(data) > 65536) throw new Error('Credential JSON exceeds 64 KiB');
    try { data = JSON.parse(data.replace(/^\uFEFF/, '')); } catch { throw new Error('Invalid credential JSON'); }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Credentials must be a JSON object');
  if (Object.hasOwn(data, 'keys')) {
    if (data.schema !== undefined && data.schema !== credentialSchema || Object.keys(data).some(k => !['schema', 'exportedAt', 'keys'].includes(k))) throw new Error('Unsupported credential file format');
    data = data.keys;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) throw new Error('Credential file contains no keys');
  const allowed = new Set(sources.filter(s => s.key).map(s => s.id)), result = {};
  for (const [id, value] of Object.entries(data)) {
    if (!allowed.has(id)) throw new Error('Credential file contains an unknown source ID');
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('Credential values must be nonempty single-line strings up to 4096 characters');
    result[id] = value.trim();
  }
  return result;
}
export function credentialBundle(keys) {
  return { schema: credentialSchema, exportedAt: new Date().toISOString(), keys: parseCredentials(keys) };
}
export async function readCredentialFile(filename) {
  const file = await open(filename, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536) throw new Error('Choose a regular credential JSON file under 64 KiB');
    const data = await file.readFile();
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error('Credential JSON must use UTF-8'); }
    return parseCredentials(text);
  } finally { await file.close(); }
}
