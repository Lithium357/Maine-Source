import { XMLParser } from 'fast-xml-parser';
import { normalizeLicense } from './policy.mjs';
import { sourceCollectors } from './sources/registry.mjs';

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false });
const arr = value => !value ? [] : Array.isArray(value) ? value : [value];
export const plain = value => String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  return Object.entries(value || {}).filter(([key]) => !key.startsWith('@')).map(([, val]) => textOf(val)).join('\n');
}
function findLicenseURL(value) {
  if (typeof value === 'string') return value.match(/https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[^\s<>"']+/i)?.[0];
  for (const child of Object.values(value || {})) { const found = findLicenseURL(child); if (found) return found; }
}
const url = (base, params) => { const result = new URL(base); for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') result.searchParams.set(key, String(value)); return result.href; };
const declaration = (expression, evidence, scope = 'record', extra = {}) => ({ expression: normalizeLicense(expression), url: evidence, scope, basis: 'source-declaration', ...extra });
const unknown = () => ({ expression: null, basis: 'unknown', scope: 'record' });
const githubHeaders = key => ({ ...(key ? { Authorization: `Bearer ${key}` } : {}), 'X-GitHub-Api-Version': '2026-03-10' });

async function* nvd({ input, key, http }) {
  for (let start = 0;;) {
    const page = await http.get(url('https://services.nvd.nist.gov/rest/json/cves/2.0', { resultsPerPage: 100, startIndex: start, keywordSearch: input || undefined }), { headers: key ? { apiKey: key } : {}, interval: key ? 650 : 6500 });
    for (const { cve } of page.vulnerabilities || []) yield { id: cve.id, title: cve.id, text: (cve.descriptions || []).filter(d => d.lang === 'en').map(d => d.value).join('\n'), url: `https://nvd.nist.gov/vuln/detail/${cve.id}`, version: cve.lastModified, rights: unknown(), attribution: cve.sourceIdentifier, metadata: { weaknesses: cve.weaknesses, references: cve.references } };
    start += page.vulnerabilities?.length || 0;
    if (!page.vulnerabilities?.length || start >= page.totalResults) break;
  }
}
async function* cisa({ input, http }) {
  const page = await http.get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json');
  for (const v of page.vulnerabilities || []) {
    const text = `${v.shortDescription}\nRequired action: ${v.requiredAction}\n${v.notes || ''}`;
    if (input && !`${v.vulnerabilityName} ${text}`.toLowerCase().includes(input.toLowerCase())) continue;
    yield { id: v.cveID, title: `${v.cveID}: ${v.vulnerabilityName}`, text, url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', version: page.catalogVersion, rights: unknown(), attribution: 'CISA', metadata: { dateAdded: v.dateAdded, vendor: v.vendorProject } };
  }
}
async function* nasa({ input, key, http }) {
  const start = input ? new Date(`${input}T00:00:00Z`) : new Date(Date.now() - 30 * 86400000);
  if (!Number.isFinite(start.getTime())) throw new Error('NASA start date must use YYYY-MM-DD');
  const today = new Date().toISOString().slice(0, 10);
  if (start.toISOString().slice(0, 10) > today) throw new Error('NASA start date cannot be in the future');
  for (const day = new Date(start); day.toISOString().slice(0, 10) <= today; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    const page = await http.get(url('https://science.nasa.gov/wp-json/wp/v2/apod-basic/', { date, api_key: key || 'DEMO_KEY' }), { interval: key ? 4000 : 125000 });
    for (const item of arr(page)) yield { id: item.post_id || date, title: item.title, text: item.explanation, url: item.permalink || item.url, version: item.date, rights: { ...unknown(), notes: item.copyright ? `Copyright notice supplied for APOD media: ${item.copyright}. Text-specific reuse terms have not been established.` : 'No text-specific reuse license supplied by this response.' }, attribution: item.credit || 'NASA APOD' };
  }
}
async function* github({ input, key, http, settings = {} }) {
  const repositories = String(input || '').split(/[\n,]/).map(s => s.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')).filter(Boolean);
  if (!repositories.length || repositories.some(repo => !/^[\w.-]+\/[\w.-]+$/.test(repo))) throw new Error('GitHub needs repository names in owner/repo format, one per line');
  const headers = githubHeaders(key);
  const extensions = String(settings.extensions || '.py,.js,.ts,.tsx,.rs,.go,.c,.cpp,.h,.java,.md,.txt').split(',').map(s => s.trim().toLowerCase());
  for (const repo of repositories) {
    const root = `https://api.github.com/repos/${repo}`;
    const meta = await http.get(root, { headers, interval: 1200 });
    if (meta.private) throw new Error('This connector collects public repositories only');
    const commit = await http.get(`${root}/commits/${encodeURIComponent(meta.default_branch)}`, { headers, interval: 1200 });
    const repoExpression = normalizeLicense(meta.license?.spdx_id);
    const tree = await http.get(`${root}/git/trees/${commit.sha}?recursive=1`, { headers, interval: 1200 });
    if (tree.truncated) throw new Error(`${repo}: GitHub returned a truncated tree; choose a smaller repository`);
    for (const file of tree.tree || []) {
      if (file.type !== 'blob' || file.mode === '120000' || file.size > 1000000 || !extensions.some(ext => file.path.toLowerCase().endsWith(ext))) continue;
      if (/(^|\/)(node_modules|vendor|dist|build|\.git)(\/|$)/.test(file.path)) continue;
      const blob = await http.get(`${root}/git/blobs/${file.sha}`, { headers, interval: 1200 });
      if (blob.encoding !== 'base64') continue;
      const buffer = Buffer.from(blob.content, 'base64');
      if (buffer.includes(0)) continue;
      const text = buffer.toString('utf8');
      const notice = text.match(/SPDX-License-Identifier:\s*([^\r\n]+)/)?.[1]?.replace(/\s*(?:\*\/|-->|#)\s*$/, '').trim();
      const fileUrl = `https://github.com/${repo}/blob/${commit.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
      const expression = normalizeLicense(notice) || repoExpression;
      yield { id: `${repo}/${file.path}@${commit.sha}`, title: `${repo} / ${file.path}`, text, url: fileUrl, version: commit.sha, attribution: repo, rights: expression ? declaration(expression, notice ? fileUrl : `https://github.com/${repo}/tree/${commit.sha}`, notice ? 'file' : 'repository', { basis: notice ? 'content-notice' : 'source-declaration', corroborated: Boolean(notice && repoExpression === expression), conflict: Boolean(notice && repoExpression && repoExpression !== expression) }) : unknown(), metadata: { path: file.path, blob: file.sha, repository: repo } };
    }
  }
}
async function* stackexchange({ input, key, http, settings = {} }) {
  const site = settings.site || 'stackoverflow';
  if (!/^[a-z.]+$/.test(site)) throw new Error('Invalid Stack Exchange site');
  for (let page = 1;;page++) {
    const data = await http.get(url('https://api.stackexchange.com/2.3/questions', { site, page, pagesize: 100, order: 'desc', sort: 'activity', tagged: input, filter: 'withbody', key: key || undefined }), { interval: 1100 });
    if (data.error_message) throw new Error(`Stack Exchange: ${data.error_message}`);
    for (const item of data.items || []) yield { id: `${site}/${item.question_id}`, title: plain(item.title), text: plain(item.body), url: item.link, version: String(item.last_edit_date || item.creation_date), attribution: `${item.owner?.display_name || 'Unknown author'} (${item.owner?.link || ''})`, rights: item.content_license ? declaration(item.content_license, item.link) : unknown(), metadata: { tags: item.tags, score: item.score } };
    if (data.backoff) await http.wait(data.backoff * 1000);
    if (!data.has_more || data.quota_remaining === 0) break;
  }
}
async function* wikipedia({ input, http, settings = {} }) {
  if (!input) throw new Error('Wikipedia needs a search topic');
  const lang = settings.language || 'en';
  if (!/^[a-z-]{2,12}$/.test(lang)) throw new Error('Invalid Wikipedia language code');
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const site = await http.get(url(base, { action: 'query', meta: 'siteinfo', siprop: 'rightsinfo', format: 'json' }));
  let continuation = {};
  do {
    const page = await http.get(url(base, { action: 'query', generator: 'search', gsrsearch: input, gsrlimit: 20, prop: 'info|revisions', inprop: 'url', rvprop: 'ids|timestamp', format: 'json', ...continuation }));
    if (page.error) throw new Error(`Wikipedia: ${page.error.info}`);
    for (const item of Object.values(page.query?.pages || {})) {
      // Whole-article extracts are limited to one article per request by MediaWiki.
      const content = await http.get(url(base, { action: 'query', pageids: item.pageid, prop: 'extracts|revisions', explaintext: 1, rvprop: 'ids|timestamp', format: 'json' }));
      const current = content.query?.pages?.[item.pageid];
      yield { id: item.pageid, title: item.title, text: current?.extract, url: item.fullurl, version: String(current?.revisions?.[0]?.revid || ''), attribution: `Wikipedia contributors; history: ${item.fullurl}?action=history`, rights: declaration(site.query?.rightsinfo?.url, site.query?.rightsinfo?.url, 'source'), metadata: { language: lang } };
    }
    continuation = page.continue;
  } while (continuation);
}
async function* wikidata({ input, http }) {
  if (!input) throw new Error('Wikidata needs a search term');
  for (let offset = 0;;) {
    const page = await http.get(url('https://www.wikidata.org/w/api.php', { action: 'wbsearchentities', search: input, language: 'en', limit: 50, continue: offset, format: 'json' }));
    for (const item of page.search || []) yield { id: item.id, title: item.label, text: `${item.label}\n${item.description || ''}\n${(item.aliases || []).join(', ')}`, url: `https://www.wikidata.org/wiki/${item.id}`, rights: declaration('CC0-1.0', 'https://www.wikidata.org/wiki/Wikidata:Licensing', 'source'), attribution: 'Wikidata contributors' };
    if (page['search-continue'] === undefined) break;
    offset = page['search-continue'];
  }
}
async function* europepmc({ input, http }) {
  if (!input) throw new Error('Europe PMC needs a search query');
  let cursor = '*';
  do {
    const page = await http.get(url('https://www.ebi.ac.uk/europepmc/webservices/rest/search', { query: `(${input}) AND OPEN_ACCESS:Y AND IN_EPMC:Y`, resultType: 'core', format: 'json', pageSize: 25, cursorMark: cursor }));
    const items = page.resultList?.result || [];
    for (const item of items) {
      if (!item.pmcid) continue;
      const body = await http.get(`https://www.ebi.ac.uk/europepmc/webservices/rest/${item.pmcid}/fullTextXML`, { json: false, interval: 500 });
      const article = xml.parse(body).article;
      if (!article) continue;
      const license = arr(article.front?.['article-meta']?.permissions?.license)[0];
      const licenseUrl = license?.['@xlink:href'] || license?.['@href'] || findLicenseURL(license);
      const recordUrl = `https://europepmc.org/articles/${item.pmcid}`;
      yield { id: item.pmcid, title: item.title, text: plain(textOf(article.body)), url: recordUrl, version: item.firstPublicationDate, attribution: item.authorString, rights: declaration(licenseUrl || item.license, licenseUrl || recordUrl, 'record', { basis: license ? 'content-notice' : 'source-declaration', corroborated: Boolean(licenseUrl && normalizeLicense(licenseUrl) === normalizeLicense(item.license)) }), metadata: { doi: item.doi, publicationDate: item.firstPublicationDate } };
    }
    if (!items.length || !page.nextCursorMark || page.nextCursorMark === cursor) break;
    cursor = page.nextCursorMark;
  } while (cursor);
}
async function* crossref({ input, http }) {
  if (!input) throw new Error('Crossref needs a research topic');
  let cursor = '*';
  do {
    const page = await http.get(url('https://api.crossref.org/works', { query: input, rows: 100, cursor, filter: 'has-abstract:true' }), { interval: 1100 });
    const items = page.message?.items || [];
    for (const item of items) yield { id: item.DOI, title: item.title?.[0], text: plain(item.abstract), url: item.URL, version: item.indexed?.['date-time'], rights: unknown(), attribution: (item.author || []).map(a => `${a.given || ''} ${a.family || ''}`.trim()).join(', '), metadata: { doi: item.DOI, paperLicenseDeclarations: item.license, note: 'Full-paper license declarations are not assumed to cover this abstract.' } };
    if (!items.length || !page.message['next-cursor'] || page.message['next-cursor'] === cursor) break;
    cursor = page.message['next-cursor'];
  } while (cursor);
}
async function* zenodo({ input, http }) {
  for (let page = 1;;page++) {
    const data = await http.get(url('https://zenodo.org/api/records', { q: input, size: 25, page }), { interval: 1100 });
    const items = data.hits?.hits || [];
    for (const item of items) yield { id: item.id, title: item.metadata?.title, text: [item.metadata?.title, plain(item.metadata?.description)].filter(Boolean).join('\n'), url: `https://zenodo.org/records/${item.id}`, version: item.updated, attribution: (item.metadata?.creators || []).map(c => c.name).join(', '), rights: declaration('CC0-1.0', 'https://developers.zenodo.org/#licenses', 'source'), metadata: { contentScope: 'record metadata only', attachedFileLicense: item.metadata?.license, doi: item.metadata?.doi } };
    if (items.length < 25) break;
  }
}
async function* huggingface({ input, key, http, settings = {} }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(input || '')) throw new Error('Hugging Face needs an owner/dataset identifier');
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const card = await http.get(`https://huggingface.co/api/datasets/${input}`, { headers });
  const splits = await http.get(url('https://datasets-server.huggingface.co/splits', { dataset: input }), { headers });
  const chosen = splits.splits?.find(s => (!settings.config || s.config === settings.config) && (!settings.split || s.split === settings.split));
  if (!chosen) throw new Error('Dataset configuration/split is unavailable in the Dataset Viewer');
  const rawLicense = card.cardData?.license;
  const declared = Array.isArray(rawLicense) ? (rawLicense.length === 1 ? rawLicense[0] : null) : rawLicense;
  for (let offset = 0;; offset += 100) {
    const page = await http.get(url('https://datasets-server.huggingface.co/rows', { dataset: input, config: chosen.config, split: chosen.split, offset, length: 100 }), { headers });
    for (const item of page.rows || []) {
      const fields = settings.textField ? [settings.textField] : Object.keys(item.row || {}).filter(k => typeof item.row[k] === 'string');
      const strings = fields.map(k => typeof item.row[k] === 'string' ? item.row[k] : '').filter(Boolean);
      const recordUrl = `https://huggingface.co/datasets/${input}`;
      yield { id: `${input}/${chosen.config}/${chosen.split}/${item.row_idx}`, title: `${input} · row ${item.row_idx}`, text: strings.join('\n'), url: recordUrl, version: card.sha, attribution: input, rights: declaration(declared, `${recordUrl}/blob/${card.sha || 'main'}/README.md`, 'repository'), metadata: { config: chosen.config, split: chosen.split, row: item.row_idx, fields, declaredLicenses: rawLicense } };
    }
    if (!page.rows?.length || offset + page.rows.length >= page.num_rows_total) break;
  }
}
async function* govinfo({ input, key, http }) {
  if (!key) throw new Error('GovInfo requires an api.data.gov key');
  const collection = input || 'BILLS';
  if (!/^[A-Z0-9]+$/.test(collection)) throw new Error('GovInfo needs an uppercase collection code');
  let next = url(`https://api.govinfo.gov/collections/${collection}/2000-01-01T00:00:00Z`, { pageSize: 100, offsetMark: '*', api_key: key });
  while (next) {
    if (new URL(next).origin !== 'https://api.govinfo.gov') throw new Error('Unexpected GovInfo pagination host');
    const data = await http.get(next, { interval: 4000 });
    for (const item of data.packages || []) {
      const meta = await http.get(url(`https://api.govinfo.gov/packages/${encodeURIComponent(item.packageId)}/summary`, { api_key: key }), { interval: 4000 });
      const text = await http.get(url(`https://api.govinfo.gov/packages/${encodeURIComponent(item.packageId)}/htm`, { api_key: key }), { json: false, interval: 4000 });
      yield { id: item.packageId, title: item.title, text: plain(text), url: `https://www.govinfo.gov/app/details/${item.packageId}`, version: item.lastModified, rights: unknown(), attribution: meta.governmentAuthor1 || 'GovInfo', metadata: { collection } };
    }
    next = data.nextPage;
    if (next) { const p = new URL(next); p.searchParams.set('api_key', key); next = p.href; }
  }
}
export const connectors = { nvd, cisa, nasa, github, stackexchange, wikipedia, wikidata, europepmc, crossref, zenodo, huggingface, govinfo, ...sourceCollectors };
