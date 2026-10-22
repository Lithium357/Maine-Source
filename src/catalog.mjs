import { sourceDefinitions } from './sources/registry.mjs';

const legacySources = [
  { id: 'nvd', name: 'NIST NVD', category: 'Security', mark: 'NV', color: '#d97735', description: 'CVE descriptions, weaknesses, references, and vulnerability metadata.', key: 'Optional API key', input: 'Keyword search (optional)', docs: 'https://nvd.nist.gov/developers/vulnerabilities' },
  { id: 'cisa', name: 'CISA KEV', category: 'Security', mark: 'KE', color: '#c05c59', description: 'Known exploited vulnerabilities and remediation guidance.', docs: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
  { id: 'github', name: 'GitHub', category: 'Code & computing', mark: 'GH', color: '#454d62', description: 'Public repository code, documentation, and file-level license notices.', key: 'Optional read-only token', input: 'Repositories, one owner/repo per line', docs: 'https://docs.github.com/en/rest/repos/contents' },
  { id: 'stackexchange', name: 'Stack Exchange', category: 'Code & computing', mark: 'SE', color: '#cf763c', description: 'Questions and explanations from programming, security, and engineering communities.', key: 'Optional application key', input: 'Tags separated by semicolons (optional)', docs: 'https://api.stackexchange.com/docs' },
  { id: 'nasa', name: 'NASA Open APIs', category: 'Science & engineering', mark: 'NA', color: '#526eb4', description: 'Astronomy Picture of the Day explanations, dates, and attribution.', key: 'NASA API key (or DEMO_KEY)', input: 'Start date, YYYY-MM-DD (default: 30 days ago)', docs: 'https://api.nasa.gov/' },
  { id: 'europepmc', name: 'Europe PMC', category: 'Science & engineering', mark: 'EP', color: '#3e8c80', description: 'Open-access scientific article full text, with article-specific license evidence.', input: 'Literature search', docs: 'https://europepmc.org/RestfulWebService' },
  { id: 'crossref', name: 'Crossref', category: 'Science & engineering', mark: 'CR', color: '#8f6cb0', description: 'Scholarly titles and abstracts. Full-paper licenses are not assigned to abstracts.', input: 'Research topic', docs: 'https://api.crossref.org/swagger-ui/index.html' },
  { id: 'zenodo', name: 'Zenodo', category: 'Datasets', mark: 'ZE', color: '#3887a3', description: 'CC0 research record metadata and descriptions; attached files are not collected.', input: 'Search research records', docs: 'https://developers.zenodo.org/' },
  { id: 'huggingface', name: 'Hugging Face', category: 'Datasets', mark: 'HF', color: '#b98a26', description: 'Text rows from a chosen dataset, configuration, and split.', key: 'Optional read-only token', input: 'Dataset ID, e.g. owner/dataset', docs: 'https://huggingface.co/docs/dataset-viewer/en/rows' },
  { id: 'wikipedia', name: 'Wikipedia', category: 'Reference & language', mark: 'WP', color: '#687980', description: 'Searchable encyclopedia articles with revision and wiki license metadata.', input: 'Search topic', docs: 'https://www.mediawiki.org/wiki/API:Main_page' },
  { id: 'wikidata', name: 'Wikidata', category: 'Reference & language', mark: 'WD', color: '#629579', description: 'CC0 structured entity labels and descriptions, collected as text records.', input: 'Entity search', docs: 'https://www.wikidata.org/wiki/Wikidata:Data_access' },
  { id: 'govinfo', name: 'GovInfo', category: 'Government & law', mark: 'GI', color: '#7776a9', description: 'Bills, regulations, and government publications in text format.', key: 'Required api.data.gov key', input: 'Collection code, e.g. BILLS, FR, CFR', docs: 'https://www.govinfo.gov/developers' },
  { id: 'local', name: 'Local files', category: 'Your data', mark: 'LF', color: '#6a8c80', description: 'Import JSONL, text, Markdown, or source code through the same filtering pipeline.', docs: null },
  { id: 'gutenberg', name: 'Project Gutenberg', category: 'Books & archives', mark: 'PG', color: '#a58a62', description: 'Planned: book ingestion through approved harvest and mirror endpoints.', planned: true, docs: 'https://www.gutenberg.org/policy/robot_access.html' },
  { id: 'arxiv', name: 'arXiv', category: 'Science & engineering', mark: 'AX', color: '#b56467', description: 'Planned: preprints with per-paper licensing and PDF extraction.', planned: true, docs: 'https://info.arxiv.org/help/api/index.html' },
  { id: 'openalex', name: 'OpenAlex', category: 'Science & engineering', mark: 'OA', color: '#5c8d93', description: 'Planned: research discovery, citations, and scholarly metadata.', planned: true, docs: 'https://help.openalex.org/' },
  { id: 'commoncrawl', name: 'Common Crawl', category: 'Web & news', mark: 'CC', color: '#7b8694', description: 'Planned: WARC ingestion with per-page rights assessment.', planned: true, docs: 'https://commoncrawl.org/' },
  { id: 'rss', name: 'RSS / Atom feeds', category: 'Web & news', mark: 'RS', color: '#c78f4c', description: 'Planned: user-selected feeds with publisher-specific terms.', planned: true },
];
const legacyFields = {
  github: [{ id: 'extensions', label: 'File extensions, comma separated', default: '.py,.js,.ts,.tsx,.rs,.go,.c,.cpp,.h,.java,.md,.txt' }],
  stackexchange: [{ id: 'site', label: 'Community', options: ['stackoverflow', 'security', 'softwareengineering', 'electronics', 'engineering', 'math', 'physics', 'stats'] }],
  wikipedia: [{ id: 'language', label: 'Language code', default: 'en' }],
  huggingface: [{ id: 'config', label: 'Configuration', placeholder: 'Auto-detect' }, { id: 'split', label: 'Split', placeholder: 'Auto-detect' }, { id: 'textField', label: 'Text column', placeholder: 'Auto-detect' }],
};
const legacyCoverage = {
  stackexchange: 'Full questions and answers, original HTML, authors, and per-post license metadata.',
  nasa: 'APOD explanations and direct image/video files when supplied; embedded media availability is reported.',
  crossref: 'Discover and download publisher full-text PDF/XML links, preserving article metadata and download failures.',
  zenodo: 'Download deposited research files, extract supported content, and preserve original files and provenance.',
  wikidata: 'Complete entity JSON including statements and references, plus source metadata.',
  wikipedia: 'Complete article text and revision-pinned wiki source when supplied by the API.',
  huggingface: 'Dataset Viewer rows with selected text fields and the complete returned row preserved.',
  govinfo: 'Government publication HTML and available PDFs, with full-text extraction and original files.',
};
export const sources = [...legacySources.filter(source => !sourceDefinitions.some(definition => definition.id === source.id)).map(source => ({ ...source, ...(legacyCoverage[source.id] ? { description: legacyCoverage[source.id] } : {}), ...(legacyFields[source.id] ? { fields: legacyFields[source.id] } : {}), ...(source.id === 'github' ? { multiline: true } : {}) })), ...sourceDefinitions];
export const presets = {
  'Cybersecurity': ['nvd', 'cisa', 'advisories', 'osv', 'github', 'stackexchange'],
  'CS & engineering': ['github', 'stackexchange', 'nasa', 'europepmc', 'crossref'],
  'Research': ['europepmc', 'crossref', 'arxiv', 'openalex', 'zenodo', 'dataverse', 'huggingface'],
  'General knowledge': ['wikipedia', 'wikidata', 'govinfo', 'openlibrary'],
  'Public data': ['ckan', 'socrata', 'dataverse', 'usgs'],
  'Feeds & files': ['rss', 'jsonl'],
};
export const widgets = [
  { id: 'activity', name: 'Collection activity', description: 'Accepted records across your recent runs', size: 'wide' },
  { id: 'sources', name: 'Source mix', description: 'Where your accepted data comes from' },
  { id: 'jobs', name: 'Recent jobs', description: 'Run status, limits, and progress', size: 'wide' },
  { id: 'quality', name: 'Filter outcomes', description: 'Accepted, excluded, duplicate, and empty records' },
  { id: 'licenses', name: 'License landscape', description: 'Declared licenses in accepted records' },
  { id: 'storage', name: 'Storage & limits', description: 'Dataset size and collection budgets' },
  { id: 'events', name: 'Activity log', description: 'Recent collection decisions and source errors', size: 'wide' },
];
export const defaultRecipe = () => ({
  name: 'Untitled dataset', sourceIds: [], inputs: {}, settings: {}, blacklist: '', contentMode: 'full', requireText: false, contentLimits: { maxFileMB: 50, maxRecordMB: 200 },
  wholeWords: true, caseSensitive: false, licenseMode: 'off', allowLicenses: [], excludeLicenses: [],
  strictness: 1, minLength: 40, deduplicate: true,
  limits: { minutes: 30, megabytes: 100, files: 1000 },
});
