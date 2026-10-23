# Release readiness — 2026-10-23

Current build: **0.2.1 alpha**, not a 1.0 release. Development stays on `main` until launch. This checklist separates implementation and local evidence from external release gates.

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

## Follow-up verification — 2026-10-23

- **145 automated tests pass**, including transport retry/cancellation, alternate-location license selection, and public-only archive filtering.
- The Open Library `public_scan_b:true` query returned zero matches; the documented `ebook_access:public` query returned public editions. Corrected the connector and successfully downloaded full book text/PDF (4,352,272 extracted characters in the sample).
- arXiv responded successfully on recheck: original PDF and submitted source, 130,377 extracted characters, both originals saved. The previous timeouts were availability failures, not missing-content substitutions.
- OpenAlex can try up to five supplied public PDF locations, with major repositories preferred. The actual successful location's URL and license are retained. A reproducible “Attention Is All You Need” sample downloaded 39,970 characters. A publisher-specific Nature redirect remains inaccessible; the app does not bypass it.
- Crossref now accepts unspecified-format full-text links and detects actual response formats; the earlier engineering sample still returned partial content. This is reported as partial, not cleared as a universally reliable publisher download.
- The packaged 0.2.1 runtime self-test passed local collection, HTML extraction subprocess, Unicode export, original-file validation, and reopening an isolated test dataset.
- No usable code-signing certificate, signing environment variables, Windows Sandbox, or Hyper-V command tools were available in this environment. No signing identity was created or purchased.
- CI now builds/installs 0.1.5 on a disposable Windows runner, creates a legacy dataset using that installed runtime, upgrades to the current installer, verifies legacy text and current HTML extraction/export without external Node/Python on PATH, uninstalls, and checks data preservation. **Passed on the disposable Windows runner in [test-and-build](https://github.com/Lithium357/Maine-Source/actions/runs/39965626390/job/120454621123).** This runner includes other development software; removing runtimes from PATH is useful evidence but not a pristine consumer VM certification.
- A separate Windows CI job runs a **two-hour public CISA-data replay**, with unique test identities, injected outages, stop/restart/resume, hash validation, and streamed export verification. This is a controlled replay, not a two-hour provider API availability test. Its artifact must pass before checking off sustained testing.
- Local ten-minute public-data replay passed: 2,692 records and 2,692 original files, two restarts, one injected source outage, zero integrity failures, 107 MiB peak sampled RSS, and 9 ms maximum requested-stop latency. Total elapsed including validation/export was 612 seconds. Repeated texts were intentionally allowed in this replay, so duplicate-text counts are expected.

Source references: [Open Library access fields](https://openlibrary.org/search/howto/more), [OpenAlex location-specific copies/licenses](https://help.openalex.org/data/locations/), [arXiv API](https://info.arxiv.org/help/api/user-manual.html). Public vulnerability reporting still requires the owner's repository administration setting; see [GitHub's instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

The same CI run's two-hour replay job is still running. Do not infer its success from the completed installer job. Signing and authenticated provider checks still require owner-supplied credentials; no outside beta users were contacted. Production dependency audit on 2026-10-23 again reported zero known vulnerabilities.

## Filesystem hardening follow-up

A second implementation review found that manually tampered dataset folders could redirect recovery or export through junctions/symbolic links. Recovery now verifies the resolved dataset, record, journal, and assets locations before using them. Exports validate original paths, reject linked companion folders/files, and create destination directories one component at a time so a nested link cannot create files outside the chosen destination. LaTeX export uses the same containment checks. Invalid saved record structures are reported as integrity problems.

All **150 automated tests pass**, including real temporary Windows junction regressions for recovery, source originals, companion folders, and nested output directories. This is a maintainer implementation review, not an independent third-party security audit. The disposable Windows lifecycle success above refers to commit `72f62ff`; later hardening commits run the same checks again.
