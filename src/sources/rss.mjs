import { array, httpsURL, parseXML, plain, unknown } from './helpers.mjs';

export default {
  id: 'rss', name: 'RSS / Atom feeds', category: 'Web & news', mark: 'RS', color: '#c78f4c',
  description: 'Collect published feed text from RSS or Atom URLs. Does not crawl linked article pages.',
  input: 'HTTPS feed URLs, one per line', multiline: true, docs: 'https://www.rssboard.org/rss-specification',
  async *collect({ input, http }) {
    const urls = String(input || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!urls.length) throw new Error('Enter at least one HTTPS feed URL');
    for (const address of urls) {
      const feedURL = httpsURL(address).href;
      const parsed = await parseXML(await http.get(feedURL, { json: false, interval: 1100 }));
      const channel = parsed.rss?.channel || parsed['rdf:RDF'];
      const atom = parsed.feed;
      if (!channel && !atom) throw new Error('The URL did not return an RSS or Atom feed');
      for (const item of array(atom?.entry || channel?.item)) {
        const value = node => typeof node === 'object' ? node?.['#text'] || '' : node || '';
        const link = atom ? array(item.link).find(l => !l['@rel'] || l['@rel'] === 'alternate')?.['@href'] : item.link;
        const absolute = link ? new URL(value(link), feedURL).href : feedURL;
        yield { id: value(item.id || item.guid) || absolute, title: plain(value(item.title)), text: plain(value(item['content:encoded'] || item.content || item.description || item.summary)), url: absolute, version: item.updated || item.published || item.pubDate || item['dc:date'], attribution: value(item.author?.name || item.author || item['dc:creator']) || value(atom?.title || channel?.title), rights: { ...unknown(), notes: plain(value(item.rights || atom?.rights || channel?.copyright)) || undefined }, metadata: { contentScope: 'feed text only', feedURL } };
      }
    }
  },
};
