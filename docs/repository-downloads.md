# Repository downloads and advanced search

These are options within the existing GitHub, Hugging Face, and Stack Exchange source checkboxes. Open a recipe's source configuration to choose them. The same settings are available to Python clients; `api.sources()` includes the GUI field definitions.

## GitHub

Enter one public `owner/repo` per line. `ref` accepts a branch, tag, or commit; blank uses the default branch. The collector resolves it to a commit SHA and saves that pin for resume. To collect a newer snapshot, start a new dataset.

- `downloadMode: "files"` (default): walk the commit's tree, then retrieve selected files from the Contents API with `ref=commit_sha`. Files are stored verbatim alongside extracted text, paths, blob IDs, commit SHA, and license evidence. Existing extension filters, 1 MB file cap, binary/symlink exclusion, and generated/vendor-directory exclusions apply. Truncated recursive trees fall back to individual directory requests.
- `downloadMode: "archive"`: save the entire repository tarball at that commit, including files outside the extension/directory filters. Preserve the original tarball and extract supported text members within archive limits. The normal per-file/per-record/run budgets still apply; an oversized archive is reported as a failure. This is a repository snapshot, not commit history, and does not separately fetch submodule repositories or external Git LFS payloads. Repository-wide license declarations can differ from individual file notices.

Endpoints: `GET /repos/{owner}/{repo}/commits/{ref}`, `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1`, `GET /repos/{owner}/{repo}/contents/{path}?ref={commit_sha}`, and `GET /repos/{owner}/{repo}/tarball/{commit_sha}`. See GitHub's [trees documentation](https://docs.github.com/en/rest/git/trees#get-a-tree) and [contents/archive documentation](https://docs.github.com/en/rest/repos/contents).

## Hugging Face

Enter `organization/dataset`. `downloadMode: "files"` is the default in 0.3.2, including for recipes without an explicit download mode. Set `downloadMode: "rows"` on an older recipe if you want to retain its Viewer behavior.

Files mode resolves `revision` (branch/tag/commit, or default branch) into an immutable SHA. It follows every recursive tree page and requests the actual file bytes at that SHA. Each file is one record; repository path, revision, file metadata, dataset-card license declarations, original bytes, and hashes are retained. An optional comma-separated `extensions` filter narrows files; blank selects all. A resume keeps the saved revision and replays discovery, skipping committed items. It does not resume partial file bytes.

Parquet, images, and other unsupported formats are retained as originals; they do not become fabricated text. Enable the existing require-text option if binary-only records should be rejected. Large shards can exceed the configurable download cap and will be reported. Dataset files may reference external resources; those links do not trigger recursive downloads.

Rows mode keeps `config`, `split`, and `textField`, with original returned rows in metadata. The Viewer is a live view and does not promise the file mode's pinned snapshot. Gated/private access requires a suitable read token and provider approval; the collector does not bypass access controls.

Endpoints: `GET /api/datasets/{organization}/{dataset}` (or `/revision/{ref}`), `GET /api/datasets/{organization}/{dataset}/tree/{revision_sha}?recursive=true&limit=100`, and `GET /datasets/{organization}/{dataset}/resolve/{revision_sha}/{path}`. Tree pagination follows the response's next link after validating its origin and repository/revision path. See the [Hub API](https://huggingface.co/docs/hub/api) and [repository tree client reference](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api#huggingface_hub.HfApi.list_repo_tree).

## Stack Exchange

The primary input is semicolon-separated tags, such as `nlp` or `nlp;python`. Additional settings are `site`, `query` (free text), `excludedTags`, `sort` (`creation`, `activity`, `votes`, `relevance`), `order` (`asc`/`desc`), `fromdate`, and `todate` (YYYY-MM-DD). Defaults are Stack Overflow, creation sort, ascending order, 100 questions per page, and `filter=withbody`.

Full mode downloads each matching question and its answers, storing original HTML and per-post authorship/license metadata. Each question/answer is a separate record. Metadata mode skips the answer requests. Page checkpoints replay the current page after an interruption, using processed-item history to avoid accepting it twice. The upper creation date is held at run start unless explicitly supplied; edits, deletions, and ranking changes can still shift live pages. API quotas and backoff are respected.

The example from the request is `GET https://api.stackexchange.com/2.3/search/advanced?site=stackoverflow&tagged=nlp&pagesize=100&page=1&sort=creation&order=asc&filter=withbody`. See the [official advanced-search reference](https://api.stackexchange.com/docs/advanced-search).

## Python example

```python
from maine_source import Client

with Client(workspace=r"D:\Maine-Source-Workspace") as api:
    # Optional: api.set_credentials({"github": "...", "huggingface": "..."})
    recipe = api.recipe(
        name="Repository snapshots",
        sourceIds=["github", "huggingface", "stackexchange"],
        inputs={
            "github": "Lithium357/Maine-Source",
            "huggingface": "databricks/databricks-dolly-15k",
            "stackexchange": "nlp",
        },
        settings={
            "github": {"downloadMode": "archive", "ref": "main"},
            "huggingface": {"downloadMode": "files", "extensions": ".jsonl,.md"},
            "stackexchange": {"site": "stackoverflow", "sort": "creation", "order": "asc"},
        },
        limits={"files": 20, "minutes": 10, "megabytes": 100},
    )
    dataset = api.start(recipe)
    job = api.wait(dataset, timeout=660)
```

Credentialed archive/Hub downloads allow HTTPS redirects, remove all caller headers after the initial API request, and enforce a redirect limit. Credentials are not retained in dataset records or exported files. Metadata-only mode makes no underlying archive/file download requests.

Run `node scripts/smoke-repositories.mjs` for bounded public archive, dataset-shard, and `nlp` post downloads with saved-file integrity validation. It uses no saved API keys and writes only under the ignored `.test-data` directory.
