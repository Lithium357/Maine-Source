// Optional, live integration check. No user credentials are read or saved.
import { connectors } from '../src/connectors.mjs';
import { HttpClient } from '../src/http.mjs';
const cases = { nvd: 'buffer', cisa: '', github: 'Lithium357/Maine-Source', nasa: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), stackexchange: 'python', wikipedia: 'engineering', wikidata: 'engineering', europepmc: 'software', crossref: 'engineering', zenodo: 'engineering', huggingface: 'stanfordnlp/imdb' };
const results = await Promise.allSettled(Object.entries(cases).map(async ([id, input]) => {
  const http = new HttpClient({ signal: AbortSignal.timeout(25000) });
  const iterator = connectors[id]({ input, key: '', settings: {}, http });
  try { const first = await iterator.next(); if (first.done || !first.value.text?.trim()) throw new Error('No text returned'); return { source: id, result: 'text returned', license: first.value.rights?.expression || 'Unknown' }; }
  catch (error) { return { source: id, result: error.message }; }
  finally { await iterator.return?.(); }
}));
for (const result of results) console.log(JSON.stringify(result.status === 'fulfilled' ? result.value : { error: result.reason.message }));
