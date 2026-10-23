import { HttpClient, redactSecrets } from './http.mjs';

// Fixed, read-only probes. Never accept a renderer-supplied URL or return provider
// account information, response bodies, credentials, or credential-bearing URLs.
export async function checkConnection(id, key, { http = new HttpClient({ signal: AbortSignal.timeout(20000) }) } = {}) {
  if (typeof key !== 'string' || !key.trim() || key.length > 4096) throw new Error('Save a credential before testing it');
  key = key.trim();
  const bearer = { Authorization: `Bearer ${key}` };
  const query = (address, values) => { const u = new URL(address); for (const [k, v] of Object.entries(values)) u.searchParams.set(k, v); return u.href; };
  const probes = {
    github: ['https://api.github.com/user', { headers: { ...bearer, 'X-GitHub-Api-Version': '2026-03-10' } }, d => typeof d?.login === 'string', true],
    advisories: ['https://api.github.com/user', { headers: { ...bearer, 'X-GitHub-Api-Version': '2026-03-10' } }, d => typeof d?.login === 'string', true],
    huggingface: ['https://huggingface.co/api/whoami-v2', { headers: bearer }, d => typeof d?.name === 'string', true],
    nvd: ['https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=1', { headers: { apiKey: key } }, d => Array.isArray(d?.vulnerabilities)],
    nasa: [query('https://science.nasa.gov/wp-json/wp/v2/apod-basic/', { date: '2026-09-11', api_key: key }), {}, d => Array.isArray(d) && d.some(x => typeof x?.explanation === 'string')],
    stackexchange: [query('https://api.stackexchange.com/2.3/info', { site: 'stackoverflow', key }), {}, d => !d?.error_id && Array.isArray(d?.items)],
    govinfo: [query('https://api.govinfo.gov/collections', { api_key: key }), {}, d => Array.isArray(d?.collections)],
    openalex: [query('https://api.openalex.org/works', { per_page: 1, api_key: key }), {}, d => Array.isArray(d?.results)],
  };
  if (!Object.hasOwn(probes, id)) throw new Error('This source has no credential test');
  const [address, options, valid, identity] = probes[id];
  try {
    const data = await http.get(address, { ...options, maxBytes: 2 * 1024 * 1024, timeoutMs: 20000 });
    if (!valid(data)) throw new Error('Provider did not return the expected successful response');
    return { ok: true, checkedAt: new Date().toISOString(), message: identity ? 'Credential authenticated. This does not verify access to every repository, dataset, or full-content download.' : 'Provider accepted a small read request with this key. Public endpoints can ignore keys; this does not establish key validity, quota, or access to every download.' };
  } catch (error) {
    return { ok: false, checkedAt: new Date().toISOString(), message: redactSecrets(error.message, [key]) };
  }
}
