import { endpoint, plain, unknown } from './helpers.mjs';

export default {
  id: 'openlibrary', name: 'Open Library books', category: 'Books & archives', mark: 'OL', color: '#9a805b',
  description: 'Download publicly accessible book text and PDF files from linked Internet Archive editions, with catalog provenance.',
  input: 'Book, author, or subject search', docs: 'https://openlibrary.org/dev/docs/api/search',
  async *collect({ input, http, settings = {} }) {
    if (!input) throw new Error('Open Library needs a search query');
    for (let offset = 0;; offset += 100) {
      const page = await http.get(endpoint('https://openlibrary.org/search.json', { q: settings.contentMode === 'metadata' ? input : `(${input}) AND public_scan_b:true`, fields: 'key,title,author_name,first_publish_year,subject,language,edition_count,ia,public_scan_b,ebook_access', limit: 100, offset }), { interval: 1100 });
      if (!Array.isArray(page.docs)) throw new Error('Open Library returned an invalid catalog page');
      for (const item of page.docs) {
        const requests = [];
        if (settings.contentMode !== 'metadata' && item.public_scan_b && item.ia?.length) {
          const archive = item.ia[0];
          const original = await http.get(`https://archive.org/metadata/${encodeURIComponent(archive)}`, { interval: 1100 });
          if (original.is_dark || original.metadata?.['access-restricted-item'] === 'true') requests.push({ error: 'This book requires restricted or borrowed access' });
          else {
            const files = original.files || [];
            for (const file of [files.find(f => /_djvu\.txt$/i.test(f.name)), files.find(f => /\.pdf$/i.test(f.name) && f.source === 'original') || files.find(f => /\.pdf$/i.test(f.name))].filter(Boolean)) requests.push({ url: `https://archive.org/download/${encodeURIComponent(archive)}/${file.name.split('/').map(encodeURIComponent).join('/')}`, filename: file.name, role: 'book' });
          }
        }
        yield { id: item.key, title: item.title, text: [item.title, `Authors: ${(item.author_name || []).join(', ')}`, `First published: ${item.first_publish_year || 'unknown'}`, `Subjects: ${(item.subject || []).map(plain).join('; ')}`].join('\n'), url: `https://openlibrary.org${item.key}`, attribution: (item.author_name || []).join(', '), rights: unknown(), contentRequests: requests.length ? requests : [{ error: 'No publicly downloadable book text or PDF was found' }], metadata: { contentScope: 'book files requested', original: item } };
      }
      if (page.docs.length < 100 || offset + page.docs.length >= (page.numFound ?? page.num_found)) break;
    }
  },
};
