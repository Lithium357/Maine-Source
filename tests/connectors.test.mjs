import test from 'node:test';
import assert from 'node:assert/strict';
import { connectors } from '../src/connectors.mjs';

test('GovInfo uses advertised formats without guessing missing whole-volume HTML', async () => {
  const http = { async get(address) {
    if (address.includes('/collections/')) return { packages: [{ packageId: 'FR-2026-10-23', title: 'Volume' }] };
    assert.ok(address.includes('/summary'));
    return { download: { pdfLink: 'https://api.govinfo.gov/packages/FR-2026-10-23/pdf', xmlLink: 'https://api.govinfo.gov/packages/FR-2026-10-23/xml' } };
  } };
  const first = await connectors.govinfo({ input: 'FR', key: 'test-secret', http }).next();
  assert.equal(first.value.contentRequests.length, 2);
  assert.ok(first.value.contentRequests.every(r => !r.url.includes('/htm')));
  assert.ok(first.value.contentRequests.every(r => new URL(r.url).searchParams.get('api_key') === 'test-secret'));
  const hostile = { async get(address) { return address.includes('/collections/') ? { packages: [{ packageId: 'FR-1' }] } : { download: { pdfLink: 'https://evil.example/steal' } }; } };
  await assert.rejects(connectors.govinfo({ input: 'FR', key: 'test-secret', http: hostile }).next(), /Unexpected GovInfo/);
});

test('Wikipedia retrieves a separate full extract for each search hit', async () => {
  const calls = [];
  const http = { async get(address) { const u = new URL(address); calls.push(u);
    if (u.searchParams.has('meta')) return { query: { rightsinfo: { url: 'https://creativecommons.org/licenses/by-sa/4.0/' } } };
    if (u.searchParams.has('generator')) return { query: { pages: { 1: { pageid: 1, title: 'First', fullurl: 'https://example.org/1' }, 2: { pageid: 2, title: 'Second', fullurl: 'https://example.org/2' } } } };
    const id = u.searchParams.get('pageids'); return { query: { pages: { [id]: { extract: `Full text ${id}`, revisions: [{ revid: Number(id) + 10 }] } } } };
  } };
  const items = []; for await (const item of connectors.wikipedia({ input: 'engineering', http })) items.push(item);
  assert.equal(items.length, 2); assert.equal(items[1].text, 'Full text 2'); assert.equal(items[1].version, '12'); assert.equal(calls.filter(c => c.searchParams.has('pageids')).length, 2);
});
test('Europe PMC reads nested article-specific Creative Commons evidence', async () => {
  const http = { async get(address) {
    if (address.includes('fullTextXML')) return '<article><front><article-meta><permissions><license><ali:license_ref>https://creativecommons.org/licenses/by/4.0/</ali:license_ref></license></permissions></article-meta></front><body><sec><p>Article full text.</p></sec></body></article>';
    return { resultList: { result: [{ pmcid: 'PMC1', title: 'Paper', firstPublicationDate: '2026-01-01' }] } };
  } };
  const result = await connectors.europepmc({ input: 'engineering', http }).next(); assert.equal(result.value.rights.expression, 'CC-BY-4.0'); assert.equal(result.value.rights.basis, 'content-notice'); assert.equal(result.value.text, 'Article full text.');
});
test('Zenodo uses anonymous page-size limits and separates metadata from file rights', async () => {
  const http = { async get(address) { assert.equal(new URL(address).searchParams.get('size'), '25'); return { hits: { hits: [{ id: 1, metadata: { title: 'A sufficiently descriptive research title', license: { id: 'all-rights-reserved' } } }] } }; } };
  const result = await connectors.zenodo({ input: 'engineering', settings: { contentMode: 'metadata' }, http }).next(); assert.equal(result.value.rights.expression, 'CC0-1.0'); assert.match(result.value.text, /research title/); assert.equal(result.value.metadata.attachedFileLicense.id, 'all-rights-reserved');
});
test('NASA media copyright notices never become invented text licenses', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const http = { async get() { return { title: 'Astronomy', explanation: 'An astronomy explanation', copyright: 'A photographer', date }; } };
  const result = await connectors.nasa({ input: date, http }).next(); assert.equal(result.value.rights.expression, null); assert.match(result.value.rights.notes, /Text-specific/);
});
test('GitHub pins a commit and gives file notices precedence while flagging conflict', async () => {
  const http = { async get(address) {
    if (address.includes('/commits/')) return { sha: 'commit123' };
    if (address.includes('/git/trees/')) return { tree: [{ type: 'blob', path: 'main.py', sha: 'blob123', size: 100, mode: '100644' }] };
    return { default_branch: 'main', license: { spdx_id: 'MIT' }, private: false };
  }, async binary(address, options) {
    assert.match(address, /\/contents\/main.py\?ref=commit123$/);
    assert.equal(options.headers.Accept, 'application/vnd.github.raw+json');
    return { data: Buffer.from('# SPDX-License-Identifier: Apache-2.0\nprint("hello")') };
  } };
  const result = await connectors.github({ input: 'owner/repo', http }).next(); assert.equal(result.value.rights.expression, 'Apache-2.0'); assert.equal(result.value.rights.conflict, true); assert.equal(result.value.version, 'commit123'); assert.match(result.value.url, /commit123/);
});
test('GitHub traverses individual directories when a recursive tree is truncated', async () => {
  const calls = [];
  const http = { async get(address) {
    calls.push(address);
    if (address.includes('/commits/')) return { sha: 'commit' };
    if (address.includes('?recursive')) return { truncated: true, tree: [] };
    if (address.endsWith('/git/trees/commit')) return { tree: [{ type: 'tree', path: 'src', sha: 'subtree' }, { type: 'tree', path: 'node_modules', sha: 'ignored' }] };
    if (address.endsWith('/git/trees/subtree')) return { tree: [{ type: 'blob', path: 'main.py', sha: 'blob', size: 20, mode: '100644' }] };
    return { default_branch: 'main', private: false };
  }, async binary() { return { data: Buffer.from('print("hello")') }; } };
  const items = []; for await (const item of connectors.github({ input: 'owner/repo', http })) items.push(item);
  assert.equal(items.length, 1); assert.equal(items[0].metadata.path, 'src/main.py');
  assert.ok(!calls.some(url => url.includes('/ignored')));
});
test('NVD resumes at a saved page boundary and advances its checkpoint', async () => {
  let checkpoint;
  const http = { async get(address) { assert.equal(new URL(address).searchParams.get('startIndex'), '100'); return { vulnerabilities: [{ cve: { id: 'CVE-example', descriptions: [] } }], totalResults: 101 }; } };
  const items = []; for await (const item of connectors.nvd({ http, resume: { start: 100 }, checkpoint: async value => { checkpoint = value; } })) items.push(item);
  assert.equal(items.length, 1); assert.deepEqual(checkpoint, { start: 101 });
});
