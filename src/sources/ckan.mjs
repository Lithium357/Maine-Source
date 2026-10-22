import { endpoint, plain, portalURL, unknown } from './helpers.mjs';

export default {
  id: 'ckan', name: 'CKAN public-data portals', category: 'Government & law', mark: 'CK', color: '#59946b',
  description: 'Search dataset descriptions and resource links across CKAN portals. Metadata only; no attached files.',
  input: 'Catalog search (optional)', docs: 'https://docs.ckan.org/en/latest/api/',
  fields: [{ id: 'portal', label: 'CKAN portal URL', default: 'https://data.humdata.org', placeholder: 'https://data.humdata.org' }],
  async *collect({ input, settings = {}, http }) {
    const portal = portalURL(settings.portal || 'https://data.humdata.org');
    for (let start = 0;; start += 100) {
      const page = await http.get(endpoint(`${portal}/api/3/action/package_search`, { q: input || '*:*', rows: 100, start }), { interval: 1100 });
      if (page.success !== true || !Array.isArray(page.result?.results)) throw new Error('CKAN catalog search failed; check the portal URL and query');
      const items = page.result.results;
      for (const item of items) yield { id: `${portal}/${item.id}`, title: item.title || item.name, text: [item.title, plain(item.notes)].filter(Boolean).join('\n'), url: `${portal}/dataset/${encodeURIComponent(item.name || item.id)}`, version: item.metadata_modified, attribution: item.author || item.organization?.title, rights: unknown(), metadata: { contentScope: 'catalog metadata only', portal, datasetLicense: { id: item.license_id, url: item.license_url }, resources: item.resources, tags: item.tags, original: item } };
      if (items.length < 100 || start + items.length >= page.result.count) break;
    }
  },
};
