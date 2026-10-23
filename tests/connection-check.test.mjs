import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnection } from '../src/connection-check.mjs';

test('connection checks use fixed provider endpoints and never return account details', async () => {
  for (const id of ['github', 'advisories', 'huggingface', 'nvd', 'nasa', 'stackexchange', 'govinfo', 'openalex']) {
    let calls = 0;
    const result = await checkConnection(id, 'test-secret-key', { http: { async get(address, options) {
      calls++; const u = new URL(address); assert.equal(u.protocol, 'https:');
      assert.equal(options.maxBytes, 2097152);
      assert.equal(options.timeoutMs, 20000);
      assert.ok(JSON.stringify(options).includes('test-secret-key') || address.includes('test-secret-key'));
      return id === 'nasa' ? [{ explanation: 'A picture' }] : { login: 'private-name', name: 'private-name', vulnerabilities: [], items: [], collections: [], results: [] };
    } } });
    assert.equal(calls, 1);
    assert.equal(result.ok, true);
    assert.ok(!JSON.stringify(result).includes('private-name'));
    assert.ok(!JSON.stringify(result).includes('test-secret-key'));
  }
});

test('public probe success does not claim credentials or download access were validated', async () => {
  const result = await checkConnection('nasa', 'test-secret-key', { http: { get: async () => [{ explanation: 'A picture' }] } });
  assert.equal(result.ok, true); assert.match(result.message, /ignore keys/);
  const invalid = await checkConnection('stackexchange', 'test-secret-key', { http: { get: async () => ({ error_id: 403, items: [] }) } });
  assert.equal(invalid.ok, false);
});

test('connection failures redact credentials and reject unsupported IDs before any request', async () => {
  const http = { get: async () => { throw new Error('Failure api_key=test-secret-key Bearer test-secret-key'); } };
  const result = await checkConnection('govinfo', 'test-secret-key', { http });
  assert.equal(result.ok, false); assert.ok(!result.message.includes('test-secret-key'));
  for (const id of ['https://evil.example', '__proto__', 'constructor']) await assert.rejects(checkConnection(id, 'test-secret-key', { http }), /no credential test/);
  await assert.rejects(checkConnection('github', '', { http }), /Save a credential/);
});
