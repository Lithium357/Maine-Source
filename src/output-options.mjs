// Browser-safe settings shared by the desktop shell, exporter, and settings UI.
export const outputOptions = {
  representation: [['plain', 'Extracted plain text'], ['markdown', 'Markdown documents'], ['latex', 'LaTeX source only'], ['originals', 'Preserve source files (originals only)']],
  encoding: [['utf8', 'UTF-8 (recommended)'], ['utf16le', 'UTF-16 little endian'], ['utf16be', 'UTF-16 big endian'], ['utf32le', 'UTF-32 little endian'], ['utf32be', 'UTF-32 big endian']],
  normalization: [['none', 'Preserve Unicode characters'], ['NFC', 'NFC — canonical normalization'], ['NFD', 'NFD — canonical decomposition'], ['NFKC', 'NFKC — compatibility normalization (changes some symbols)'], ['NFKD', 'NFKD — compatibility decomposition (changes some symbols)']],
  newlines: [['preserve', 'Preserve line endings'], ['lf', 'LF — Unix / ML tools'], ['crlf', 'CRLF — Windows']],
  bom: [['auto', 'Automatic (UTF-16/32 only)'], ['always', 'Include byte order mark'], ['never', 'No byte order mark']],
  compression: [['none', 'Uncompressed'], ['gzip', 'gzip (.gz)']],
};
export const defaultTextOutput = () => ({ representation: 'plain', encoding: 'utf8', normalization: 'none', newlines: 'preserve', bom: 'auto', compression: 'none' });
export function validateTextOutput(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid text output settings');
  const result = { ...defaultTextOutput(), ...value };
  for (const [key, choices] of Object.entries(outputOptions)) if (!choices.some(([id]) => id === result[key])) throw new Error(`Invalid text output ${key}`);
  if (Object.keys(result).some(key => !Object.hasOwn(outputOptions, key))) throw new Error('Unknown text output setting');
  return result;
}
export function textExportExtension(value) {
  const settings = validateTextOutput(value);
  if (settings.representation === 'originals') return 'originals.jsonl';
  const ext = { plain: 'txt', markdown: 'md', latex: 'tex' }[settings.representation];
  return ext + (settings.compression === 'gzip' ? '.gz' : '');
}
