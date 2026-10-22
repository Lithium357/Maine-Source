# Contributing to Maine Source

Maine Source is GPL-3.0-only. Source connectors, bug fixes, tests, documentation, and source suggestions are welcome. Please open a pull request against this repository; don't include API keys, personal datasets, or build outputs.

## Run locally

Use Node.js 24 and pnpm 11:

```sh
pnpm install
pnpm start
pnpm check
pnpm test
```

`pnpm preview` offers a clearly labeled simulated UI. It does not run collectors. `pnpm dist` builds the Windows installer without publishing it.

## Add a source

The [connector guide](docs/adding-a-source.md) explains the source contract, GUI fields, credentials, paging, tests, and live checks. Copy [the source template](docs/templates/example-source.mjs) into `src/sources/`, implement its collector, and register it in `src/sources/registry.mjs`. There is no need to edit the UI for normal text, number, or select settings.

For a public JSONL/JSONL.gz dataset, try the existing HTTPS JSONL source first. A new website does not always need a new connector. CKAN, Socrata, and research Dataverse already accept other compatible public portal URLs.

## Pull requests

- Explain the collected content precisely: full text, abstract, metadata, table row, or original file.
- Link the provider's official documentation and describe pagination and access limits.
- Include fixture-based tests for response mapping and relevant failure cases. Avoid live network calls in unit tests.
- Run `pnpm check` and `pnpm test`. If you perform a live smoke check, record the date, query, and result without credentials or personal data.
- Keep license declarations and uncertainty visible in records. Optional filtering belongs in the shared policy, not hidden source-specific exclusions.
- Use the shared HTTP client for cancellation, rate handling, bounded responses, and credential-safe errors.

GitHub Actions runs syntax checks, tests, and the Windows build. A passing fixture test is not proof that an API is currently reachable; report live checks separately.
