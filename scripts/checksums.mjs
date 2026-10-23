import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
const lines = [], directory = process.argv[2] || 'release';
for (const name of (await readdir(directory)).filter(name => /\.(exe|blockmap|whl)$/.test(name)).sort()) {
  const hash = createHash('sha256'); for await (const bytes of createReadStream(`${directory}/${name}`)) hash.update(bytes);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
if (!lines.length) throw new Error('No release binaries found');
await writeFile(`${directory}/SHA256SUMS.txt`, lines.join('\n') + '\n');
console.log(`Wrote checksums for ${lines.length} release artifacts.`);
