import { endpoint, plain, portalURL, unknown } from './helpers.mjs';

export default {
  id: 'ckan', name: 'CKAN public-data portals', category: 'Government & law', mark: 'CK', color: '#59946b',
  description: 'Download dataset resource files and extract usable text while preserving originals and catalog provenance.',
  input: 'Catalog search (optional)', docs: 'https://docs.ckan.org/en/latest/api/',
  fields: [{ id: 'portal', label: 'CKAN portal URL', default: 'https://data.humdata.org', placeholder: 'https://data.humdata.org' }],
  async *collect({ input, settings = {}, http, resume = {}, checkpoint = async () => {} }) {
    const portal = portalURL(settings.portal || 'https://data.humdata.org');
    for (let start = Number.isSafeInteger(resume.start) && resume.start >= 0 ? resume.start : 0;; start += 100) {
      const page = await http.get(endpoint(`${portal}/api/3/action/package_search`, { q: input || '*:*', rows: 100, start }), { interval: 1100 });
      if (page.success !== true || !Array.isArray(page.result?.results)) throw new Error('CKAN catalog search failed; check the portal URL and query');
      const items = page.result.results;
      for (const item of items) {
        const base = { id: `${portal}/${item.id}`, title: item.title || item.name, text: [item.title, plain(item.notes)].filter(Boolean).join('\n'), url: `${portal}/dataset/${encodeURIComponent(item.name || item.id)}`, version: item.metadata_modified, attribution: item.author || item.organization?.title, rights: settings.contentMode === 'metadata' ? unknown() : { expression: item.license_id || null, url: item.license_url, basis: 'source-declaration', scope: 'record' }, metadata: { contentScope: 'dataset resources requested', portal, datasetLicense: { id: item.license_id, url: item.license_url }, resources: item.resources, tags: item.tags, original: item } };
        if (settings.contentMode === 'metadata') { yield base; continue; }
        if (!item.resources?.length) { yield { ...base, contentRequests: [{ error: 'No dataset resource download links were supplied' }] }; continue; }
        for (const resource of item.resources) yield { ...base, id: `${base.id}/${resource.id}`, title: `${base.title} / ${resource.name || resource.id}`, contentRequests: [{ url: resource.url, filename: `${resource.id || 'resource'}.${String(resource.format || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')}`, role: 'dataset resource' }], metadata: { ...base.metadata, resource } };
      }
      await checkpoint({ start: start + 100 });
      if (items.length < 100 || start + items.length >= page.result.count) break;
    }
  },
};
