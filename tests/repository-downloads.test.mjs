import test from 'node:test';
import assert from 'node:assert/strict';
import { connectors } from '../src/connectors.mjs';
import { HttpClient } from '../src/http.mjs';
import { materialize } from '../src/content.mjs';

const sha = 'a'.repeat(40);
const all = async iterator => { const records = []; for await (const record of iterator) records.push(record); return records; };

test('GitHub archive uses the saved commit, preserves API credentials only on the download request, and skips file filters', async () => {
  let saved;
  const calls = [];
  const http = { async get(address) {
    calls.push(address);
    if (address.includes('/commits/')) { assert.ok(address.endsWith(`/commits/${sha}`)); return { sha, commit: { tree: { sha: 'tree' } } }; }
    return { default_branch: 'main', license: { spdx_id: 'MIT' } };
  } };
  const records = await all(connectors.github({ input: 'owner/repo', settings: { downloadMode: 'archive', ref: 'changed-branch', extensions: '.nothing' }, key: 'secret', resume: { pins: { 'owner/repo': sha } }, checkpoint: async value => { saved = value; }, http }));
  assert.equal(records.length, 1); assert.equal(saved.pins['owner/repo'], sha);
  assert.ok(!calls.some(address => address.includes('/git/trees/')));
  assert.equal(records[0].contentRequests[0].url, `https://api.github.com/repos/owner/repo/tarball/${sha}`);
  assert.equal(records[0].contentRequests[0].headers.Authorization, 'Bearer secret');
  assert.equal(records[0].contentRequests[0].downloadRedirects, true);
  assert.equal(records[0].rights.expression, 'MIT');
});

test('GitHub enumerates the commit tree SHA and encodes a requested ref and content path', async () => {
  const http = { async get(address) {
    if (address.includes('/commits/')) { assert.ok(address.endsWith('/commits/release%2Fv1')); return { sha, commit: { tree: { sha: 'actual-tree' } } }; }
    if (address.includes('/git/trees/')) { assert.ok(address.includes('/actual-tree?recursive=1')); return { tree: [{ type: 'blob', mode: '100644', path: 'src/a b.py', size: 6, sha: 'blob' }] }; }
    return { default_branch: 'main' };
  }, async binary(address) { assert.equal(address, `https://api.github.com/repos/owner/repo/contents/src/a%20b.py?ref=${sha}`); return { data: Buffer.from('hello\n') }; } };
  const records = await all(connectors.github({ input: 'owner/repo', settings: { ref: 'release/v1' }, http }));
  assert.equal(records[0].contentRequests[0].data.toString(), 'hello\n');
});

test('Hugging Face follows every tree page and saves pinned raw files including binary shards', async () => {
  const calls = []; let saved;
  const tree = `https://huggingface.co/api/datasets/owner/data/tree/${sha}`;
  const http = { async get(address, options) {
    calls.push(address); assert.equal(options.headers.Authorization, 'Bearer secret');
    if (!address.includes('/tree/')) return { sha, cardData: { license: 'cc0-1.0' } };
    return { data: address.includes('cursor=') ? [{ type: 'file', path: 'data/train.parquet', size: 5 }] : [{ type: 'directory', path: 'data' }, { type: 'file', path: 'README.md', size: 10 }], headers: new Headers(address.includes('cursor=') ? {} : { link: `<${tree}?recursive=true&limit=100&cursor=next>; rel="next"` }) };
  } };
  const records = await all(connectors.huggingface({ input: 'owner/data', key: 'secret', settings: {}, checkpoint: async value => { saved = value; }, http }));
  assert.deepEqual(saved, { revision: sha }); assert.equal(records.length, 2); assert.equal(calls.length, 3);
  assert.equal(records[1].contentRequests[0].url, `https://huggingface.co/datasets/owner/data/resolve/${sha}/data/train.parquet`);
  assert.equal(records[1].metadata.path, 'data/train.parquet'); assert.equal(records[1].rights.expression, 'CC0-1.0');
  const original = Buffer.from([0, 1, 2, 3, 4]);
  const result = await materialize(records[1], { async binary(_address, options) { assert.equal(options.downloadRedirects, true); return { data: original, mediaType: 'application/octet-stream' }; } });
  assert.deepEqual(result.attachments[0].data, original); assert.equal(result.metadata.contentStatus, 'downloaded');
  assert.equal(result.text, ''); assert.equal(JSON.stringify(result).includes('Bearer secret'), false);
});

test('Hugging Face pins the saved revision on resume and applies optional file extensions', async () => {
  const http = { async get(address) {
    if (!address.includes('/tree/')) { assert.ok(address.endsWith(`/revision/${sha}`)); return { sha }; }
    return { data: [{ type: 'file', path: 'README.md' }, { type: 'file', path: 'data/train.jsonl' }], headers: new Headers() };
  } };
  const records = await all(connectors.huggingface({ input: 'owner/data', resume: { revision: sha }, settings: { revision: 'main', extensions: '.jsonl' }, http }));
  assert.equal(records.length, 1); assert.equal(records[0].metadata.path, 'data/train.jsonl');
});

