import { endpoint, plain, unknown } from './helpers.mjs';

export default {
  id: 'openlibrary', name: 'Open Library catalog', category: 'Books & archives', mark: 'OL', color: '#9a805b',
  description: 'Book titles, authors, subjects, and publication metadata. Does not download book text.',
  input: 'Book, author, or subject search', docs: 'https://openlibrary.org/dev/docs/api/search',
  async *collect({ input, http }) {
    if (!input) throw new Error('Open Library needs a search query');
    for (let offset = 0;; offset += 100) {
      const page = await http.get(endpoint('https://openlibrary.org/search.json', { q: input, fields: 'key,title,author_name,first_publish_year,subject,language,edition_count', limit: 100, offset }), { interval: 1100 });
      if (!Array.isArray(page.docs)) throw new Error('Open Library returned an invalid catalog page');
      for (const item of page.docs) yield { id: item.key, title: item.title, text: [item.title, `Authors: ${(item.author_name || []).join(', ')}`, `First published: ${item.first_publish_year || 'unknown'}`, `Subjects: ${(item.subject || []).map(plain).join('; ')}`].join('\n'), url: `https://openlibrary.org${item.key}`, attribution: 'Open Library contributors', rights: unknown(), metadata: { contentScope: 'book catalog metadata only', original: item } };
      if (page.docs.length < 100 || offset + page.docs.length >= (page.numFound ?? page.num_found)) break;
    }
  },
};
