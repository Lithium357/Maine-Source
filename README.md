# Maine Source

A Windows desktop workbench for collecting text and code into traceable ML datasets. Pick sources with checkboxes, define reusable recipes, and watch a customizable local dashboard.

**Status: 0.3.2 alpha.** Underlying content is the default: papers, deposited files, linked articles, source code, and complete structured records are collected alongside provenance. Original files are saved separately from extracted text and included in portable exports. Metadata-only collection is an explicit recipe option. This is a local Windows application with no hosted collection backend.

## Run or install

Run `Maine Source Setup 0.3.2.exe` from the build's `release/` folder to install for your Windows user. **This application is unsigned because the developer cannot currently afford code signing.** Windows may display an unknown-publisher or protection warning. We plan to distribute 1.0 unsigned too. Download only from the official [GitHub releases](https://github.com/Lithium357/Maine-Source/releases) and compare the published SHA-256 checksum. Checksums detect file changes; they do not provide a verified publisher identity. No independent security audit has been performed. An unpacked app is also generated in `release/win-unpacked/`.

For development, install Node.js 24 and pnpm 11, then:

```sh
pnpm install
pnpm start
```

If a package manager skips Electron's runtime installation, run `node node_modules/electron/install.js` once. Only Electron's official runtime and the documented packaging tools are needed; there is no Python runtime requirement for the app.

```sh
pnpm check
pnpm test
pnpm dist
```

`pnpm preview` opens a development-only HTTP UI at `http://127.0.0.1:4318/?preview=1`. It uses **clearly labeled simulated data**, cannot collect data or store credentials, and its adapter is excluded from packaged builds. `node scripts/smoke-sources.mjs` optionally checks public APIs without reading any user credentials.

## First collection

1. Open **Sources**, check the sources you want, or use a cybersecurity, engineering, research, or general knowledge preset. Save your selection.
2. Open **Connections & settings** to add credentials, then use **Test connection**. A successful small request does not prove access to every dataset or download. Public GitHub repositories work without a token. Optional tokens should be read-only; write permissions are unnecessary. NASA uses one credential across supported NASA services; the first connector collects APOD explanations.
3. Choose **New collection**, name the dataset, and enter each source's query. GitHub takes `owner/repo` names, Hugging Face takes a dataset ID, and NASA accepts a start date.
4. Keep **Underlying content + original files + metadata**, or explicitly choose metadata-only collection. Set per-file/per-record download caps, keyword exclusions, deduplication, and optional license rules. Blacklists inspect extracted full content.
5. Choose a **Download folder** in the recipe, or keep the workspace default. Each run gets its own dataset subfolder so existing files are not overwritten. The folder choice is remembered with that recipe.
6. Set at least one limit. The first elapsed-time, saved-byte, or accepted-document limit reached ends the whole job.
7. Collect, inspect decisions and original files, then export JSONL or text from **Datasets**. Exports include a companion manifest and, when originals exist, an adjacent `.assets` folder. Keep all three together.

The home dashboard includes activity history, source mix, recent jobs, filter outcomes, license declarations, storage budgets, and events. **Customize** lets you hide widgets, drag them to reorder, or use keyboard-accessible arrow controls. Layout changes persist.

## Python API and portable keys

Agents can collect without GUI control using the [Python API](python/README.md). Install the release wheel with `python -m pip install maine_source-0.3.2-py3-none-any.whl`, then use `from maine_source import Client`. The installed app supplies its own backend runtime; only the Python API needs Python 3.10+. Source-checkout development also supports Node.js 24. The API supports source discovery, recipes, collection, progress, pause/resume/stop, record browsing, validation, folder changes, and export. It uses a private local subprocess connection; no network listener is opened.

In **Connections & settings**, use **Import keys JSON** / **Export keys JSON** to transfer all keys between machines or configurations. Both flat source-ID mappings and versioned bundles work with the GUI and Python API. **Portable credential JSON is plaintext**; keep it private and out of Git. GUI imports can be session-only or remembered with encrypted system storage. Python keys remain in that client’s memory unless explicitly exported.

**Resume:** missing record files no longer block the entire dataset. Recovery preserves surviving files, processed-item history, and source checkpoints, reports missing slots, and appends above the highest committed index. Quarantined files are not restored by recovery. Large datasets show saved-file checking progress. Paused runs have a direct Resume button in Jobs, Datasets, and run details. After closing/restarting the app, interrupted or stopped runs resume into the same dataset with saved records/checkpoints. Reached total budgets must be increased. For local imports, choose the original files again. Pauses still count toward wall-clock limits.

## Source coverage

