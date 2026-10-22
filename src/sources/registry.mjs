// Register new sources here. Each module owns its metadata, form fields, and collector.
// Modules must remain browser-importable: load Node-only packages inside collect().
import advisories from './advisories.mjs';
import arxiv from './arxiv.mjs';
import openalex from './openalex.mjs';
import ckan from './ckan.mjs';
import dataverse from './dataverse.mjs';
import rss from './rss.mjs';
import usgs from './usgs.mjs';
import openlibrary from './openlibrary.mjs';
import jsonl from './jsonl.mjs';
import osv from './osv.mjs';
import socrata from './socrata.mjs';

export const sourceModules = [advisories, osv, arxiv, openalex, ckan, socrata, dataverse, rss, usgs, openlibrary, jsonl];
export const sourceDefinitions = sourceModules.map(({ collect, ...definition }) => definition);
export const sourceCollectors = Object.fromEntries(sourceModules.map(source => [source.id, source.collect]));
