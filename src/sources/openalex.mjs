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
  description: 'Download available open-access paper PDFs, with research metadata, abstracts, and citation provenance.',
  key: 'Optional OpenAlex API key (API budget applies)', input: 'Research topic', docs: 'https://help.openalex.org/api/',
  fields: [{ id: 'contentAccess', label: 'Full-text access', options: ['Public publisher PDF', 'OpenAlex content API (metered; key required)'] }],
  async *collect({ input, key, http, settings = {}, resume = {}, checkpoint = async () => {} }) {
    if (!input) throw new Error('OpenAlex needs a research topic');
    let cursor = resume.cursor || '*'; const cursors = new Set();
    while (cursor) {
      const page = await http.get(endpoint('https://api.openalex.org/works', { search: input, filter: settings.contentMode === 'metadata' ? 'has_abstract:true' : 'is_oa:true', per_page: 100, cursor, api_key: key || undefined }), { interval: 1100 });
      if (!Array.isArray(page.results)) throw new Error('OpenAlex returned an invalid results page');
      for (const item of page.results) {
        const locations = [...new Map([item.best_oa_location, ...(item.locations || [])].filter(l => l?.pdf_url && l.is_oa !== false).map(l => [l.pdf_url, l])).values()];
        locations.sort((a, b) => Number(/(?:arxiv\.org|europepmc\.org|pmc\.ncbi\.nlm\.nih\.gov)/i.test(b.pdf_url)) - Number(/(?:arxiv\.org|europepmc\.org|pmc\.ncbi\.nlm\.nih\.gov)/i.test(a.pdf_url)));
        const location = locations[0];
        const work = String(item.id).split('/').at(-1);
        const metered = settings.contentAccess === 'OpenAlex content API (metered; key required)';
        if (metered && !key) throw new Error('OpenAlex content API needs a key; choose public publisher PDF or connect a key');
        const candidates = locations.slice(0, 5).map(l => ({ url: l.pdf_url.replace(/^http:/, 'https:'), rights: rights(l.license, l.landing_page_url || item.id) }));
        const requests = metered ? [{ url: endpoint(`https://content.openalex.org/works/${work}.pdf`, { api_key: key }), filename: `${work}.pdf`, role: 'paper' }, { url: endpoint(`https://content.openalex.org/works/${work}.grobid-xml`, { api_key: key }), filename: `${work}.xml`, role: 'paper XML' }] : location ? [{ ...candidates[0], alternatives: candidates.slice(1), primaryRights: true, filename: `${work}.pdf`, role: 'paper' }] : [{ error: 'No public full-text PDF link was supplied; metadata-only mode is available explicitly' }];
        yield { id: item.id, title: item.display_name, text: abstractText(item.abstract_inverted_index), url: item.id, version: item.updated_date, attribution: (item.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', '), rights: settings.contentMode === 'metadata' ? rights('CC0-1.0', 'https://help.openalex.org/api/', 'source') : rights(location?.license, location?.landing_page_url || item.id), contentRequests: requests, metadata: { contentScope: 'paper content requested', abstract: abstractText(item.abstract_inverted_index), doi: item.doi, publicationDate: item.publication_date, citedByCount: item.cited_by_count, original: item } };
      }
      if (!page.results.length || !page.meta?.next_cursor) break;
      const next = page.meta.next_cursor;
      if (cursors.has(next)) throw new Error('OpenAlex repeated its cursor');
      cursors.add(next); cursor = next; await checkpoint({ cursor });
    }
  },
};
