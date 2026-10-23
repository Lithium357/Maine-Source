import test from 'node:test';
import assert from 'node:assert/strict';
import { sources, presets, defaultRecipe } from '../src/catalog.mjs';
import { connectors } from '../src/connectors.mjs';
import { sourceModules } from '../src/sources/registry.mjs';
import { abstractText } from '../src/sources/openalex.mjs';

const collect = async (id, context) => { const records = []; for await (const item of connectors[id]({ settings: {}, ...context })) records.push(item); return records; };

test('every available online source has a handler and serializable metadata', () => {
  assert.equal(new Set(sources.map(s => s.id)).size, sources.length);
  for (const s of sources) {
    assert.match(s.id, /^[a-z][a-z0-9]*$/);
    if (!s.planned && s.id !== 'local') assert.equal(typeof connectors[s.id], 'function', s.id);
    const ids = new Set();
    for (const field of s.fields || []) {
      assert.match(field.id, /^[a-zA-Z][a-zA-Z0-9]*$/); assert.ok(field.label); assert.ok(!ids.has(field.id)); ids.add(field.id);
    }
  }
  assert.ok(sourceModules.every(s => !('collect' in sources.find(d => d.id === s.id))));
  assert.doesNotThrow(() => structuredClone(sources));
  for (const list of Object.values(presets)) for (const id of list) assert.ok(sources.some(s => s.id === id && !s.planned));
});
test('new recipes leave licensing decisions to the user', () => { assert.equal(defaultRecipe().licenseMode, 'off'); assert.equal(defaultRecipe().strictness, 1); });

