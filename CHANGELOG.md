# Changelog

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