Every release includes the [complete source and API-key signup list](docs/release-notes-template.md#all-implemented-sources-and-api-keys), including sources from earlier versions. Sources without a key are explicitly marked. The list is generated from the implemented source catalog; release workflows attach it and maintain it in the GitHub release description.

| Connector | Collected content | Credential | Licensing behavior |
| --- | --- | --- | --- |
| NIST NVD | CVE descriptions plus complete returned CVE JSON | Optional NVD API key | Unknown unless applicable evidence is supplied |
| CISA KEV | Descriptions/actions plus complete returned KEV entry | None | Unknown by default |
| GitHub | Selected code files via Contents API, or complete tarball snapshot | Optional read-only PAT | Repository declaration and file SPDX notices; chosen ref resolved and pinned |
| NASA Open APIs | APOD explanation and direct media file when supplied | NASA key or restricted DEMO_KEY | Original notices retained; embedded services may not expose a download |
| Stack Exchange | Questions and answers, original HTML, per-post metadata | Optional application key | Per-post license and author attribution |
| Europe PMC | Full article XML and extracted text | None | Article-specific license evidence |
| Crossref | Available publisher full-text PDF/XML/plain-text links | None | Paper declarations apply to requested paper content; access may fail |
| Zenodo | Deposited research files and supported text extraction | None | Deposited-content declarations; metadata-only CC0 is kept separate |
| Hugging Face | Revision-pinned repository files/shards, or Viewer rows | Optional read token | Dataset-card declarations; raw files and repository paths retained |
| Wikipedia | Complete article extract and supplied revision-pinned wiki source | None | Wiki terms, revision IDs, and history links |
| Wikidata | Complete entity JSON, including statements and references | None | CC0 source declaration |
| GovInfo | Publication HTML and available PDF | Required api.data.gov key | Unknown; public demo-key sample checked, owner-key permissions still unverified |
| GitHub Security Advisories | Reviewed advisory descriptions, packages, version ranges, and aliases | Optional read-only GitHub token | CC-BY-4.0 source declaration |
| OSV | Vulnerabilities for a selected package/ecosystem/version | None | Original upstream data retained; no blanket license assignment |
| arXiv papers & source | Original PDF, submitted source package, full extracted text, abstract | None | Available paper license link retained |
| OpenAlex | Public publisher PDF, or opt-in metered OpenAlex PDF/XML | Optional OpenAlex key | Paper and metadata declarations remain separate |
| CKAN portals | Dataset resource downloads, one resource per record | None; public portals | Dataset declarations retained |
| Socrata | Original public table rows as JSON text plus structured metadata | None; public resource endpoints | Unknown; dataset terms remain user discretion |
| Research Dataverse | Accessible original dataset files, one file per record | None; public repositories | Version-level declaration retained; restricted files reported |
| RSS / Atom | Linked article HTML and main article text, with feed provenance | None | Publisher notices retained |
| USGS Earthquakes | Observations, magnitude, time, geometry, and original GeoJSON | None | Unknown by default |
| Open Library books | Publicly downloadable Internet Archive book text/PDF | None | Borrowed/restricted books are unavailable to this connector |
| HTTPS JSONL / gzip | Incrementally streamed rows from public file/shard URLs | None | Row declarations take precedence over optional user-supplied fallback |
| Local files | JSONL, text, Markdown, source code | None | User-supplied JSONL rights preserved; other files unknown |

Project Gutenberg and Common Crawl remain disabled roadmap entries. PDF extraction, HTML article extraction, and bounded ZIP/tar/gzip text extraction are implemented. OCR, arbitrary site crawling, automatic updates, Parquet/WARC reading, and byte-range download resumption are not. Collection resume and large GitHub tree traversal are implemented. Sources end naturally when exhausted.

See the [source expansion research](docs/source-research-2026-10-22.md) for further large corpora and specialist collections. The table above describes implemented coverage; research recommendations may require capabilities beyond the current connector.

### More public data, without adding code

- **GitHub:** choose `files` for selected code/documentation or `archive` for a repository tarball. A branch, tag, or commit is resolved to a SHA and retained across resume.
- **Hugging Face:** `files` is now the default and downloads actual revision-pinned repository files, including dataset shards. Choose `rows` for the previous Viewer behavior. Download caps still apply; Parquet is preserved as a binary original, without extracting its rows.
- **Stack Exchange:** advanced search supports tags such as `nlp`, free text, excluded tags, creation dates, sort, and ascending/descending order. Defaults match the requested ascending creation query, with full question/answer bodies.

See [repository downloads and advanced search](docs/repository-downloads.md) for settings, endpoints, and Python examples.

- **CKAN:** defaults to the Humanitarian Data Exchange; other compatible portal URLs work too. The catalog discovers downloadable resources; full mode retrieves those resources.
- **Research Dataverse:** defaults to Harvard Dataverse. Full mode follows dataset versions and downloads public original files.
- **Socrata:** paste a public `/resource/xxxx-xxxx.json` URL and optionally enter a SoQL filter. This connector uses the public resource interface, not authenticated SODA 3. Live-table changes can shift offset-based rows during collection.
- **RSS / Atom:** enter one HTTPS feed URL per line. Full mode downloads linked article HTML and extracts its main text; metadata mode retains feed text.
- **HTTPS JSONL / gzip:** enter public file URLs, choose the text column, and set an input MB cap per file. For example, the official [Dolly dataset](https://huggingface.co/datasets/databricks/databricks-dolly-15k) provides a JSONL download with `response` as a usable text column. Original rows, including instructions/context, remain in metadata. The collector does not infer the dataset's license merely from its download URL.

Live checks on 2026-10-22 retrieved underlying files/content through arXiv, CKAN, Dataverse, Zenodo, RSS, Europe PMC, GitHub, and Wikidata. The arXiv end-to-end check saved the 15-page PDF and submitted source archive for `1706.03762v7`, extracted 130,377 characters across paper and source, found eleven LaTeX-related members, and verified exported original-file hashes. These are small integration samples, not completeness benchmarks. Use `node scripts/smoke-content.mjs` for the paper storage/export check or `pnpm smoke -- --full arxiv` for retrieval. Ordinary `pnpm smoke` checks discovery/metadata without following content links.

Version 0.3.2 passes 175 automated tests, including full-text keyword matching, original-file budget accounting, portable exports, partial failures, repository pagination, pinned revisions, credential stripping on download redirects, and cancellation of isolated extraction subprocesses. The 0.1.4 packaged GUI collected the complete arXiv test paper with both originals, 130,377 extracted characters, zero errors, and the exact one-record stop. The inspector displayed both original-file controls and downloaded status. The 0.1.5 GUI saved UTF-32 preferences and exported that existing paper as UTF-32 plain text (521,788 bytes) and actual LaTeX source (10 `.tex` members), preserving both original-file hashes. Earlier GUI checks verified CISA on 0.1.2 and USGS on 0.1.3. See [content coverage](docs/content-coverage.md) for the source audit and exact behavior.

## Release preparation

The owner has chosen unsigned distribution and no independent third-party security audit. These are disclosed limitations, not pending signing/audit requirements. The manual **Unsigned release candidate** workflow builds tagged candidates with the disclosure, notices, and checksums; it does not publish automatically.

**Move one dataset:** Datasets → **Change folder** copies its records, originals, and checkpoints, verifies the copied files with SHA-256, and switches browsing/resume/export to the new location. Stop collection first. The old copy stays as a backup; unrelated datasets and existing exports remain where they are. **Open folder** reveals the active location. External drives must be connected when using their datasets. Portable export manifests omit these local download paths.

Storage can be copied to another drive from Settings; the previous folder is retained. Datasets now offers browsing/search/filtering across all records, full-text paging, original-file validation, Resume for unfinished runs, and confirmed Recycle Bin removal. Runtime dependency notices ship with the app, and builds generate SHA-256 checksums. See [release readiness and remaining external gates](docs/release-readiness.md) and [changelog](CHANGELOG.md). This is still an alpha, not a release-ready 1.0.

## License policies and evidence

The complete installed SPDX identifier list, including deprecated identifiers, is searchable. SPDX `AND`, `OR`, and `WITH` expressions are supported, as are exact custom terms and `LicenseRef-*` declarations. No known license becomes permission simply because content is publicly accessible.

**New recipes disable license filtering by default**, leaving copyright uncertainty to the user while retaining provenance. Existing saved recipes keep their policy. Enable a license policy and the 1–10 evidence slider when you want restrictions.

- **Any license:** accept a known declaration if it meets the selected evidence requirements and is not explicitly excluded. All-rights-reserved content is excluded while the gate is enabled.
- **Allowlist:** a declaration must match a selected license. Unknown records do not pass, even at level 1. An exclusion anywhere in an SPDX expression overrides an allowed alternative.
- **Off:** bypass license filtering and retain the original metadata and a warning in each accepted record.

| Strictness | Additional requirement |
| --- | --- |
| 1 | Missing evidence and conflicts may pass with warnings |
| 2 | Conflicting evidence excluded |
| 3 | Unknown evidence excluded; inferred terms may pass |
| 4 | Explicit source declaration required |
| 5 | Evidence URL required |
| 6 | Record or repository scope required |
| 7 | Individual record or file scope required |
| 8 | Recorded content version required |
| 9 | Explicit license notice in collected content required |
| 10 | Matching source declaration must corroborate that notice |

These are deterministic evidence requirements, not legal-confidence percentages. Custom terms and inferred evidence can remain unresolved. The software preserves declarations and provenance; it cannot guarantee ownership, worldwide copyright status, or compliance with every obligation. Public domain and CC0 are distinct values. A collection can contain multiple licenses and the exporter does not invent a single replacement license for it.

Keyword filtering scans the **title and text**, using literal lines, Unicode normalization, optional whole-word matching, and optional case sensitivity. It is not semantic topic classification. Duplicate detection normalizes whitespace and Unicode within a run.

## Limits, storage, and credentials

- Each accepted record has JSON plus any original files under its run's `assets/` directory. Document limits count accepted records, not every physical attachment. Output byte limits include serialized record metadata and all saved original bytes. Manifests, preferences, and bounded logs are outside that budget.
- Wall-clock time includes pauses, network requests, and rate-limit waits. There is one active collection at a time; sources are advanced in turn. An outstanding source request can delay another source until it returns or times out.
- Transient HTTP failures and rate limits are retried with cancellable waits. Redirects are not followed with credentials. Response bodies and local text files have size limits.
- Stopping or quitting cancels network waits. Saved runs remain inspectable; a run interrupted by an unexpected exit is marked interrupted after restart. Use Resume in Datasets to continue an interrupted/stopped/failed run. Saved records and supported page checkpoints are reused; other sources replay discovery. Budgets include prior sessions, excluding time while the app is closed.
- On startup the app creates `data/Maine-Source/` on the user’s actual Windows Desktop, including a redirected or OneDrive Desktop. Collected records and run history live under `datasets/`; the export dialog defaults to `exports/`. The settings screen opens this Desktop data folder. Older internal datasets are copied across on first use when no Desktop dataset folder exists, leaving the original copy untouched. Preferences and credentials remain in private per-user application storage. Keys are encrypted using Electron `safeStorage` when remembered, or held only in process memory for the session. They never enter recipes, dataset records, exports, or the preview adapter.
- JSONL imports support `text` (or `content`), `title`, `url`, `version`, `attribution`, and `rights: { expression, basis, scope, url }`. Stronger evidence flags can be supplied but are user assertions, not independently validated facts.
- Public HTTPS JSONL downloads stream UTF-8 or gzip without buffering the whole file. Transfer bytes and decompressed bytes are each capped by the per-file input budget (default 100 MB); a row is capped at 12 MB. Up to five anonymous HTTPS redirects are allowed for file/CDN downloads, while credentialed API requests still reject redirects. Input caps end with an explicit source error rather than pretending the file was exhausted. Downloads do not resume after interruption.
- Original downloads default to 50 MB per file and 200 MB per record, configurable in the recipe. Extracted/archive text is bounded at 100 MB per record. Complex extraction runs in an isolated subprocess with a 60-second timeout and cancellation. Archives are inspected without extracting filesystem paths or executing LaTeX/scripts. Unsupported/scanned content is retained as an original with a warning; enable **Exclude original files if no searchable text can be extracted** to reject it. Keyword filters can only inspect titles when extraction yields no text.

## Text output preferences

**Connections & settings → Text output** controls the **Datasets → Text output** export: unchanged source files, plain text, Markdown, or actual LaTeX source; UTF-8, UTF-16 LE/BE, or UTF-32 LE/BE; optional Unicode normalization, line endings, BOM, and gzip. Original files remain unchanged and JSONL remains UTF-8. See [format behavior and research](docs/text-output.md), including why UTF-8 + gzip is offered instead of SCSU.

## Contributing sources

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [connector guide](docs/adding-a-source.md). A new connector lives in one module containing its catalog metadata, declarative GUI settings, and async collector, plus registration in `src/sources/registry.mjs`. A [copyable template](docs/templates/example-source.mjs), shared helpers, contract tests, and a GitHub source-request form are included. Routine source settings need no UI-specific code.

## Project layout

`desktop/` contains the sandboxed Electron shell and restricted IPC bridge. `src/` contains the source catalog, connectors, HTTP client, collector, and license policy. `ui/` is a dependency-light interface without a remote UI service. `tests/` verifies policy boundaries, API response formats, collection budgets, cancellation, restart behavior, and export integrity. The Windows CI workflow runs checks, tests, and an installer build.

Licensed under GPL-3.0; see [LICENSE](LICENSE).
