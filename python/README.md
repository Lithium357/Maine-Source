# Maine Source Python API

Python 3.10 or newer. The SDK has no runtime Python dependencies. It controls the same collector used by the desktop app over a private local stdin/stdout connection, without opening a GUI or network server.

Install the wheel attached to a release, or from a checkout:

```sh
python -m pip install ./python
```

Use the installed **0.3.0 or newer** Windows app as the backend:

```python
from maine_source import Client

with Client(
    app_path=r"C:\Users\you\AppData\Local\Programs\Maine Source\Maine Source.exe",
    workspace=r"D:\Datasets\my-project",
    keys_file=r"C:\Private\maine-source-keys.json",  # optional
) as api:
    recipe = api.recipe(
        name="CS papers",
        sourceIds=["arxiv"],
        inputs={"arxiv": "cat:cs.CR"},
        limits={"files": 20, "minutes": 10, "megabytes": 200},
    )
    job = api.collect(recipe, timeout=900)
    print(job["id"], job["status"], job["accepted"], job["errors"])
    api.export(job["id"], r"D:\Datasets\papers.jsonl")
```

Omit `keys_file` for anonymous sources. `MAINE_SOURCE_APP` can specify the app executable instead of `app_path`. Windows per-user installations are also detected at the standard install locations. The installed backend includes its own runtime; it does not require a separate Node installation. Python itself is needed only for the Python API, not the GUI.

For development from a source checkout, install Node.js 24 and run `pnpm install`. The SDK can find that checkout automatically, or accept `backend_command=["node", "/absolute/repo/scripts/agent-worker.mjs"]`. From another machine, use that machine's app/checkout and local workspace paths.

## Collections, pause, and resume

```python
dataset_id = api.start(recipe)
api.pause(dataset_id)
api.resume(dataset_id)                  # live paused run; same session and ID
job = api.wait(dataset_id, timeout=900)

# A stopped/interrupted run can be resumed after reopening the client:
api.resume(dataset_id, limits={"files": 40, "minutes": 20, "megabytes": 400})
job = api.wait(dataset_id, timeout=1500)
```

`start()` returns immediately. `collect()` means start plus wait. `pause()` and `stop()` target a dataset ID. `resume()` unpauses a live run, or reconstructs a stopped/interrupted/failed dataset from its saved records and checkpoints. Reached budgets must be increased for saved runs. Pauses count toward a wall-clock budget. Local imports need `local_files=[absolute_paths]` again after restarting. A wait timeout raises `TimeoutError` but does not implicitly stop collection; call `stop()` or close the client.

`collect()`/`wait()` return terminal job details, including partial-source failures; inspect `status`, `errors`, and validation results. A terminal result is not a guarantee that every source succeeded. Context-manager exit stops active work and releases the workspace. Abrupt process termination leaves a resumable interrupted run.

## Dataset methods

- `sources()` returns all implemented source definitions, input/settings fields, credential labels, documentation, and signup links.
- `recipe(**overrides)` returns defaults suitable for `start()`/`collect()`. Python recipes use the same field names and policies as the GUI.
- `datasets()` and `get(id)` report progress and the active dataset directory.
- `browse(id, query="text", source="arxiv", offset=0, limit=25)` searches records.
- `record(id, filename, offset=0)` reads a 25,000-character text page.
- `validate(id)` checks originals and record integrity.
- `move(id, parent)` copies/verifies/switches an idle dataset, retaining the previous copy as a backup.
- `export(id, destination, format="jsonl")` exports records, originals, and a companion manifest. `format="text"` accepts `text_output` with the GUI's output option IDs.

Use absolute paths for API exports and local files. The workspace contains `datasets/` and `exports/`; it defaults to Desktop/data/Maine-Source, including the Windows redirected Desktop. A GUI preference for an alternate workspace is not automatically imported into Python: pass that folder explicitly. One writer per workspace is enforced across current GUI/API processes. Different workspaces can be used independently. Close older GUI versions before sharing their data with the API.

## Portable credential JSON

Settings → **Import keys JSON** and **Export keys JSON** use the same format as the SDK. Import accepts a flat source-ID mapping:

```json
{"github": "YOUR_READ_ONLY_TOKEN", "nasa": "YOUR_NASA_KEY"}
```

Or the versioned bundle emitted by exports:

```json
{"schema": "maine-source.credentials.v1", "keys": {"govinfo": "YOUR_API_DATA_GOV_KEY"}}
```

Credential source IDs are `nvd`, `github`, `advisories`, `stackexchange`, `nasa`, `huggingface`, `govinfo`, and `openalex`. Unsupported IDs, malformed JSON, invalid values, and files above 64 KiB are rejected as a whole. Keys for named sources replace existing values; other keys are retained.

`api.import_keys(path)`, `api.set_credentials(mapping)`, and `api.export_keys(path)` manage API-session keys. Standalone `load_keys(path)` and `save_keys(path, mapping)` are also available. The API keeps imported keys in memory and does not access the GUI's encrypted vault. GUI import offers session-only use or encrypted local storage when available.

**Portable JSON is plaintext.** Protect it during transfer, keep it out of Git and shared datasets, and remove unwanted copies. Exporting from the GUI includes configured remembered and session-only keys. Python export includes the keys supplied to that client. Credentials travel to the backend through stdin, not command arguments, and are not automatically included in recipes, history, or dataset exports.

No API method deletes datasets or runs downloaded code. The API is local automation, not an HTTP service, authentication server, or MCP server. Provider permissions, rate limits, content failures, and the app's documented resume limitations still apply.
