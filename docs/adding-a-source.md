# Adding a data source

## Two files, no routine UI changes

1. Copy `docs/templates/example-source.mjs` to `src/sources/your-source.mjs`.
2. Import it and add it to `sourceModules` in `src/sources/registry.mjs`.
3. Set `docs` to official HTTPS documentation; if the source uses a credential, set `credentialUrl` to its official signup/token page and optionally `credentialHelp` to concise setup instructions. Run `node scripts/release-notes.mjs --update-template`. Every release repeats all implemented sources, and `pnpm check` rejects missing links or a stale table.
4. Add mapping/pagination tests to `tests/`; optionally add a public check to `scripts/smoke-sources.mjs`.

The registry supplies the checkbox catalog, source-specific form fields, credential controls, recipe validation, and collector dispatch. Existing sources in `src/connectors.mjs` predate this contract; new work should use source modules.

These are bundled first-party/community contributions reviewed as code. The app does not execute downloaded plugins or arbitrary scripts from a user's dataset.

## Source module contract

Export a default object with:

| Property | Purpose |
| --- | --- |
| `id` | Unique stable lowercase letters/digits, starting with a letter. Persisted in recipes; do not casually rename it. |
| `name`, `category`, `description` | Text shown in the source picker. State exactly what content is collected. |
| `mark`, `color` | Short source badge and CSS color. |
| `docs` | Official HTTPS documentation URL. |
| `input` | Label for the main query/URL input. |
| `multiline` | Optional `true` for lists of URLs/repositories. |
| `key` | Optional credential label. Adding it automatically enables encrypted/session credential controls for this source ID. |
| `credentialUrl`, `credentialHelp` | Official HTTPS key/token signup link (required when `key` is set), plus optional setup guidance. Included in every release’s full source list. |
| `fields` | Optional declarative settings, described below. |
| `collect(context)` | Async generator yielding individual records. |

Modules are also imported by the renderer to obtain metadata. Keep top-level code browser-safe, with no I/O or Node-only imports. Load Node dependencies inside `collect()` or use the browser-safe helpers. Collector functions are stripped before metadata crosses IPC.

## Settings fields

```js
fields: [
  { id: 'portal', label: 'Repository URL', default: 'https://example.org' },
  { id: 'language', label: 'Language', options: ['en', 'fr', 'de'] },
  { id: 'minimum', label: 'Minimum value', type: 'number', min: 0, max: 10, step: '0.1', default: '0' },
]
```

Field IDs use letters/digits, starting with a letter. Values arrive as strings in `context.settings`. Defaults populate the form; apply the same fallback in the collector because imported recipes can omit settings. Validate URLs, dates, ranges, and required queries before making requests. Helpers include `httpsURL`, `portalURL`, `numberSetting`, and `dateSetting`. Never put secrets in normal settings or the main query field.

## Collector context

```js
async *collect({ input, settings = {}, key, http }) { /* yield records */ }
```

- `input`: this source's main query.
- `settings`: saved source-specific options.
- `key`: this source's credential, available only to the collector. Never put it into a record, error, log, or recipe. Credentials are not automatically shared between sources.
- `http.get(url, options)`: JSON by default; `json: false` for text/XML. HTTPS only, retries for transient errors, per-host pacing, cancellation, 45-second request timeout, default 12 MB response limit. Set `interval` in milliseconds to respect the provider.
- `http.get(url, { includeHeaders: true })`: returns `{ data, headers }`; useful for Link-header pagination. Otherwise returns only the body.
- `http.post(url, object, options)`: JSON request/response, with the same controls. Use read/query endpoints only.
- `http.lines(url, { maxBytes, maxLineBytes })`: async line stream for public UTF-8 text or gzip files. Input and decompressed bytes are each bounded by `maxBytes`; individual rows default to 12 MB. At most five anonymous HTTPS redirects, no credentials/custom headers. A file request times out after five minutes and also respects the collection's stop signal.
- `http.wait(milliseconds)`: cancellable wait for provider-supplied backoff.

Ordinary API requests reject redirects, so credentials cannot follow an unexpected host. Validate pagination links before reusing headers. The public-file reader handles redirects separately and never uses saved credentials. Do not use direct `fetch()` inside connectors and lose these controls.

## Record contract