test('Hugging Face rejects hostile and repeated pagination before sending credentials', async () => {
  for (const next of ['https://evil.example/steal', `https://huggingface.co/api/datasets/other/repo/tree/${sha}`, `https://huggingface.co/api/datasets/owner/data/tree/${sha}?recursive=true&limit=100`]) {
    let calls = 0;
    const http = { async get(address) {
      calls++;
      if (!address.includes('/tree/')) return { sha };
      return { data: [], headers: new Headers({ link: `<${next}>; rel="next"` }) };
    } };
    await assert.rejects(all(connectors.huggingface({ input: 'owner/data', http, key: 'secret' })), /pagination/);
    assert.equal(calls, 2);
  }
});

test('Hugging Face Viewer remains an explicit mode with original rows retained', async () => {
  const http = { async get(address) {
    if (address.includes('/splits')) return { splits: [{ config: 'default', split: 'train' }] };
    if (address.includes('/rows')) return { rows: [{ row_idx: 0, row: { text: 'Training example', label: 1 } }], num_rows_total: 1 };
    return { sha, cardData: { license: 'mit' } };
  } };
  const records = await all(connectors.huggingface({ input: 'owner/data', settings: { downloadMode: 'rows' }, http }));
  assert.equal(records[0].text, 'Training example'); assert.equal(records[0].metadata.original.label, 1);
});

test('Stack Exchange advanced search resumes pages and keeps full question and answer HTML and per-post licenses', async () => {
  const calls = [], checkpoints = [], waits = [];
  const http = { async wait(ms) { waits.push(ms); }, async get(address) {
    const u = new URL(address); calls.push(u);
    if (u.pathname.includes('/answers')) return { items: [{ answer_id: 2, body: '<p>Answer body</p>', content_license: 'CC BY-SA 4.0' }], backoff: 2 };
    assert.equal(u.pathname, '/2.3/search/advanced');
    if (u.searchParams.get('page') === '3') return { items: [], has_more: false };
    return { items: [{ question_id: 1, title: 'NLP question', body: '<p>Full question</p>', link: 'https://stackoverflow.com/q/1', content_license: 'CC BY-SA 3.0' }], has_more: true, backoff: 1 };
  } };
  const records = await all(connectors.stackexchange({ input: 'nlp', settings: { query: 'language', excludedTags: 'cats', sort: 'creation', order: 'asc' }, resume: { page: 2, todate: 1800000000 }, checkpoint: async value => checkpoints.push(value), http }));
  assert.equal(records.length, 2); assert.equal(records[0].rights.expression, 'CC-BY-SA-3.0'); assert.equal(records[1].rights.expression, 'CC-BY-SA-4.0');
  assert.equal(records[1].contentRequests[0].data, '<p>Answer body</p>');
  const query = calls[0].searchParams;
  for (const [key, value] of Object.entries({ tagged: 'nlp', q: 'language', nottagged: 'cats', sort: 'creation', order: 'asc', filter: 'withbody', pagesize: '100', page: '2', todate: '1800000000' })) assert.equal(query.get(key), value);
  assert.deepEqual(waits, [2000, 1000]); assert.equal(checkpoints.at(-1).page, 3);
});

test('explicit download redirects strip credentials at every redirect and enforce HTTPS and a hop limit', async () => {
  const calls = [];
  const http = new HttpClient({ sleep: async () => {}, fetcher: async (address, options) => {
    calls.push({ address, headers: options.headers });
    return calls.length < 3 ? new Response(null, { status: 302, headers: { location: calls.length === 1 ? '/signed' : 'https://cdn.example/file' } }) : new Response('original');
  } });
  const result = await http.binary('https://api.example/archive', { headers: { Authorization: 'Bearer secret', Cookie: 'private' }, downloadRedirects: true });
  assert.equal(result.data.toString(), 'original'); assert.equal(calls[0].headers.Authorization, 'Bearer secret');
  for (const call of calls.slice(1)) { assert.equal(call.headers.Authorization, undefined); assert.equal(call.headers.Cookie, undefined); }
  for (const location of ['http://cdn.example/file', 'https://user:pass@cdn.example/file', '/loop']) {
    let count = 0;
    const bad = new HttpClient({ sleep: async () => {}, fetcher: async () => { count++; return new Response(null, { status: 302, headers: { location } }); } });
    await assert.rejects(bad.binary('https://api.example/file', { headers: { Authorization: 'secret' }, downloadRedirects: true }), /HTTPS|excessive/);
    assert.ok(count <= 6);
  }
});
