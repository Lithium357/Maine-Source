import path from 'node:path';
import { serveAgent } from '../src/agent-server.mjs';
const index = process.argv.indexOf('--workspace');
try {
  if (index < 0 || !process.argv[index + 1]) throw new Error('Supply --workspace with an absolute folder');
  await serveAgent({ workspace: path.resolve(process.argv[index + 1]) });
} catch {
  process.stderr.write('Maine Source headless startup failed. Check the workspace path and whether another process is using it.\n');
  process.exitCode = 1;
}
