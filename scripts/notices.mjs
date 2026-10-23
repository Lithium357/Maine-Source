// Gather installed production dependency licenses for the Windows distribution.
import { readFile, readdir, writeFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = path.resolve('.'), manifest = JSON.parse(await readFile('package.json', 'utf8'));
const visited = new Set(), entries = [];
async function packageFolder(name, parent) {
  const require = createRequire(path.join(parent, 'package.json'));
  for (const search of require.resolve.paths(name + '/') || []) {
    const folder = path.join(search, name);
    try { if (JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')).name === name) return await realpath(folder); } catch {}
  }
  throw new Error(`Cannot locate license information for ${name}`);
}
async function visit(name, parent, optional = false) {
  let folder;
  try { folder = await packageFolder(name, parent); } catch (e) { if (optional) return; throw e; }
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')), id = `${pkg.name}@${pkg.version}`;
  if (visited.has(id)) return; visited.add(id);
  const licenses = [];
  for (const file of await readdir(folder)) if (/^(licen[cs]e|copying|notice)(?:[._-]|$)/i.test(file)) {
    try { licenses.push(`${file}\n${await readFile(path.join(folder, file), 'utf8')}`); } catch {}
  }
  entries.push(`${id}\nDeclared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || pkg.licenses || 'Not declared')}\n${licenses.join('\n\n') || 'No separate license file installed; see package metadata and upstream repository.'}`);
  const optionalNames = new Set(Object.keys(pkg.optionalDependencies || {}));
  for (const dependency of new Set([...Object.keys(pkg.dependencies || {}), ...optionalNames])) await visit(dependency, folder, optionalNames.has(dependency));
}
for (const name of Object.keys(manifest.dependencies)) await visit(name, root);
await writeFile('THIRD-PARTY-NOTICES.txt', 'Maine Source — third-party production dependency notices\nElectron/Chromium notices are distributed separately with the runtime.\n\n' + entries.sort().join('\n\n' + '='.repeat(80) + '\n\n'));
console.log(`Generated notices for ${entries.length} installed production packages.`);
