import { endpoint, rights } from './helpers.mjs';

export function abstractText(index) {
  const tokens = [];
  for (const [word, positions] of Object.entries(index || {})) for (const position of positions) {
    if (Number.isInteger(position) && position >= 0 && position < 100000) tokens[position] = word;
  }
  return tokens.filter(v => v !== undefined).join(' ');
}
export default {
  id: 'openalex', name: 'OpenAlex', category: 'Science & engineering', mark: 'OA', color: '#5c8d93',
  description: 'Research titles, reconstructed abstracts, citation counts, and scholarly metadata. No paper files.',
  key: 'Optional OpenAlex API key (API budget applies)', input: 'Research topic', docs: 'https://help.openalex.org/api/',
  async *collect({ input, key, http }) {
    if (!input) throw new Error('OpenAlex needs a research topic');
    let cursor = '*'; const cursors = new Set();
    while (cursor) {
      const page = await http.get(endpoint('https://api.openalex.org/works', { search: input, filter: 'has_abstract:true', per_page: 100, cursor, api_key: key || undefined }), { interval: 1100 });
      if (!Array.isArray(page.results)) throw new Error('OpenAlex returned an invalid results page');
      for (const item of page.results) yield { id: item.id, title: item.display_name, text: abstractText(item.abstract_inverted_index), url: item.id, version: item.updated_date, attribution: (item.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', '), rights: rights('CC0-1.0', 'https://help.openalex.org/access/overview/', 'source'), metadata: { contentScope: 'scholarly metadata and abstract only', doi: item.doi, publicationDate: item.publication_date, citedByCount: item.cited_by_count, locations: item.locations } };
      if (!page.results.length || !page.meta?.next_cursor) break;
      const next = page.meta.next_cursor;
      if (cursors.has(next)) throw new Error('OpenAlex repeated its cursor');
      cursors.add(next); cursor = next;
    }
  },
};
