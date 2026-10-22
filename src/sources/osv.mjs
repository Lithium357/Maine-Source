import { unknown } from './helpers.mjs';

export default {
  id: 'osv', name: 'OSV package vulnerabilities', category: 'Security', mark: 'OS', color: '#bb7553',
  description: 'Vulnerability records for a package, including affected versions, aliases, references, and upstream provenance.',
  input: 'Package name, e.g. requests', docs: 'https://google.github.io/osv.dev/post-v1-query/',
  fields: [{ id: 'ecosystem', label: 'OSV ecosystem (case sensitive)', default: 'PyPI', placeholder: 'PyPI, npm, Go, crates.io, Maven…' }, { id: 'version', label: 'Package version (optional; blank queries all versions)' }],
  async *collect({ input, settings = {}, http }) {
    if (!input) throw new Error('OSV needs a package name');
    let token; const cursors = new Set();
    while (true) {
      const page = await http.post('https://api.osv.dev/v1/query', { package: { name: input, ecosystem: settings.ecosystem || 'PyPI' }, ...(settings.version ? { version: settings.version } : {}), ...(token ? { page_token: token } : {}) }, { interval: 1100 });
      if (page.error || (page.code && page.message)) throw new Error('OSV rejected the package query; check ecosystem and version');
      for (const item of page.vulns || []) yield { id: item.id, title: item.summary || item.id, text: item.details || item.summary || `${item.id}\n${JSON.stringify(item.affected || [])}`, url: `https://osv.dev/vulnerability/${encodeURIComponent(item.id)}`, version: item.modified, attribution: 'OSV and upstream advisory publishers', rights: { ...unknown(), notes: 'OSV aggregates multiple upstream licenses; see database_specific and references.' }, metadata: { ecosystem: settings.ecosystem || 'PyPI', package: input, original: item } };
      if (!page.next_page_token) break;
      if (cursors.has(page.next_page_token)) throw new Error('OSV repeated its cursor');
      token = page.next_page_token; cursors.add(token);
    }
  },
};
