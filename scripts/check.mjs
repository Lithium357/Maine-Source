import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['src', 'desktop', 'ui', 'scripts', 'tests']) {
  for (const file of readdirSync(dir, { recursive: true }).filter(f => /\.(mjs|cjs)$/.test(f))) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['scripts/release-notes.mjs', '--check'], { stdio: 'inherit' });
console.log('All JavaScript syntax checks passed.');
