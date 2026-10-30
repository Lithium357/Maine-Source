# Maine Source — release description template

Replace VERSION and fill in the verification section for the exact candidate before publishing. This file is preparation, not an announcement that 1.0 has shipped.

## Unsigned Windows application

**This app is unsigned because the developer cannot currently afford code signing.** Windows may show an unknown-publisher or protection warning. No independent security audit has been performed.

Download the Windows x64 installer only from this repository's releases. Compare its SHA-256 hash with the attached `SHA256SUMS.txt`. Checksums detect file changes; they do not provide a verified publisher identity. You do not need to disable antivirus or Windows security settings to use this project; do not disable them on the project's behalf.

## Install and collect

Run `Maine Source Setup VERSION.exe`. The default dataset folder is `Desktop/data/Maine-Source`, including redirected Desktops. Storage can be moved in Settings. No separate Node.js or Python installation is required.

Select sources with checkboxes, add optional API keys locally, test connections, and create a collection with time/storage/record limits. Full-content mode preserves original downloads alongside extracted text and provenance. License filtering is optional and controlled by the user. The app license does not grant rights to collected content.

## Python API and credential transfer

The release includes a Python SDK wheel. Install it with pip and use `from maine_source import Client` to collect, pause/resume, browse, validate, move, and export datasets through the installed app runtime. Python 3.10+ is required for the SDK; the GUI does not require Python. See [the Python API guide](https://github.com/Lithium357/Maine-Source/blob/main/python/README.md).

Settings includes **Import keys JSON** and **Export keys JSON**. The same credential files work with the SDK. Portable JSON stores keys in plaintext: keep it private during transfer. GUI import offers session-only use or encrypted local persistence; API keys are held in memory unless explicitly exported.

Paused, stopped, and interrupted runs have Resume controls in the app. Saved progress is retained; reached total budgets must be raised to continue. Missing record files are reported and surviving records keep their original indices. Recovery does not restore files quarantined by security software.

## Known limitations

- Some providers require credentials, enforce quotas, restrict individual downloads, or fail temporarily. A successful connection test does not prove every dataset or download is accessible.
- Full-content failures and partial results are reported; metadata-only mode is an explicit option. Resume continues collection but does not repair every partially accepted attachment or resume partial bytes.
- OCR, arbitrary website crawling, automatic updates, and Parquet/WARC ingestion are not included.
- Keep JSONL/text exports, companion manifests, and adjacent originals folders together.
- Uninstall retains user datasets. Back up important datasets before upgrading or relocating storage.

## Verification for this exact candidate

Fill in the commit/tag, Windows build/lifecycle CI link, automated test result, live provider samples (including failures), and known unverified scenarios. Do not copy older version results as though they verify this installer.

See the changelog, source coverage, security policy, and beta test guide in the repository. Report reproducible public examples with the bug report form; never include credentials or private datasets.

<!-- maine-source:sources:start -->
## All implemented sources and API keys

This complete list is repeated in every release, including sources introduced in earlier versions. It covers 24 implemented sources, including local files; roadmap-only entries are excluded. Links go to the providers, not to credentials stored by this app.

| Source | Key / token and access | Signup and source links |
| --- | --- | --- |
| NIST NVD | Optional; a key raises the request limit. | [Get a key / token](https://nvd.nist.gov/developers/request-an-api-key) · [Source / API documentation](https://nvd.nist.gov/developers/vulnerabilities) |
| CISA KEV | No API key needed for the implemented public connector. | [Source / API documentation](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) |
| GitHub | Optional for public repositories. Use read-only access; write permissions are unnecessary. | [Get a key / token](https://github.com/settings/personal-access-tokens/new) · [Source / API documentation](https://docs.github.com/en/rest/repos/contents) |
| Stack Exchange | Optional application key. Register an app on Stack Apps; an OAuth access token is not needed for this connector. | [Get a key / token](https://stackapps.com/apps/oauth/register) · [Source / API documentation](https://api.stackexchange.com/docs) |
| NASA Open APIs | Request a NASA API key; restricted DEMO_KEY access is available. | [Get a key / token](https://api.nasa.gov/) · [Source / API documentation](https://api.nasa.gov/) |
| Europe PMC | No API key needed for the implemented public connector. | [Source / API documentation](https://europepmc.org/RestfulWebService) |
| Crossref | No API key needed for the implemented public connector. | [Source / API documentation](https://api.crossref.org/swagger-ui/index.html) |
| Zenodo | No API key needed for the implemented public connector. | [Source / API documentation](https://developers.zenodo.org/) |
| Hugging Face | Optional read-only token; gated datasets also need the provider’s access approval. | [Get a key / token](https://huggingface.co/settings/tokens) · [Source / API documentation](https://huggingface.co/docs/hub/api) |
| Wikipedia | No API key needed for the implemented public connector. | [Source / API documentation](https://www.mediawiki.org/wiki/API:Main_page) |
| Wikidata | No API key needed for the implemented public connector. | [Source / API documentation](https://www.wikidata.org/wiki/Wikidata:Data_access) |
| GovInfo | An api.data.gov key is required for normal use; the public demo key is limited. | [Get a key / token](https://www.govinfo.gov/api-signup) · [Source / API documentation](https://www.govinfo.gov/developers) |
| Local files | No API key; choose files on your computer. | Local files on your machine |
| GitHub Security Advisories | Optional read-only GitHub token. The GitHub source and this source use separate credential entries. | [Get a key / token](https://github.com/settings/personal-access-tokens/new) · [Source / API documentation](https://docs.github.com/en/rest/security-advisories/global-advisories) |
| OSV package vulnerabilities | No API key needed for the implemented public connector. | [Source / API documentation](https://google.github.io/osv.dev/post-v1-query/) |
| arXiv papers & source | No API key needed for the implemented public connector. | [Source / API documentation](https://info.arxiv.org/help/api/user-manual.html) |
| OpenAlex | Get a free account and copy Settings → API key. A key is needed for cursor paging beyond page one and metered content; usage budgets apply. | [Get a key / token](https://openalex.org/settings/api-key) · [Source / API documentation](https://help.openalex.org/api/) |
| CKAN public-data portals | No API key needed for the implemented public connector. | [Source / API documentation](https://docs.ckan.org/en/latest/api/) |
| Socrata public tables | No API key needed for the implemented public connector. | [Source / API documentation](https://dev.socrata.com/docs/queries/) |
| Research Dataverse | No API key needed for the implemented public connector. | [Source / API documentation](https://guides.dataverse.org/en/latest/api/search.html) |
| RSS / Atom feeds | No API key needed for the implemented public connector. | [Source / API documentation](https://www.rssboard.org/rss-specification) |
| USGS Earthquake Catalog | No API key needed for the implemented public connector. | [Source / API documentation](https://earthquake.usgs.gov/fdsnws/event/1/) |
| Open Library books | No API key needed for the implemented public connector. | [Source / API documentation](https://openlibrary.org/dev/docs/api/search) |
| HTTPS JSONL / gzip files | No API key needed for the implemented public connector. | [Source / API documentation](https://jsonlines.org/) |

Enter keys locally in **Connections & settings**, then use **Test connection**. Request read-only access. A successful connection check does not guarantee permission for every repository, dataset, or download.
<!-- maine-source:sources:end -->