```js
yield {
  id: 'stable-provider-id',
  title: 'Readable document title',
  text: 'The actual searchable / filterable content',
  url: 'https://example.org/record/123',
  version: 'revision, timestamp, or release ID',
  attribution: 'Author or provider',
  rights: { expression: null, basis: 'unknown', scope: 'record' },
  metadata: { contentScope: 'full text', original: originalRecord },
};
```

`id` and `text` are required by convention; use a stable ID and a string. Retain original structured records where useful for analysis, alongside derived text. Prefer provider revisions over inventing one. IDs from live-table offsets must be labeled as such and are not immutable record identifiers. Do not claim metadata is a full document or fetch linked files implicitly.

License evidence can use SPDX expressions, `LicenseRef-*`, or custom terms. A declaration has `expression`, `url`, `scope` (`source`, `repository`, `record`, or `file`), and `basis` (`unknown`, `inferred`, `source-declaration`, or `content-notice`). Preserve conflicting evidence with `conflict: true`; use `corroborated: true` only when actual matching evidence supports it. Unknown is a valid result and does not prevent offering the source. New recipes disable license filtering by default; users may turn on an allowlist or evidence rules. Do not assign a metadata license to attached content.

The collector adds source ID, timestamp, hash, policy decision, and export provenance. It applies keywords, deduplication, optional license filtering, and accepted-output limits. Yield incrementally: do not pre-download an entire archive or run an endless background task. End naturally when exhausted; throw a useful, credential-free error for invalid queries, outages, or inaccessible continuation windows. Close readers in `finally` so stopping a collection releases resources.

## Primary content and original files

Discovery metadata is a starting point. For papers, datasets, books, and articles, provide the primary download requests rather than treating an abstract/description as the collected document:

```js
yield {
  id: paper.id, title: paper.title, text: paper.abstract,
  metadata: { abstract: paper.abstract },
  contentRequests: [
    { url: paper.pdfURL, filename: 'paper.pdf', role: 'paper' },
    { url: paper.sourceURL, filename: 'source.tar.gz', role: 'submitted source' },
  ],
};
```

The engine downloads those originals and extracts text **before** applying keywords. It preserves summary metadata, original files, hashes, and named failures, and counts original bytes toward storage. It also copies originals beside exports. For an original already retrieved through the shared HTTP client, use `{ data: originalTextOrBuffer, filename, mediaType }` to avoid another request. Use `{ filename, error: 'Not available because…' }` to report an absent/restricted component explicitly. Saved credentials may be used in a request but must never appear in persisted URLs, metadata, or messages.

No request list means the yielded text/structured original is itself the primary material (for example, an advisory or observation). Metadata-only mode strips content requests without downloading them; source adapters should avoid additional discovery detail calls when `settings.contentMode === 'metadata'`. Do not silently fall back to summaries in full mode. For large multi-file datasets, yield resources as separate records so stopping limits and progress remain useful. See [content coverage](content-coverage.md) for current formats and limits.

## Verification

`tests/sources.test.mjs` checks catalog/handler agreement and declarative settings for every registered source. Add meaningful fixture tests for your source: multiple pages, record mapping, exhaustion, errors, and any source-specific ambiguity. HTTP and engine tests cover shared budgets and cancellation.

```sh
pnpm check
pnpm test
pnpm smoke -- yoursource
```

The smoke command only recognizes entries explicitly added to its case list. It reads no saved credentials and returns a nonzero exit code if a selected source fails. Authenticated integration checks require a separate explicitly configured test; do not add secrets to the smoke script.

For huge corpora, do not label a partial viewer or search window a complete snapshot. Current JSONL support streams files but does not resume interrupted downloads, read Parquet/WARC, or implement cross-run deduplication. Those need shared engine work before a connector advertises them.

## Collection resume

Collectors receive optional `resume` (the last saved source checkpoint) and async `checkpoint(value)`. Start discovery at that cursor/offset. Call `await checkpoint({ cursor: nextCursor })` only after every item in the current page has been yielded, never before yielding its records. The engine refuses to advance a source checkpoint after a materialization failure in that session, so a retry can revisit the failed page. Do not store credentials or credential-bearing URLs in a checkpoint.

The engine separately journals processed record identities and reconstructs deduplication from saved records. Sources without cursor support replay discovery; the engine skips processed candidates before materialization. Some collectors fetch content as part of discovery, so this is not a guarantee of zero repeated requests. Failed whole-record downloads are retried; missing components of an already accepted partial record are reported but are not patched automatically. Old datasets without recovery identities may repeat content downloads once when resumed.
