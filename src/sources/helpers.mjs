// Browser-safe helpers: source definitions are also loaded by the renderer.
export const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
export const plain = value => String(value ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export const unknown = () => ({ expression: null, basis: 'unknown', scope: 'record' });
export const rights = (expression, url, scope = 'record') => expression ? { expression, url, scope, basis: 'source-declaration' } : unknown();
export function endpoint(base, params = {}) {
  const result = new URL(base);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') result.searchParams.set(key, String(value));
  return result.href;
}
export function httpsURL(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Enter a complete HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Use HTTPS without embedded credentials or fragments');
  return parsed;
}
export function portalURL(value) {
  const parsed = httpsURL(value);
  if (parsed.search) throw new Error('Portal URLs cannot contain query parameters');
  return parsed.href.replace(/\/$/, '');
}
export function numberSetting(value, fallback, min, max, label) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return n;
}
export function dateSetting(value, fallback, label) {
  const date = value || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  return date;
}
export async function parseXML(text) {
  const { XMLParser } = await import('fast-xml-parser');
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false }).parse(text);
}
