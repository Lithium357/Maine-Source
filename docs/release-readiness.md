# Release readiness — 2026-10-23

Current build: **0.2.2 alpha**, not a 1.0 release. Development stays on `main` until launch. This checklist separates implementation and local evidence from external release gates.

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

## Release decision and remaining checks

The owner has chosen **unsigned Windows distribution** because signing costs money. No independent third-party security audit is planned. These are disclosed limitations, not requirements blocking release. Maintainer security checks, dependency audits, and fixing known security bugs continue.

- [x] Version 0.2.1 Windows tests, packaging, installation, upgrade from a real 0.1.5 dataset, embedded-runtime extraction/export, uninstall, and data preservation passed on the disposable CI runner.
- [x] Version 0.2.1 two-hour public CISA-data replay with injected source outages, restart/resume, validation, and streamed export passed. This is not sustained provider availability testing or every real-world disk/network scenario.
- [x] Add unsigned distribution disclosure in the README, installer notice, app settings, and candidate artifacts.
- [ ] Re-run the Windows build/lifecycle workflow for 0.2.2. Its code changes do not inherit 0.2.1's passing checks automatically.
- [ ] Credentialed integration tests with owner-entered keys and representative full downloads. Settings now offers Test connection for all eight credentialed sources. GitHub/Hugging Face use authenticated identity endpoints; other probes only establish request acceptance. A public endpoint can ignore keys. Per-repository, gated-dataset, metered-content permissions and quota still need actual collection checks.
- [ ] Enable private vulnerability reporting in GitHub's repository administration settings.
- [ ] Outside beta checks on ordinary Windows machines: keyboard/display scaling, redirected/OneDrive Desktop, slow/full drives, offline recovery, relocation, reinstall, and remembered settings. The CI developer runner is not a bare consumer VM. No outside testers have been contacted.
- [ ] Fix beta blockers, choose the 1.0 tag, build the candidate, and publish the exact installer with notices, checksums, source, changelog, and limitations. This work does not publish 1.0 automatically.

## Manual distribution

The **Unsigned release candidate** workflow builds an existing version tag matching package.json, runs checks/tests/audit, disables signing identity autodiscovery, builds the installer, checks that it is unsigned, and uploads the installer, checksums, dependency notices, and `UNSIGNED-RELEASE.txt`. The installer displays the unsigned notice ahead of the GPL license. It does not publish automatically. Copy the unsigned disclosure into the GitHub release description when publishing.

The older **Signed release candidate** workflow remains optional for future use if a signing identity is supplied. It is not the planned 1.0 path.

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

The hardened 0.2.1 [CI run](https://github.com/Lithium357/Maine-Source/actions/runs/39966810829) completed successfully, including its two-hour replay. Authenticated provider checks still need owner-entered credentials; no outside beta users were contacted. Production dependency audit on 2026-10-23 again reported zero known vulnerabilities.

## Filesystem hardening follow-up

A second implementation review found that manually tampered dataset folders could redirect recovery or export through junctions/symbolic links. Recovery now verifies the resolved dataset, record, journal, and assets locations before using them. Exports validate original paths, reject linked companion folders/files, and create destination directories one component at a time so a nested link cannot create files outside the chosen destination. LaTeX export uses the same containment checks. Invalid saved record structures are reported as integrity problems.

All **150 automated tests pass**, including real temporary Windows junction regressions for recovery, source originals, companion folders, and nested output directories. This is a maintainer implementation review, not an independent third-party security audit. The hardened commit `4441333` also passed [Windows tests, packaging, installation, legacy upgrade, embedded runtime checks, and uninstall](https://github.com/Lithium357/Maine-Source/actions/runs/39966810829/job/120458683058). Its separate two-hour replay also passed. The rebuilt local 0.2.1 app passed its isolated packaged-runtime diagnostic, and its installer checksum matched `SHA256SUMS.txt`; the installer remains unsigned.

The [outside beta guide](beta-testing.md) and GitHub bug report form are ready. These provide a repeatable test/report process; they do not establish that outside beta testing has occurred.

## 0.2.2 verification

All **154 automated tests pass** and JavaScript syntax checks pass. New connection checks use fixed provider endpoints, bounded responses/timeouts, sanitized errors, no dataset writes, and no account details in results. Only one connection check runs at a time. Owner credentials were not read for this verification.

Small live NASA and GovInfo requests succeeded using the publicly documented `DEMO_KEY`. This is not validation of owner credentials. A full GovInfo Federal Register attempt exposed a missing HTML format: whole-volume metadata advertises XML/PDF without HTML. The connector now follows supported advertised formats and rejects unexpected download hosts/paths, with a regression test. A subsequent full BILLS attempt timed out at the 120-second limit with the demo key, so full GovInfo collection remains unverified rather than marked passing.

Unsigned publication copy is prepared in [the release-description template](release-notes-template.md). No 1.0 tag or public release has been created.
