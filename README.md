# Maine Source

A Windows desktop workbench for collecting text and code into traceable ML datasets. Pick sources with checkboxes, define reusable recipes, and watch a customizable local dashboard.

**Status: 0.1.3 alpha.** The collector, desktop UI, and Windows installer are implemented. Twenty-two online connectors have passed small public-data checks; GovInfo needs an authenticated integration check. The packaged GUI has been used to select a source, save a recipe, collect two real CISA records, stop at the document limit, and export valid JSONL plus a manifest to the Desktop data folder. This is a local application: there is no hosted account or collection backend.

## Run or install

Run `Maine Source Setup 0.1.3.exe` from the build's `release/` folder to install for your Windows user. This alpha installer is unsigned; public distribution still needs a signing certificate and release verification. An unpacked app is also generated in `release/win-unpacked/`.

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
2. Open **Connections & settings** to add credentials. Public GitHub repositories work without a token. Optional tokens should be read-only; write permissions are unnecessary. NASA uses one credential across supported NASA services; the first connector collects APOD explanations.
3. Choose **New collection**, name the dataset, and enter each source's query. GitHub takes `owner/repo` names, Hugging Face takes a dataset ID, and NASA accepts a start date.
4. Set keyword exclusions, minimum text length, deduplication, a license policy, and evidence strictness from 1 to 10.
5. Set at least one limit. The first elapsed-time, saved-byte, or accepted-document limit reached ends the whole job.
6. Collect, inspect decisions, then export JSONL or text from **Datasets**. Each export includes a companion manifest containing the recipe, totals, source counts, and stopping reason.

The home dashboard includes activity history, source mix, recent jobs, filter outcomes, license declarations, storage budgets, and events. **Customize** lets you hide widgets, drag them to reorder, or use keyboard-accessible arrow controls. Layout changes persist.

## Source coverage

| Connector | Collected content | Credential | Licensing behavior |
| --- | --- | --- | --- |
| NIST NVD | English CVE descriptions and references | Optional NVD API key | Unknown unless applicable evidence is supplied; no blanket CC0 assignment |
| CISA KEV | Vulnerability summaries and required actions | None | Unknown by default |
| GitHub | Selected text/code extensions in public repositories | Optional read-only PAT | Repository declaration plus file SPDX notices; conflicts retained; commit pinned |
| NASA Open APIs | APOD explanations | NASA key or restricted DEMO_KEY | Media copyright notices retained; text reuse rights remain unknown |
| Stack Exchange | Question titles and bodies; selectable community/tags | Optional application key | Per-post `content_license` and author attribution |
| Europe PMC | Open-access article body text | None | License evidence extracted from article XML |
| Crossref | Scholarly titles and abstracts | None | Full-paper terms are retained separately, never automatically assigned to abstracts |
| Zenodo | Record titles and descriptions, **not attached files** | None | Metadata CC0 declaration; attached-file license retained separately |
| Hugging Face | String columns from Dataset Viewer rows | Optional read token | Dataset-card declarations, revision, configuration, split, and row IDs retained |
| Wikipedia | Full plain-text article extracts | None | Wiki license metadata, revision IDs, and history links |
| Wikidata | Entity labels, descriptions, aliases | None | CC0 source declaration for structured data |
| GovInfo | Government publication text | Required api.data.gov key | Unknown by default; authenticated live check outstanding |
| GitHub Security Advisories | Reviewed advisory descriptions, packages, version ranges, and aliases | Optional read-only GitHub token | CC-BY-4.0 source declaration |
| OSV | Vulnerabilities for a selected package/ecosystem/version | None | Original upstream data retained; no blanket license assignment |
| arXiv abstracts | Preprint titles and abstracts, **not PDFs/full papers** | None | Unknown unless a license link is supplied |
| OpenAlex | Research metadata and reconstructed abstracts, **not paper files** | Optional OpenAlex key | CC0 metadata declaration |
| CKAN portals | Dataset descriptions and resource links, **not attached files** | None; public portals | Dataset license retained separately from catalog metadata rights |
| Socrata | Original public table rows as JSON text plus structured metadata | None; public resource endpoints | Unknown; dataset terms remain user discretion |
| Research Dataverse | Dataset descriptions, citations, and identifiers, **not attached files** | None; public repositories | Unknown; no assumed file license |
| RSS / Atom | Published feed text, **not linked page crawling** | None | Publisher notices retained; unknown by default |
| USGS Earthquakes | Observations, magnitude, time, geometry, and original GeoJSON | None | Unknown by default |
| Open Library | Book catalog records, **not book text** | None | Unknown by default |
| HTTPS JSONL / gzip | Incrementally streamed rows from public file/shard URLs | None | Row declarations take precedence over optional user-supplied fallback |
| Local files | JSONL, text, Markdown, source code | None | User-supplied JSONL rights preserved; other files unknown |

