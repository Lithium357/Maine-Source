import { array, endpoint, parseXML, plain, rights } from './helpers.mjs';

export default {
  id: 'arxiv', name: 'arXiv abstracts', category: 'Science & engineering', mark: 'AX', color: '#b56467',
  description: 'Preprint titles and abstracts, authors, categories, and paper links. No PDF downloads.',
  input: 'arXiv query, e.g. cat:cs.CR or all:robotics', docs: 'https://info.arxiv.org/help/api/user-manual.html',
  async *collect({ input, http }) {
    if (!input) throw new Error('arXiv needs a query such as cat:cs.CR');
    for (let start = 0;; start += 100) {
      const data = await parseXML(await http.get(endpoint('https://export.arxiv.org/api/query', { search_query: input, start, max_results: 100, sortBy: 'submittedDate', sortOrder: 'descending' }), { json: false, interval: 3100 }));
      const items = array(data.feed?.entry);
      for (const item of items) {
        if (!item.id || String(item.id).includes('/api/errors')) throw new Error(`arXiv rejected the query: ${plain(item.summary || 'invalid response')}`);
        const license = array(item.link).find(link => link['@rel'] === 'license')?.['@href'];
        yield { id: item.id, title: plain(item.title), text: plain(item.summary), url: String(item.id).replace(/^http:/, 'https:'), version: item.updated, attribution: array(item.author).map(a => a.name).join(', '), rights: rights(license, license), metadata: { contentScope: 'title and abstract only', categories: array(item.category).map(c => c['@term']), doi: item['arxiv:doi'] } };
      }
      const total = Number(data.feed?.['opensearch:totalResults']);
      if (items.length < 100 || (Number.isFinite(total) && start + items.length >= total)) break;
      // arXiv limits API search pagination to 30,000 results; report it rather than claiming completeness.
      if (start + items.length >= 30000) throw new Error('arXiv search reached its 30,000-result window; narrow the query');
    }
  },
};