test('GitHub advisories follow the Link cursor and retain vulnerability structure', async () => {
  let calls = 0;
  const records = await collect('advisories', { input: 'test', key: 'secret', http: { async get(address, options) {
    calls++; const u = new URL(address); assert.equal(u.searchParams.get('affects'), 'test'); assert.equal(options.headers.Authorization, 'Bearer secret');
    if (calls === 2) assert.equal(u.searchParams.get('after'), 'opaque-cursor');
    return { data: [{ ghsa_id: `GHSA-${calls}`, summary: 'Summary', description: 'Long vulnerability description', vulnerabilities: [{ package: { name: 'test' } }] }], headers: new Headers(calls === 1 ? { link: '<https://api.github.com/advisories?after=opaque-cursor>; rel="next"' } : {}) };
  } } });
  assert.equal(calls, 2); assert.equal(records[1].metadata.vulnerabilities[0].package.name, 'test'); assert.equal(records[0].rights.expression, 'CC-BY-4.0');
});
test('GitHub advisory pagination refuses unexpected hosts before reusing credentials', async () => {
  await assert.rejects(collect('advisories', { http: { async get() { return { data: [], headers: new Headers({ link: '<https://example.org/advisories?after=x>; rel="next"' }) }; } } }), /pagination URL/);
});
test('arXiv reads Atom and requests version-pinned PDF and submitted source', async () => {
  const records = await collect('arxiv', { input: 'cat:cs.CR', http: { async get(address, options) { assert.equal(options.interval, 3100); return '<feed><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/1234.5678v2</id><title> A paper </title><summary> An abstract about engineering. </summary><updated>2026-01-02</updated><author><name>Ada</name></author><category term="cs.CR"/></entry></feed>'; } } });
  assert.equal(records[0].text, 'An abstract about engineering.'); assert.equal(records[0].rights.expression, null); assert.match(records[0].url, /^https:/); assert.equal(records[0].contentRequests.length, 2); assert.match(records[0].contentRequests[0].url, /\/pdf\/1234.5678v2$/); assert.match(records[0].contentRequests[1].url, /\/src\/1234.5678v2$/);
});
test('arXiv query errors do not become dataset records', async () => {
  await assert.rejects(collect('arxiv', { input: 'bad', http: { async get() { return '<feed><entry><id>http://arxiv.org/api/errors#bad_query</id><summary>Invalid query</summary></entry></feed>'; } } }), /rejected the query/);
});
test('OpenAlex reconstructs inverted abstracts and follows cursors', async () => {
  assert.equal(abstractText({ safety: [1, 3], memory: [0, 2] }), 'memory safety memory safety');
  let calls = 0;
  const rows = await collect('openalex', { input: 'memory', http: { async get(address) {
    calls++; assert.equal(new URL(address).searchParams.get('cursor'), calls === 1 ? '*' : 'next');
    return { results: calls === 1 ? [{ id: 'https://openalex.org/W1', display_name: 'Memory', abstract_inverted_index: { memory: [0], safety: [1] } }] : [], meta: { next_cursor: 'next' } };
  } } });
  assert.equal(rows.length, 1); assert.equal(calls, 2); assert.equal(rows[0].text, 'memory safety');
});
test('CKAN metadata keeps dataset license separate and rejects API success:false', async () => {
  const rows = await collect('ckan', { input: 'energy', settings: { portal: 'https://example.org/catalog/', contentMode: 'metadata' }, http: { async get(address) {
    assert.equal(new URL(address).pathname, '/catalog/api/3/action/package_search');
    return { success: true, result: { count: 1, results: [{ id: '1', name: 'energy', title: 'Energy data', notes: '<p>Measured electricity use</p>', license_id: 'cc-by', resources: [{ url: 'https://other.org/data.csv' }] }] } };
  } } });
  assert.equal(rows[0].rights.expression, null); assert.equal(rows[0].metadata.datasetLicense.id, 'cc-by'); assert.match(rows[0].text, /Measured electricity/);
  await assert.rejects(collect('ckan', { http: { async get() { return { success: false }; } } }), /search failed/);
});
test('Dataverse collects citations without assuming attached-file licenses', async () => {
  const rows = await collect('dataverse', { http: { async get() { return { status: 'OK', data: { total_count: 1, items: [{ name: 'Study', global_id: 'doi:10.1/test', description: 'Research measurements', authors: ['Ada'], citation: 'Example citation' }] } }; } } });
  assert.equal(rows[0].id, 'doi:10.1/test'); assert.match(rows[0].text, /Example citation/); assert.equal(rows[0].rights.expression, null);
});
test('RSS and Atom collect feed text without crawling links', async () => {
  for (const text of [
    '<rss><channel><title>Publisher</title><item><guid>item1</guid><title>News</title><link>https://example.org/news</link><description><![CDATA[<p>Published feed content.</p>]]></description></item></channel></rss>',
    '<feed><title>Publisher</title><entry><id>item1</id><title>News</title><link href="/news"/><content>Published feed content.</content></entry></feed>',
  ]) {
    let calls = 0; const rows = await collect('rss', { input: 'https://example.org/feed', http: { async get() { calls++; return text; } } });
    assert.equal(calls, 1); assert.equal(rows[0].text, 'Published feed content.'); assert.equal(rows[0].url, 'https://example.org/news');
  }
});
test('USGS preserves geometry, magnitude scale, and original observation', async () => {
  const rows = await collect('usgs', { input: '2026-01-01', settings: { endDate: '2026-01-02', minMagnitude: '3' }, http: { async get(address) { const u = new URL(address); assert.equal(u.searchParams.get('minmagnitude'), '3'); return { features: [{ id: 'eq1', properties: { title: 'M 3 earthquake', mag: 3, magType: 'ml', time: 0, updated: 1000 }, geometry: { type: 'Point', coordinates: [10, 20, 30] } }] }; } } });
  assert.match(rows[0].text, /depth \(km\): 30/); assert.deepEqual(rows[0].metadata.geojson.geometry.coordinates, [10, 20, 30]);
});
test('invalid USGS settings fail before making requests', async () => {
  const http = { get() { throw new Error('Unexpected request'); } };
  for (const settings of [{ endDate: '2026-01-01', minMagnitude: 'NaN' }, { endDate: '2026-02-30' }]) await assert.rejects(collect('usgs', { input: '2026-01-01', settings, http }), /must be/);
});
test('Open Library keeps book metadata distinct from book text', async () => {
  const rows = await collect('openlibrary', { input: 'engineering', http: { async get() { return { numFound: 1, docs: [{ key: '/works/OL1W', title: 'Engineering book', author_name: ['Ada'], subject: ['Robotics'] }] }; } } });
  assert.match(rows[0].text, /Robotics/); assert.match(rows[0].contentRequests[0].error, /No publicly downloadable/);
});
test('Open Library uses public access search and skips private archive files', async () => {
  const rows = await collect('openlibrary', { input: 'engineering', http: { async get(address) {
    if (address.includes('/search.json')) { assert.match(new URL(address).searchParams.get('q'), /ebook_access:public/); return { numFound: 1, docs: [{ key: '/works/OL1W', title: 'Book', ebook_access: 'public', ia: ['book'] }] }; }
    return { files: [{ name: 'private.pdf', private: 'true' }, { name: 'public_djvu.txt' }] };
  } } });
  assert.equal(rows[0].contentRequests.length, 1); assert.match(rows[0].contentRequests[0].url, /public_djvu\.txt/);
});
test('JSONL preserves original rows and gives row rights precedence over fallback', async () => {
  const rows = await collect('jsonl', { input: 'https://example.org/data.jsonl', settings: { textField: 'body', license: 'CC0-1.0' }, http: { async *lines() { yield ''; yield JSON.stringify({ id: 1, body: 'A full source document', rights: { expression: 'MIT' }, score: 7 }); } } });
  assert.equal(rows[0].text, 'A full source document'); assert.equal(rows[0].rights.expression, 'MIT'); assert.equal(rows[0].metadata.original.score, 7);
});
test('JSONL rejects malformed rows and missing selected columns', async () => {
  for (const line of ['invalid', '[]', '{"title":"no text"}']) await assert.rejects(collect('jsonl', { input: 'https://example.org/data', http: { async *lines() { yield line; } } }), /row|JSONL/);
});
test('OSV queries package versions and follows page tokens even on empty intermediate pages', async () => {
  let calls = 0;
  const rows = await collect('osv', { input: 'requests', settings: { ecosystem: 'PyPI', version: '1.0' }, http: { async post(address, body) {
    calls++; assert.equal(address, 'https://api.osv.dev/v1/query'); assert.equal(body.package.ecosystem, 'PyPI'); assert.equal(body.version, '1.0');
    if (calls === 1) return { next_page_token: 'next' };
    assert.equal(body.page_token, 'next'); return { vulns: [{ id: 'GHSA-1', details: 'An advisory', affected: [{ package: { name: 'requests' } }] }] };
  } } });
  assert.equal(calls, 2); assert.equal(rows[0].metadata.original.affected[0].package.name, 'requests'); assert.equal(rows[0].rights.expression, null);
});
test('Socrata paginates original rows and sends SoQL filter without fetching resource links', async () => {
  let calls = 0;
  const rows = await collect('socrata', { input: 'https://example.org/resource/abcd-1234.json', settings: { where: 'energy > 0' }, http: { async get(address) {
    const u = new URL(address); calls++; assert.equal(u.searchParams.get('$where'), 'energy > 0');
    if (calls === 1) { assert.equal(u.searchParams.get('$offset'), '0'); return Array.from({ length: 100 }, (_, i) => ({ energy: i })); }
    assert.equal(u.searchParams.get('$offset'), '100'); return [{ energy: 100 }];
  } } });
  assert.equal(rows.length, 101); assert.equal(rows[100].metadata.original.energy, 100); assert.deepEqual(JSON.parse(rows[100].text), { energy: 100 });
});
test('USGS no-content response ends naturally without an error', async () => {
  assert.deepEqual(await collect('usgs', { http: { async get() { return null; } } }), []);
});
test('custom source URLs reject embedded credentials and insecure endpoints', async () => {
  for (const id of ['ckan', 'dataverse', 'rss', 'jsonl']) {
    const context = ['ckan', 'dataverse'].includes(id) ? { settings: { portal: 'https://user:password@example.org' } } : { input: 'http://example.org/data' };
    await assert.rejects(collect(id, context), /HTTPS/);
  }
});
