import { httpsURL } from './helpers.mjs';

export default {
  id: 'socrata', name: 'Socrata public tables', category: 'Government & law', mark: 'SO', color: '#5a83aa',
  description: 'Collect original table rows from public SODA resource endpoints as searchable JSON text and structured metadata.',
  input: 'HTTPS resource URL, e.g. https://data.cityofnewyork.us/resource/erm2-nwe9.json',
  docs: 'https://dev.socrata.com/docs/queries/',
  fields: [{ id: 'where', label: 'Optional SoQL filter ($where)' }],
  async *collect({ input, settings = {}, http }) {
    const base = httpsURL(input);
    if (!/\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/.test(base.pathname) || base.search) throw new Error('Use a public SODA /resource/xxxx-xxxx.json URL without query parameters');
    // This adapter targets the public SODA resource interface; authenticated SODA 3 is separate.
    for (let offset = 0;; offset += 100) {
      const address = new URL(base);
      address.searchParams.set('$limit', '100'); address.searchParams.set('$offset', String(offset));
      address.searchParams.set('$order', ':id');
      if (settings.where) address.searchParams.set('$where', settings.where);
      const page = await http.get(address.href, { interval: 1100 });
      if (!Array.isArray(page)) throw new Error('Socrata did not return public table rows');
      for (const [index, item] of page.entries()) yield { id: `${base.href}#row=${offset + index}`, title: String(item.name || item.title || `Table row ${offset + index}`), text: JSON.stringify(item), url: base.href, rights: { expression: null, basis: 'unknown', scope: 'record' }, attribution: base.hostname, metadata: { contentScope: 'table row', resource: base.pathname, offset: offset + index, original: item, note: 'Live-table offsets are not immutable record IDs; updates during collection can shift rows.' } };
      if (page.length < 100) break;
    }
  },
};
