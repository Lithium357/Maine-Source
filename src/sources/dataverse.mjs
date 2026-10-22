import { endpoint, plain, portalURL, unknown } from './helpers.mjs';

export default {
  id: 'dataverse', name: 'Research Dataverse', category: 'Datasets', mark: 'DV', color: '#cb8b45',
  description: 'Dataset descriptions, citations, and persistent identifiers across research repositories. Metadata only.',
  input: 'Research search (optional)', docs: 'https://guides.dataverse.org/en/latest/api/search.html',
  fields: [{ id: 'portal', label: 'Dataverse repository URL', default: 'https://dataverse.harvard.edu' }],
  async *collect({ input, settings = {}, http }) {
    const portal = portalURL(settings.portal || 'https://dataverse.harvard.edu');
    for (let start = 0;; start += 100) {
      const page = await http.get(endpoint(`${portal}/api/search`, { q: input || '*', type: 'dataset', per_page: 100, start }), { interval: 1100 });
      if (page.status !== 'OK' || !Array.isArray(page.data?.items)) throw new Error('Dataverse search failed; check the repository URL');
      const items = page.data.items;
      for (const item of items) yield { id: item.global_id || `${portal}/${item.entity_id}`, title: item.name, text: [item.name, plain(item.description), plain(item.citation)].filter(Boolean).join('\n'), url: item.url, version: item.published_at, attribution: (item.authors || []).join(', '), rights: unknown(), metadata: { contentScope: 'catalog metadata only', portal, original: item } };
      if (items.length < 100 || start + items.length >= page.data.total_count) break;
    }
  },
};
