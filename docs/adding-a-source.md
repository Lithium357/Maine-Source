# Adding a data source

## Two files, no routine UI changes

1. Copy `docs/templates/example-source.mjs` to `src/sources/your-source.mjs`.
2. Import it and add it to `sourceModules` in `src/sources/registry.mjs`.
3. Add mapping/pagination tests to `tests/`; optionally add a public check to `scripts/smoke-sources.mjs`.

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

## Verification

`tests/sources.test.mjs` checks catalog/handler agreement and declarative settings for every registered source. Add meaningful fixture tests for your source: multiple pages, record mapping, exhaustion, errors, and any source-specific ambiguity. HTTP and engine tests cover shared budgets and cancellation.

```sh
pnpm check
pnpm test
pnpm smoke -- yoursource
```

The smoke command only recognizes entries explicitly added to its case list. It reads no saved credentials and returns a nonzero exit code if a selected source fails. Authenticated integration checks require a separate explicitly configured test; do not add secrets to the smoke script.

For huge corpora, do not label a partial viewer or search window a complete snapshot. Current JSONL support streams files but does not resume interrupted downloads, read Parquet/WARC, or implement cross-run deduplication. Those need shared engine work before a connector advertises them.
