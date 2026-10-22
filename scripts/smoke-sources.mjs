// Optional, live integration check. No user credentials are read or saved.
import { connectors } from '../src/connectors.mjs';
import { HttpClient } from '../src/http.mjs';
import { materialize } from '../src/content.mjs';
const cases = { nvd: 'buffer', cisa: '', github: 'Lithium357/Maine-Source', nasa: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), stackexchange: 'python', wikipedia: 'engineering', wikidata: 'engineering', europepmc: 'software', crossref: 'engineering', zenodo: 'engineering', huggingface: 'stanfordnlp/imdb' };
Object.assign(cases, { advisories: 'lodash', osv: 'requests', arxiv: 'cat:cs.CR', openalex: 'engineering', ckan: 'energy', socrata: 'https://data.cityofnewyork.us/resource/erm2-nwe9.json', dataverse: 'engineering', rss: 'https://www.nasa.gov/feed/', usgs: '', openlibrary: 'engineering' });
cases.jsonl = 'https://huggingface.co/datasets/databricks/databricks-dolly-15k/resolve/main/databricks-dolly-15k.jsonl';
const full = process.argv.includes('--full');
const selected = process.argv.slice(2).filter(arg => arg !== '--full');
if (selected.some(id => !Object.hasOwn(cases, id))) throw new Error('Unknown smoke source ID');
let failures = 0;
const results = await Promise.allSettled(Object.entries(cases).filter(([id]) => !selected.length || selected.includes(id)).map(async ([id, input]) => {
  const http = new HttpClient({ signal: AbortSignal.timeout(full ? 120000 : 25000) });
  const settings = { ...(id === 'jsonl' ? { textField: 'response' } : {}), contentMode: full ? 'full' : 'metadata' };
  const iterator = connectors[id]({ input: full && id === 'arxiv' ? '1706.03762' : input, key: '', settings, http });
  try { const first = await iterator.next(); if (first.done) throw new Error('No record returned'); const record = await materialize(first.value, http, settings); if (!record.text?.trim() && !record.attachments?.length) throw new Error('No content returned'); return { source: id, result: 'content returned', mode: settings.contentMode, textCharacters: record.text?.length || 0, originalFiles: record.attachments?.length || 0, contentStatus: record.metadata?.contentStatus, license: record.rights?.expression || 'Unknown' }; }
  catch (error) { failures++; return { source: id, result: error.message }; }
  finally { await iterator.return?.(); }
}));
for (const result of results) console.log(JSON.stringify(result.status === 'fulfilled' ? result.value : { error: result.reason.message }));
if (failures || results.some(result => result.status === 'rejected')) process.exitCode = 1;
