# Windows beta test guide

This is an alpha test plan, not a declaration of 1.0 readiness. Use public sample content and a small storage budget. The owner has chosen unsigned distribution because code signing costs money. Windows may show an unknown-publisher or protection warning. No independent security audit has been performed.

## Fresh install and upgrade

1. Install on a spare Windows machine or disposable VM that does not depend on a development checkout. Confirm the app opens without installing Node.js or Python.
2. Collect one arXiv paper (`1706.03762`), a few public code files, and a small structured-data sample. Confirm original files exist separately from extracted text and metadata.
3. Export JSONL and a configured text format. Keep the adjacent originals folder and manifest together. Verify the dataset in a separate tool.
4. Close/reopen the app. Confirm datasets, recipes, credentials (if explicitly remembered), and preferences survive.
5. On a separate test run, stop partway through and Resume. Confirm saved records are preserved, total budgets still apply, and failed items are reported.
6. Choose a custom download parent in a recipe and collect a small dataset. Restart and verify its active path in Datasets. Change that dataset folder, check original hashes, resume, browse, and export. Confirm the old copy remains as a backup and another dataset stays in place. Disconnect an external drive: the app must report the unavailable folder rather than silently recreate it elsewhere.
7. Move storage to a new empty folder/drive. Confirm data copies successfully, the previous copy remains, and the chosen location survives restart.
8. Upgrade from 0.1.5 with saved datasets. Confirm text/originals and preferences remain accessible. Uninstall and verify user datasets are retained. Reinstall and check discovery of that saved data.

## Failure and usability checks

- Disconnect/reconnect networking during a collection. Use Test connection with a valid key, then an invalid or expired key. A successful public request is not proof of credential validity or access to a particular download. Confirm clear errors, bounded retries, and responsive Stop.
- Use small record/time/storage limits. Observe which condition stops the run and verify it never accepts a record beyond the configured saved-byte budget.
- Browse/search records, inspect full text pages and original files, and run validation. Empty text/unknown licensing should be warnings, not silently presented as complete content.
- Use the Recycle Bin action only on a test dataset. Confirm cancellation preserves it, confirmed removal keeps existing exports, and restoration is possible through normal Windows tools.
- Check keyboard navigation, long names/queries, Windows display scaling, redirected/OneDrive Desktop, low free space, and a slow drive.

## Reporting

Open a bug report with app version, Windows version, source, small public reproduction query, steps, expected/actual results, and whether the issue repeats. Do not include API keys, private datasets, unredacted logs, or personal paths. Report security concerns privately using the repository's configured security contact/reporting route.

CI's installation/upgrade/uninstall test runs on a disposable Windows developer runner with external runtimes removed from PATH for the app test. It is useful evidence, but outside tests on ordinary consumer machines are still needed. No outside testers have been contacted automatically.
