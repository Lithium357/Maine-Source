import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../src/http.mjs';
import { gzipSync } from 'node:zlib';

test('transient GET transport failures retry without exposing credentials', async () => {
  let calls = 0; const waits = [];
  const http = new HttpClient({ fetcher: async () => { if (++calls < 3) throw new TypeError('fetch failed https://example.org/?api_key=secret'); return Response.json({ ok: true }); }, sleep: async ms => waits.push(ms) });
  assert.deepEqual(await http.get('https://example.org/?api_key=secret', { interval: 0 }), { ok: true });
  assert.equal(calls, 3); assert.deepEqual(waits, [2000, 4000]);
});
test('non-idempotent transport errors are not retried and cancellation interrupts backoff', async () => {
  let calls = 0;
  const http = new HttpClient({ fetcher: async () => { calls++; throw new TypeError('secret'); } });
  await assert.rejects(http.post('https://example.org/', '{}'), /network request/); assert.equal(calls, 1);
  const controller = new AbortController();
  const cancellable = new HttpClient({ signal: controller.signal, fetcher: async () => { controller.abort(); throw new TypeError('secret'); } });
  await assert.rejects(cancellable.get('https://example.org/'), e => e.name === 'AbortError');
});
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

test('JSONL streaming handles gzip, split UTF-8, CRLF, and a final line without newline', async () => {
  const content = '{"text":"café"}\r\n{"text":"second"}';
  for (const buffer of [Buffer.from(content), gzipSync(content)]) {
    const http = new HttpClient({ fetcher: async () => new Response(new ReadableStream({ start(controller) { for (const byte of buffer) controller.enqueue(Uint8Array.of(byte)); controller.close(); } })) });
    const lines = []; for await (const line of http.lines('https://example.org/data')) lines.push(JSON.parse(line));
    assert.deepEqual(lines, [{ text: 'café' }, { text: 'second' }]);
  }
});
test('JSONL limits decompressed bytes and individual row size', async () => {
  const http = new HttpClient({ fetcher: async () => new Response(gzipSync('x'.repeat(10000))) });
  await assert.rejects(async () => { for await (const line of http.lines('https://example.org/data', { maxBytes: 1000 })) void line; }, /decompressed/);
  const plain = new HttpClient({ fetcher: async () => new Response('123456\n') });
  await assert.rejects(async () => { for await (const line of plain.lines('https://example.org/data', { maxLineBytes: 5 })) void line; }, /row exceeds/);
});
test('stopping JSONL iteration cancels the upstream response', async () => {
  let cancelled = false;
  const http = new HttpClient({ fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.from('{"text":"one"}\n')); }, cancel() { cancelled = true; } })) });
  const iterator = http.lines('https://example.org/data');
  assert.equal((await iterator.next()).value, '{"text":"one"}');
  // Abort the request when a collection stops, as the collector does.
  await iterator.return(); assert.equal(cancelled, true);
});
test('public JSONL download redirects are bounded and never use credentials', async () => {
  const calls = [];
  const http = new HttpClient({ fetcher: async (url, options) => {
    calls.push(url); assert.equal(options.headers.Authorization, undefined);
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/file' } }) : new Response('{"text":"row"}\n');
  } });
  const rows = []; for await (const line of http.lines('https://example.org/data')) rows.push(line);
  assert.equal(rows.length, 1); assert.equal(calls[1], 'https://cdn.example.org/file');
  await assert.rejects(http.request('https://example.org', { publicRedirects: true, headers: { Authorization: 'secret' } }), /credentials/);
});
test('public downloads reject insecure redirect destinations', async () => {
  const http = new HttpClient({ fetcher: async () => new Response(null, { status: 302, headers: { location: 'http://example.org/data' } }) });
  await assert.rejects(async () => { for await (const line of http.lines('https://example.org/data')) void line; }, /HTTPS/);
});
