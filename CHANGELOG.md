# Changelog

## 0.3.1 — 2026-10-28 (recovery fix)

- Resume datasets with missing record files, including files removed by security software, without renumbering or overwriting surviving records.
- Preserve processed-item history and source checkpoints; recovery does not restore quarantined files or reset discovery to retry them.
- Use the saved high-water record index even when the final record is missing; report missing slots in run history.
- Inspect saved records with bounded parallel I/O and display progress during long recovery checks.
- Keep counters unchanged when a validation failure blocks recovery; identify the affected record filename.
- Handle record files disappearing during inspection and wait safely for recovery initialization when closing the app.

## 0.3.0 — Python API, portable credentials, and Resume controls

- Add a dependency-free Python SDK and packaged backend over private local stdin/stdout, with no GUI automation or network listener.
- Expose source discovery, recipe defaults, collection, status, pause/resume/stop, record browsing, validation, relocation, and export to agents.
- Add GUI/Python credential JSON import/export, strict whole-file validation, session-only API keys, and optional encrypted GUI persistence. Portable files are explicitly plaintext.
- Add workspace leases shared by GUI and API processes, with recovery of locks left by dead processes.
- Put direct Resume actions in Jobs, Datasets, and run details, including active paused runs and saved interrupted/stopped collections.
- Build a Python wheel alongside Windows installers and include it in release checksums. Test the SDK against both source and packaged backends.

## 0.2.3 — per-dataset download folders

- Choose and remember a download folder for each recipe; new runs create an isolated dataset subfolder there.
- Open or change an individual dataset’s folder, with verified copying and the original retained as a backup.
- Resume, browse, validate, export, and delete use each dataset’s active location after restart.
- Refuse moves during collection, existing destinations, nested destinations, filesystem links, and insufficient free space. Portable export manifests omit local download paths.

## 0.2.2 — unsigned distribution preparation

- Disclose unsigned Windows distribution and the absence of an independent security audit in the README, installer notice, and app settings.
- Add an explicitly unsigned manual candidate workflow with checksums and dependency notices.
- Add local Test connection controls for the eight credentialed sources, with bounded read-only requests, credential redaction, and explicit limits on what a successful request proves.
- Fix GovInfo whole-volume retrieval by requesting advertised HTML/XML/PDF formats instead of guessing an unavailable HTML endpoint.
- Record passing two-hour Windows replay and installation/upgrade/uninstall checks for 0.2.1.

## 0.2.1 — 2026-10-23 (alpha)

- Reject linked/tampered dataset and export paths before reading, cleaning up, or writing originals; report structurally corrupt records.
- Repair Open Library public-access searches and ignore private archive files.
- Retry bounded transient GET transport failures; cancellation still interrupts backoff.
- Try alternate OpenAlex paper locations, prefer major public repositories, and retain the successful copy's URL and license.
- Accept Crossref's unspecified-format full-text links without assuming they are PDFs.
- Add an isolated packaged-runtime self-test, disposable Windows install/upgrade/uninstall CI, and a two-hour public-data replay soak with restart/outage injection.

## 0.2.0 — 2026-10-22 (alpha)

- Resume interrupted/stopped/failed collections into the same dataset, reuse processed records, retry failed items, and retain supported page checkpoints. Recover committed records when run history lags behind a crash.
- Add free-space checks, configurable storage with a safe copy to another folder/drive, and backup run history.
- Browse/search/filter all saved records, page through full text, inspect originals, and move a dataset to the Recycle Bin after confirmation.
- Validate dataset text and original-file sizes/hashes; expose extraction and license warnings separately.
- Traverse large GitHub repository trees when the recursive API truncates results.
- Prevent concurrent app instances writing the same workspace and strengthen log redaction.
- Generate dependency notices and SHA-256 checksums; add dependency-audit CI and a manually triggered signing-required distribution workflow.

This remains an alpha. Signing, credentialed integration checks, clean Windows installation/upgrade/uninstall, long-duration testing, and outside beta validation are required before 1.0. See [release readiness](docs/release-readiness.md).

## 0.1.5

Configurable text output formats, Unicode encodings, normalization, BOM, line endings, original-source preservation, and gzip export.
