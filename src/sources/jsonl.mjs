import { httpsURL, numberSetting, rights, unknown } from './helpers.mjs';

export default {
  id: 'jsonl', name: 'HTTPS JSONL / gzip files', category: 'Datasets', mark: 'JL', color: '#886ca1',
  description: 'Stream public JSONL or JSONL.gz shards, retaining original rows and optional row-level license metadata.',
  input: 'Public HTTPS file URLs, one per line', multiline: true,
  docs: 'https://jsonlines.org/',
  fields: [{ id: 'textField', label: 'Text column', default: 'text' }, { id: 'maxInputMB', label: 'Maximum input MB per file (transfer and decompressed data)', default: '100', type: 'number', min: 1, max: 4096 }, { id: 'license', label: 'Fallback license declaration (optional; row rights take precedence)' }, { id: 'licenseURL', label: 'Fallback license evidence URL (optional)' }],
  async *collect({ input, settings = {}, http }) {
    const files = String(input || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!files.length) throw new Error('Enter direct HTTPS JSONL file URLs');
    const maxBytes = numberSetting(settings.maxInputMB, 100, 1, 4096, 'Input MB') * 1024 * 1024;
    const textField = settings.textField || 'text';
    for (const address of files) {
      const file = httpsURL(address).href; let row = 0;
      for await (const line of http.lines(file, { maxBytes })) {
        if (!line.trim()) continue;
        row++;
        let item;
        try { item = JSON.parse(line); } catch { throw new Error(`Invalid JSONL at row ${row}`); }
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`JSONL row ${row} must be an object`);
        if (typeof item[textField] !== 'string') throw new Error(`JSONL row ${row} has no string column "${textField}"; choose the text column`);
        yield { id: item.id ?? `${file}#row=${row}`, title: item.title || `Row ${row}`, text: item[textField], url: item.url || file, version: item.version, attribution: item.attribution, rights: item.rights || (item.license ? rights(item.license, item.license_url) : settings.license ? { ...rights(settings.license, settings.licenseURL, 'source'), basis: 'inferred', notes: 'Fallback declaration entered by the user; not verified against the source.' } : unknown()), metadata: { file, row, textField, original: item } };
      }
    }
  },
};
