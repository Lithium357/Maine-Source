import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../src/http.mjs';
test('credentials are not included in HTTP errors', async () => {
  const http = new HttpClient({ fetcher: async () => new Response('secret error', { status: 401 }) });
  await assert.rejects(http.get('https://example.org/?api_key=private-token'), e => !e.message.includes('private-token') && /401/.test(e.message));
});
test('rate limits honor Retry-After and use bounded retries', async () => {
  let calls = 0; const sleeps = [];
  const http = new HttpClient({ fetcher: async () => { calls++; return calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : Response.json({ ok: true }); }, sleep: async ms => sleeps.push(ms) });
  assert.deepEqual(await http.get('https://example.org/', { interval: 0 }), { ok: true }); assert.equal(calls, 2); assert.ok(sleeps.includes(2000));
});
test('response size is bounded, including streamed bodies', async () => {
  const http = new HttpClient({ fetcher: async () => new Response('1234567890') }); await assert.rejects(http.get('https://example.org/', { maxBytes: 5 }), /size limit/);
});
test('cross-origin redirects are never followed with credentials', async () => {
  let options; const http = new HttpClient({ fetcher: async (_url, opts) => { options = opts; return Response.json({ ok: true }); } }); await http.get('https://example.org/', { headers: { Authorization: 'Bearer test' } }); assert.equal(options.redirect, 'error');
});
test('insecure sources are rejected before requesting', async () => { const http = new HttpClient(); await assert.rejects(http.get('http://example.org/'), /HTTPS/); });
