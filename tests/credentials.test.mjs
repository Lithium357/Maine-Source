import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCredentials, credentialBundle, readCredentialFile } from '../src/credentials.mjs';
import { acquireWorkspace } from '../src/workspace-lock.mjs';
import { prepareStorage, relocateStorage } from '../src/storage.mjs';

test('portable credential bundles and flat maps round-trip without partial imports', () => {
  const keys = { github: 'test-secret-one', nasa: 'test-secret-two' };
  assert.deepEqual(parseCredentials(JSON.stringify(credentialBundle(keys))), keys);
  assert.deepEqual(parseCredentials('\uFEFF' + JSON.stringify(keys)), keys);
  for (const bad of [{ github: 'test-secret-one', unknown: 'test-secret-two' }, { github: 5 }, { github: '' }, { github: 'line\nbreak' }, { keys, schema: 'newer-unknown-schema' }, [], null]) {
    assert.throws(() => parseCredentials(bad), error => !error.message.includes('test-secret'));
  }
  assert.throws(() => parseCredentials('{test-secret-malformed'), /Invalid credential JSON/);
  assert.throws(() => parseCredentials(' '.repeat(65537)), /64 KiB/);
});

test('credential files enforce UTF-8 and a bounded regular-file size', async () => {
  await mkdir('.test-data', { recursive: true }); const root = await mkdtemp(path.resolve('.test-data/keys-'));
  const file = path.join(root, 'keys.json');
  await writeFile(file, JSON.stringify({ nasa: 'test-secret-one' }));
  assert.deepEqual(await readCredentialFile(file), { nasa: 'test-secret-one' });
  await writeFile(file, Buffer.from([0xff, 0xfe, 0xff])); await assert.rejects(readCredentialFile(file), /UTF-8/);
  await writeFile(file, ' '.repeat(65537)); await assert.rejects(readCredentialFile(file), /64 KiB/);
});

test('workspace locks prevent a GUI/API writer collision and release cleanly', async () => {
  await mkdir('.test-data', { recursive: true }); const root = await mkdtemp(path.resolve('.test-data/lock-'));
  const lease = await acquireWorkspace(root);
  try { await assert.rejects(acquireWorkspace(root), /in use/); } finally { await lease.release(); }
  const next = await acquireWorkspace(root); await next.release();
});

test('moving the GUI workspace acquires a new lease without copying its live lock', async () => {
  await mkdir('.test-data', { recursive: true }); const root = await mkdtemp(path.resolve('.test-data/lease-move-'));
  const desktop = path.join(root, 'Desktop'), userData = path.join(root, 'profile'), target = path.join(root, 'Other drive');
  await mkdir(target); const locations = await prepareStorage({ desktop, userData });
  const original = await acquireWorkspace(locations.datasets);
  try {
    const moved = await relocateStorage(locations, target);
    const next = await acquireWorkspace(moved.datasets);
    try { await assert.rejects(acquireWorkspace(locations.datasets), /in use/); } finally { await next.release(); }
  } finally { await original.release(); }
});
