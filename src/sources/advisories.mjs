import { endpoint, rights } from './helpers.mjs';

export default {
  id: 'advisories', name: 'GitHub Security Advisories', category: 'Security', mark: 'SA', color: '#a96b51',
  description: 'Reviewed vulnerability descriptions, affected packages, version ranges, and CVE aliases.',
  key: 'Optional read-only GitHub token', input: 'Affected package, e.g. lodash (optional)',
  docs: 'https://docs.github.com/en/rest/security-advisories/global-advisories',
  fields: [{ id: 'ecosystem', label: 'Package ecosystem', options: ['', 'npm', 'pip', 'maven', 'go', 'rust', 'nuget', 'rubygems', 'composer', 'actions', 'pub', 'swift', 'erlang', 'other'] }],
  async *collect({ input, key, settings = {}, http }) {
    let after;
    const cursors = new Set();
    while (true) {
      const { data: page, headers } = await http.get(endpoint('https://api.github.com/advisories', { type: 'reviewed', per_page: 100, affects: input, ecosystem: settings.ecosystem, after }), { includeHeaders: true, headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, interval: 1200 });
      if (!Array.isArray(page)) throw new Error('GitHub returned an invalid advisory page');
      for (const item of page) yield {
        id: item.ghsa_id, title: item.summary, text: item.description || item.summary, url: item.html_url,
        version: item.updated_at, attribution: 'GitHub Advisory Database contributors',
        rights: rights('CC-BY-4.0', 'https://github.com/github/advisory-database/blob/main/LICENSE.md', 'source'),
        metadata: { cve: item.cve_id, identifiers: item.identifiers, severity: item.severity, vulnerabilities: item.vulnerabilities, cwes: item.cwes, references: item.references },
      };
      const nextLink = headers.get('link')?.split(',').find(part => /rel="next"/.test(part))?.match(/<([^>]+)>/)?.[1];
      if (!nextLink) break;
      const parsed = new URL(nextLink);
      if (parsed.origin !== 'https://api.github.com' || parsed.pathname !== '/advisories') throw new Error('Unexpected GitHub advisory pagination URL');
      const next = parsed.searchParams.get('after');
      if (!next || cursors.has(next)) throw new Error('GitHub repeated its advisory cursor');
      cursors.add(next); after = next;
    }
  },
};
