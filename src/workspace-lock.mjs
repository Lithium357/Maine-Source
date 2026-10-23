import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function acquireWorkspace(root) {
  await mkdir(root, { recursive: true });
  const canonical = await realpath(root);
  // Keep the lease with the workspace so GUI/agent environments with different
  // TEMP folders, or different users sharing a drive, still see the same owner.
  const filename = path.join(canonical, '.maine-source-workspace.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const file = await open(filename, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); } finally { await file.close(); }
      return { async release() {
        try { if (JSON.parse(await readFile(filename, 'utf8')).token === token) await unlink(filename); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let saved;
      try { saved = JSON.parse(await readFile(filename, 'utf8')); } catch { throw new Error('Workspace lock is unreadable; another process may be opening it'); }
      if (!Number.isSafeInteger(saved.pid) || saved.pid < 1) throw new Error('Invalid workspace lock');
      try { process.kill(saved.pid, 0); } catch (probe) {
        if (probe.code !== 'ESRCH') throw new Error('Workspace is in use by another process');
        // A dead process cannot still be writing. Verify ownership before cleanup.
        if (JSON.parse(await readFile(filename, 'utf8')).token === saved.token) await unlink(filename);
        continue;
      }
      throw new Error('Workspace is in use. Close the other app/API client or choose another workspace');
    }
  }
  throw new Error('Could not acquire the workspace lock');
}
