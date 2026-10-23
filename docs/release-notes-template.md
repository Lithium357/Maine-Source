# Maine Source — release description template

Replace VERSION and fill in the verification section for the exact candidate before publishing. This file is preparation, not an announcement that 1.0 has shipped.

## Unsigned Windows application

**This app is unsigned because the developer cannot currently afford code signing.** Windows may show an unknown-publisher or protection warning. No independent security audit has been performed.

Download the Windows x64 installer only from this repository's releases. Compare its SHA-256 hash with the attached `SHA256SUMS.txt`. Checksums detect file changes; they do not provide a verified publisher identity. You do not need to disable antivirus or Windows security settings to use this project; do not disable them on the project's behalf.

## Install and collect

Run `Maine Source Setup VERSION.exe`. The default dataset folder is `Desktop/data/Maine-Source`, including redirected Desktops. Storage can be moved in Settings. No separate Node.js or Python installation is required.

Select sources with checkboxes, add optional API keys locally, test connections, and create a collection with time/storage/record limits. Full-content mode preserves original downloads alongside extracted text and provenance. License filtering is optional and controlled by the user. The app license does not grant rights to collected content.

## Known limitations

- Some providers require credentials, enforce quotas, restrict individual downloads, or fail temporarily. A successful connection test does not prove every dataset or download is accessible.
- Full-content failures and partial results are reported; metadata-only mode is an explicit option. Resume continues collection but does not repair every partially accepted attachment or resume partial bytes.
- OCR, arbitrary website crawling, automatic updates, and Parquet/WARC ingestion are not included.
- Keep JSONL/text exports, companion manifests, and adjacent originals folders together.
- Uninstall retains user datasets. Back up important datasets before upgrading or relocating storage.

## Verification for this exact candidate

Fill in the commit/tag, Windows build/lifecycle CI link, automated test result, live provider samples (including failures), and known unverified scenarios. Do not copy older version results as though they verify this installer.

See the changelog, source coverage, security policy, and beta test guide in the repository. Report reproducible public examples with the bug report form; never include credentials or private datasets.