Project Gutenberg and Common Crawl are visible as **disabled roadmap entries**, not working connectors. Generic website crawling, PDF extraction, recursive GitHub tree recovery, automatic updates, Parquet/WARC ingestion, and resumable bulk downloads are not included in this alpha. Sources with no remaining results end naturally rather than fabricating more records.

See the [source expansion research](docs/source-research-2026-10-22.md) for further large corpora and specialist collections. The table above describes implemented coverage; research recommendations may require capabilities beyond the current connector.

### More public data, without adding code

- **CKAN:** defaults to the Humanitarian Data Exchange. Set the portal to `https://open.canada.ca/data` for Canada's public catalog, or another compatible CKAN base URL.
- **Research Dataverse:** defaults to Harvard Dataverse; change the repository URL for another compatible public installation.
- **Socrata:** paste a public `/resource/xxxx-xxxx.json` URL and optionally enter a SoQL filter. This connector uses the public resource interface, not authenticated SODA 3. Live-table changes can shift offset-based rows during collection.
- **RSS / Atom:** enter one HTTPS feed URL per line. Only the text distributed in the feed is collected.
- **HTTPS JSONL / gzip:** enter public file URLs, choose the text column, and set an input MB cap per file. For example, the official [Dolly dataset](https://huggingface.co/datasets/databricks/databricks-dolly-15k) provides a JSONL download with `response` as a usable text column. Original rows, including instructions/context, remain in metadata. The collector does not infer the dataset's license merely from its download URL.

On 2026-10-22 all eleven new connectors returned text in live public-data checks. The JSONL check read a real Dolly row through its Hugging Face HTTPS download. Checks were small samples, not completeness or throughput benchmarks. Run `pnpm smoke -- advisories osv arxiv openalex ckan socrata dataverse rss usgs openlibrary jsonl` to repeat these without saved credentials.

Version 0.1.3 passes 101 automated tests and builds a Windows installer. Its packaged GUI passed a live USGS walkthrough: choose the source, set minimum magnitude to 4.5, save and collect with a two-document limit, observe completion, and export through the native save dialog. The exported rows and manifest confirmed the saved settings, two qualifying observations, preserved GeoJSON geometry, and zero errors. Both GitHub Windows CI runs for the implementation commit passed. The earlier CISA walkthrough was performed on 0.1.2.

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

- Each accepted document is stored as one JSON record file. Document limits count accepted documents; byte limits include their full serialized metadata. Manifests, preferences, and bounded logs are outside the accepted-output budget.
- Wall-clock time includes pauses, network requests, and rate-limit waits. There is one active collection at a time; sources are advanced in turn. An outstanding source request can delay another source until it returns or times out.
- Transient HTTP failures and rate limits are retried with cancellable waits. Redirects are not followed with credentials. Response bodies and local text files have size limits.
- Stopping or quitting cancels network waits. Saved runs remain inspectable; a run interrupted by an unexpected exit is marked interrupted after restart. Automatic continuation from a saved checkpoint is not implemented.
- On startup the app creates `data/Maine-Source/` on the user’s actual Windows Desktop, including a redirected or OneDrive Desktop. Collected records and run history live under `datasets/`; the export dialog defaults to `exports/`. The settings screen opens this Desktop data folder. Older internal datasets are copied across on first use when no Desktop dataset folder exists, leaving the original copy untouched. Preferences and credentials remain in private per-user application storage. Keys are encrypted using Electron `safeStorage` when remembered, or held only in process memory for the session. They never enter recipes, dataset records, exports, or the preview adapter.
- JSONL imports support `text` (or `content`), `title`, `url`, `version`, `attribution`, and `rights: { expression, basis, scope, url }`. Stronger evidence flags can be supplied but are user assertions, not independently validated facts.
- Public HTTPS JSONL downloads stream UTF-8 or gzip without buffering the whole file. Transfer bytes and decompressed bytes are each capped by the per-file input budget (default 100 MB); a row is capped at 12 MB. Up to five anonymous HTTPS redirects are allowed for file/CDN downloads, while credentialed API requests still reject redirects. Input caps end with an explicit source error rather than pretending the file was exhausted. Downloads do not resume after interruption.

## Contributing sources

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [connector guide](docs/adding-a-source.md). A new connector lives in one module containing its catalog metadata, declarative GUI settings, and async collector, plus registration in `src/sources/registry.mjs`. A [copyable template](docs/templates/example-source.mjs), shared helpers, contract tests, and a GitHub source-request form are included. Routine source settings need no UI-specific code.

## Project layout

`desktop/` contains the sandboxed Electron shell and restricted IPC bridge. `src/` contains the source catalog, connectors, HTTP client, collector, and license policy. `ui/` is a dependency-light interface without a remote UI service. `tests/` verifies policy boundaries, API response formats, collection budgets, cancellation, restart behavior, and export integrity. The Windows CI workflow runs checks, tests, and an installer build.

Licensed under GPL-3.0; see [LICENSE](LICENSE).
