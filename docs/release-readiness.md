# Release readiness — 2026-10-22

Current build: **0.2.0 alpha**, not a 1.0 release. Development stays on `main` until launch. This checklist separates implementation and local evidence from external release gates.

## Implemented and locally checked

- Resume stopped/interrupted/failed runs with the same dataset ID, reconcile committed files after interrupted history writes, skip previously processed candidates, retry failed materialization, and keep duplicate detection across sessions. Reached budgets must be raised explicitly before continuing.
- Persist completed-page checkpoints for NVD, arXiv, CKAN, Dataverse, and OpenAlex. Other connectors replay discovery; accepted content is skipped once yielded. This is not byte-range download resumption, and some connectors fetch text during discovery. Changing live catalogs can shift offset pages; this does not guarantee a frozen snapshot of every source.
- Keep a second run-history file and recover from it when the primary JSON is corrupt. Preserve originals and committed records; interrupted temporary writes at the next record position are replaced on resume.
- Choose another data drive/folder, check free space before collection/writes/exports, copy storage without overwriting an existing destination, retain the old folder as backup, persist the new location. Failed copies can leave a staging folder; the original storage stays active until the copy and preference save finish.
- Browse/search all records in a dataset with paging and source/license/content-status filters. Read full text in 25,000-character pages and reveal original files. Dataset deletion requires a native confirmation and uses the Recycle Bin; existing exports are retained.
- Validate record readability and original-file sizes/SHA-256 hashes. Report empty text, duplicate text, unknown license declarations, and extraction/download warnings separately.
- Recover truncated recursive GitHub trees by walking nonrecursive directory trees, as recommended by [GitHub's tree API](https://docs.github.com/en/rest/git/trees#get-a-tree).
- Prevent simultaneous app instances writing one workspace. Validate IPC senders and record/attachment paths; reject linked folders during relocation/deletion and escapes when reading dataset files.
- Generate packaged production dependency notices and installer checksums. CI runs syntax checks, fixture tests, runtime dependency audit, and Windows packaging.
- Runtime dependency audit on 2026-10-22: **0 known vulnerabilities** across 53 installed production packages (registry dependency counts differ because optional/platform packages are represented separately). This is not an independent security certification.
- 141 automated tests passed at this stage, including simulated disk-full, interrupted writes/history, saved checkpoints, damaged originals, relocation, encoding, filtering, budgets, and cancellation. A 500-record collection/search/export fixture and simultaneous-start/credential-redaction checks are included.

## Live source evidence

Public discovery/metadata checks on 2026-10-22 returned content for 21 of 22 anonymous connectors. arXiv timed out in the concurrent 25-second check; a subsequent full-content attempt also timed out. This remains a live availability failure, not a passing check. GovInfo requires a user-supplied credential and was not part of this run. Metadata samples do not prove every downloadable original is accessible.

Current full-content samples returned data for 19 of 22 tested anonymous sources: Crossref was partial, OpenAlex failed on a publisher redirect, Open Library returned no downloadable match, and arXiv timed out. (19 returned includes the partial Crossref sample; 18 were complete.)

Earlier full-content samples covered arXiv, Zenodo, CKAN, Dataverse, RSS, Europe PMC, GitHub, and Wikidata. Re-run `pnpm smoke -- --full <source>` before release. Record failed/partial requests instead of marking a provider fully verified based on one successful sample.

## Packaged Windows evidence

The 0.2.0 unpacked Windows build opened the existing 0.1.5 workspace, retained all nine saved records and five runs, displayed the complete arXiv dataset browser, and validated both original paper/source SHA-256 hashes with zero integrity problems. Full-text paging advanced from characters 1–25,000 to 25,001–50,000 of the saved 130,377-character paper. The NSIS installer built successfully and Windows reports its signature as `NotSigned`. SHA-256 checksums are supplied. This is a same-machine workspace compatibility check, not clean-machine installation/upgrade/uninstall verification.

## External gates before 1.0

- [ ] Credentialed integration tests for GovInfo and the optional authenticated connectors using keys entered by the owner; never put credentials in issues, logs, fixtures, or source control.
- [ ] Independently review security boundaries and dependency notices. Enable private vulnerability reporting on GitHub. Review Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), including custom protocol/fuse hardening; the current extraction subprocess requires Electron's RunAsNode support.
- [ ] Configure an owner-controlled Windows signing identity and verify Authenticode signatures. No certificate has been supplied. The manual distribution workflow requires signing rather than silently publishing an unsigned binary.
- [ ] On a fresh Windows VM without Node/Python: install, collect, export, close/restart, resume, relocate storage, upgrade from 0.1.5, and uninstall. Confirm datasets and remembered settings survive upgrade and uninstall does not delete user datasets. A successful local build does not establish this.
- [ ] Run a multi-hour soak with large real datasets, slow/offline APIs, expired credentials, limited disk space, and OneDrive/redirected Desktop storage. Confirm memory, cancellation latency, and budgets remain acceptable. Fixture checks alone do not establish this.
- [ ] Exercise the signed release candidate with outside beta users, fix blocking issues, then publish versioned binaries, checksums, source, changelog, and known limitations. No 1.0 release is approved or published by this work.

## Manual signed distribution

The `Signed release candidate` workflow is manually triggered for an existing version tag. It verifies the tag matches `package.json`, requires `CSC_LINK` and `CSC_KEY_PASSWORD` signing secrets, runs checks/tests/audit, builds with code signing required, verifies Authenticode, generates SHA-256 checksums, and uploads artifacts. It does not publish a GitHub release automatically. After the checklist passes, attach those exact artifacts to a release and publish deliberately.
