# Underlying content, not discovery summaries

Version 0.1.4 defaults to collecting the primary material. Source descriptions and abstracts accompany that material; they do not silently replace it when a download fails. Metadata-only mode remains an explicit recipe choice for discovery, bibliographic analysis, or catalog exports.

## arXiv example

For each discovered paper, the collector requests the versioned PDF and submitted source package from arXiv's export service. It saves the PDF and the complete source package, including figures/supporting files inside that package, and extracts PDF text plus textual archive members such as `.tex`, `.bib`, `.sty`, and `.cls`. It retains the abstract, authors, categories, identifiers, dates, and any declared license.

Source availability varies: some submissions contain only a PDF, and ancillary material is not necessarily part of the source package. The app records actual formats and individual failures; it does not invent missing LaTeX. It does not compile submitted code or LaTeX. Full paper text means the extractable text of the retrieved PDF, including available appendices/references, rather than its API abstract. Scanned PDFs need OCR, which is not implemented.

Verified live on 2026-10-22 with `1706.03762v7`: original PDF 2,215,244 bytes / 15 pages; original source archive 1,150,988 bytes; eleven LaTeX-related text members; 130,377 extracted characters across both. Storage and portable export hashes passed.

## Source audit

| Family | Full-mode primary material | Boundary / availability |
| --- | --- | --- |
| arXiv | PDF + submitted source package | Missing source/components explicitly reported |
| Europe PMC | Original full-article XML + extracted content | No invented PDF or supplementary files absent from this API |
| Crossref | Publisher full-text links (PDF/XML/plain text) | Missing links, login walls, and rejected requests reported; no abstract fallback |
| OpenAlex | Public publisher PDF; optional metered OpenAlex PDF/TEI XML | Content API requires a key and explicit access selection; metadata CC0 is not paper CC0 |
| Zenodo | Deposited record files | File/record size caps and unavailable deposits reported |
| CKAN | Dataset resources, collected separately | A resource may itself be an API/landing page rather than a file; inspect its original and extraction result |
| Dataverse | Versioned dataset's public original files, collected separately | Restricted files are reported, not bypassed |
| Open Library | Public-scan edition's linked Internet Archive text and PDF | Borrowed/restricted books and absent formats are unavailable |
| RSS/Atom | Linked article HTML and extracted main article | No recursive site crawl; JS-only pages may lack article text |
| GitHub | Selected source files, verbatim originals + text | Extension/size exclusions and truncated-tree limitation remain |
| Stack Exchange | Full question and answer HTML + extracted text | Posts are separate records with per-post authors/licenses |
| Wikipedia | Full extract + supplied revision's wikitext | Not a full revision history or embedded-media mirror |
| Wikidata | Complete returned entity, including claims/references | Not recursive traversal of every related entity |
| NASA APOD | Explanation + direct image/video file when supplied | Embedded media services may expose no direct downloadable file |
| GovInfo | Publication HTML + PDF | Authenticated live integration check still needed |
| Hugging Face | Selected Viewer text fields + complete returned row | Not all repository shards; external media referenced by a row is not automatically mirrored |
| HTTPS JSONL | Actual selected rows + complete original row objects | Input cap, text-column choice, and no resumable download |
| NVD/CISA/OSV/GitHub advisories | Advisory text + original structured record | References are provenance, not instructions to recursively scrape every referenced website |
| Socrata/USGS | Actual table rows / GeoJSON observations | Source structure preserved; live pagination is not a frozen snapshot |
| Local files | Imported text/code/rows | JSONL attachment references do not authorize reading arbitrary local paths |

This is an audit of implemented behavior, not a claim that every record has every possible attachment. Full mode attempts the source's supplied primary payloads within budgets. Unavailable/oversized components produce named failures and a partial status when something was saved. If every requested component fails, the record is not accepted as if it were a full-content success.

## Files and exports

```text
Desktop/data/Maine-Source/datasets/<run>/
  records/00000001.json
  assets/00000001/001-paper.pdf
  assets/00000001/002-paper-source.tar.gz
  manifest.json
```

Record JSON contains full extracted text, provenance, attachment paths, byte sizes, SHA-256 hashes, extraction information, and component failures. Binary payloads are stored once, outside JSON. The inspector exposes original-file reveal buttons; it never executes downloaded files.

An export consists of `dataset.jsonl` (or `.txt`), its companion manifest, and `dataset.jsonl.assets/` containing originals. Exported JSONL attachment paths are relative to the export location. Keep the asset folder with the export. The byte budget counts records plus their original bytes; record-count limits count logical accepted records, which can each contain several originals.

Defaults are 50 MB per original, 200 MB original data per record, 100 MB extracted/archive text per record, and 60 seconds per complex extraction. Raise download caps in the recipe when appropriate. Downloads rejected by content or policy filters can still consume network traffic; accepted-output budgets are not transfer budgets. Archive members are never executed or written to their supplied paths. OCR, resumable downloads, Parquet/WARC decoding, and automatic external-media mirroring remain future work.
