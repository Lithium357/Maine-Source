import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources } from '../src/catalog.mjs';

const start = '<!-- maine-source:sources:start -->', end = '<!-- maine-source:sources:end -->';
const managed = /<!-- maine-source:sources:start -->[\s\S]*?<!-- maine-source:sources:end -->/;
const cell = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
function https(address) {
  const u = new URL(address);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Source links must use HTTPS without credentials');
  return address;
}
export function sourceSection(catalog = sources) {
  const implemented = catalog.filter(source => !source.planned);
  const rows = implemented.map(source => {
    if (source.key && !source.credentialUrl) throw new Error(`${source.id}: add credentialUrl before releasing`);
    if (source.id !== 'local' && !source.docs) throw new Error(`${source.id}: add official source documentation before releasing`);
    const access = source.key ? cell(source.credentialHelp || source.key) : source.id === 'local' ? 'No API key; choose files on your computer.' : 'No API key needed for the implemented public connector.';
    const links = [source.credentialUrl ? `[Get a key / token](${https(source.credentialUrl)})` : '', source.docs ? `[Source / API documentation](${https(source.docs)})` : 'Local files on your machine'].filter(Boolean).join(' · ');
    return `| ${cell(source.name)} | ${access} | ${links} |`;
  });
  return `${start}\n## All implemented sources and API keys\n\nThis complete list is repeated in every release, including sources introduced in earlier versions. It covers ${implemented.length} implemented sources, including local files; roadmap-only entries are excluded. Links go to the providers, not to credentials stored by this app.\n\n| Source | Key / token and access | Signup and source links |\n| --- | --- | --- |\n${rows.join('\n')}\n\nEnter keys locally in **Connections & settings**, then use **Test connection**. Request read-only access. A successful connection check does not guarantee permission for every repository, dataset, or download.\n${end}`;
}
export function withSourceSection(body, section = sourceSection()) {
  return managed.test(body) ? body.replace(managed, () => section) : `${body.trimEnd()}\n\n${section}\n`;
}
async function main() {
  const args = process.argv.slice(2), templatePath = 'docs/release-notes-template.md';
  const template = await readFile(templatePath, 'utf8'), updated = withSourceSection(template);
  if (args.includes('--check')) {
    if (template.replace(/\r\n/g, '\n') !== updated.replace(/\r\n/g, '\n')) throw new Error('Release source list is stale. Run node scripts/release-notes.mjs --update-template');
    console.log(`Release notes cover all ${sources.filter(s => !s.planned).length} implemented sources.`); return;
  }
  if (args.includes('--update-template')) { await writeFile(templatePath, updated); return; }
  const output = args.find(arg => !arg.startsWith('--')) || (args.includes('--sources-only') ? 'release/SOURCE-ACCESS.md' : 'release/RELEASE_NOTES.md');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const body = args.includes('--sources-only') ? sourceSection() + '\n' : updated.replace('# Maine Source — release description template', `# Maine Source ${version}`).replace(/^Replace VERSION[^\n]*\r?\n\r?\n/m, '').replaceAll('VERSION', version);
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, body);
  console.log(`Wrote ${output}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
