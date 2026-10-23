import { array, endpoint, parseXML, plain, rights } from './helpers.mjs';

export default {
  id: 'arxiv', name: 'arXiv papers & source', category: 'Science & engineering', mark: 'AX', color: '#b56467',
  description: 'Full paper text, original PDF, and submitted LaTeX/source package when available, with abstract and provenance.',
  input: 'arXiv query, e.g. cat:cs.CR or all:robotics', docs: 'https://info.arxiv.org/help/api/user-manual.html',
  async *collect({ input, http, resume = {}, checkpoint = async () => {} }) {
    if (!input) throw new Error('arXiv needs a query such as cat:cs.CR');
    for (let start = Number.isSafeInteger(resume.start) && resume.start >= 0 ? resume.start : 0;; start += 100) {
      const exactId = /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(input);
      const data = await parseXML(await http.get(endpoint('https://export.arxiv.org/api/query', { ...(exactId ? { id_list: input } : { search_query: input }), start, max_results: 100, sortBy: 'submittedDate', sortOrder: 'descending' }), { json: false, interval: 3100 }));
      const items = array(data.feed?.entry);
      for (const item of items) {
        if (!item.id || String(item.id).includes('/api/errors')) throw new Error(`arXiv rejected the query: ${plain(item.summary || 'invalid response')}`);
        const license = array(item.link).find(link => link['@rel'] === 'license')?.['@href'];
        const paper = String(item.id).replace(/^http:/, 'https:');
        const identifier = new URL(paper).pathname.replace(/^\/abs\//, '');
        if (!/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/i.test(identifier)) throw new Error('Invalid arXiv paper identifier');
        const name = identifier.replace('/', '_');
        yield { id: item.id, title: plain(item.title), text: plain(item.summary), url: paper, version: item.updated, attribution: array(item.author).map(a => a.name).join(', '), rights: rights(license, license), contentRequests: [{ url: `https://export.arxiv.org/pdf/${identifier}`, filename: `${name}.pdf`, role: 'paper', interval: 3100 }, { url: `https://export.arxiv.org/src/${identifier}`, filename: `${name}-source.tar.gz`, role: 'submitted source', interval: 3100 }], metadata: { contentScope: 'paper and source requested', abstract: plain(item.summary), categories: array(item.category).map(c => c['@term']), doi: item['arxiv:doi'] } };
      }
      const total = Number(data.feed?.['opensearch:totalResults']);
      await checkpoint({ start: start + 100 });
      if (items.length < 100 || (Number.isFinite(total) && start + items.length >= total)) break;
      // arXiv limits API search pagination to 30,000 results; report it rather than claiming completeness.
      if (start + items.length >= 30000) throw new Error('arXiv search reached its 30,000-result window; narrow the query');
    }
  },
};
