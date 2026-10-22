// Copy to src/sources/your-source.mjs, replace the example endpoint, then register it.
import { endpoint, unknown } from './helpers.mjs';

export default {
  id: 'example', name: 'Example source', category: 'Datasets', mark: 'EX', color: '#618d88',
  description: 'Describe the exact content collected here.',
  input: 'Search topic', docs: 'https://example.org/api-docs',
  fields: [{ id: 'language', label: 'Language', options: ['en', 'fr'] }],
  // Add key: 'Optional API key' only if the service supports credentials.
  async *collect({ input, settings = {}, http }) {
    if (!input) throw new Error('Example source needs a search topic');
    for (let pageNumber = 1;; pageNumber++) {
      const page = await http.get(endpoint('https://example.org/api/records', {
        q: input, language: settings.language || 'en', page: pageNumber, limit: 100,
      }), { interval: 1100 });
      if (!Array.isArray(page.items)) throw new Error('Example source returned an invalid page');
      for (const item of page.items) yield {
        id: item.id, title: item.title, text: item.text, url: item.url,
        version: item.updated, attribution: item.author, rights: unknown(),
        metadata: { contentScope: 'full text', original: item },
      };
      if (!page.items.length || !page.hasMore) break;
    }
  },
};
