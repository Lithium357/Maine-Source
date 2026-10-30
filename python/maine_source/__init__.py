"""Local Python API for Maine Source. Python 3.10+, no runtime dependencies."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
from typing import Mapping, Sequence

__all__ = ["Client", "MaineSourceError", "load_keys", "save_keys"]
__version__ = "0.3.2"
_SCHEMA = "maine-source.credentials.v1"


class MaineSourceError(RuntimeError):
    """An API or collection backend operation failed."""


def _keys(data):
    if isinstance(data, dict) and "keys" in data:
        if data.get("schema", _SCHEMA) != _SCHEMA or set(data) - {"schema", "exportedAt", "keys"}:
            raise MaineSourceError("Unsupported credential file format")
        data = data["keys"]
    if not isinstance(data, dict) or not data:
        raise MaineSourceError("Credentials must be a nonempty source-ID to key mapping")
    result = {}
    for source, value in data.items():
        if not isinstance(source, str) or not isinstance(value, str) or not value.strip() or len(value) > 4096 or any(c in value for c in "\r\n\0"):
            raise MaineSourceError("Invalid credential mapping")
        result[source] = value.strip()
    return result


def load_keys(filename):
    """Read a UTF-8 JSON bundle or flat mapping. Does not log or print its values."""
    with Path(filename).open("rb") as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise MaineSourceError("Credential JSON exceeds 64 KiB")
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (ValueError, UnicodeError):
        raise MaineSourceError("Invalid UTF-8 credential JSON") from None
    return _keys(data)


def save_keys(filename, keys):
    """Write portable PLAINTEXT credentials. Keep the resulting file private."""
    from datetime import datetime, timezone
    data = {"schema": _SCHEMA, "exportedAt": datetime.now(timezone.utc).isoformat(), "keys": _keys(dict(keys))}
    encoded = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(encoded) > 65536:
        raise MaineSourceError("Credential JSON exceeds 64 KiB")
    # A temporary exclusive file avoids following an existing target symlink.
    import uuid
    target = Path(filename).absolute()
    temp = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def _default_workspace():
    desktop = Path.home() / "Desktop"
    if os.name == "nt":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
                desktop = Path(os.path.expandvars(winreg.QueryValueEx(key, "Desktop")[0]))
        except OSError:
            pass
    return desktop / "data" / "Maine-Source"


class Client:
    """Own one headless collector process. Use as a context manager to stop cleanly.

    ``app_path`` selects the installed Maine Source.exe. For development, pass
    ``backend_command=[node, '/repo/scripts/agent-worker.mjs']`` instead.
    Credentials are sent through stdin, never through arguments or environment.
    """

    def __init__(self, *, workspace=None, app_path=None, backend_command: Sequence[str] | None = None,
                 credentials: Mapping[str, str] | None = None, keys_file=None, request_timeout=300):
        self.workspace = Path(workspace or _default_workspace()).resolve()
        self._credentials = {}
        self._seq = 0
        self._mutex = threading.Lock()
        self._queue = queue.Queue()
        self._closed = False
        self.request_timeout = request_timeout
        if app_path and backend_command:
            raise ValueError("Choose app_path or backend_command")
        packaged_runtime = False
        if backend_command:
            command = list(map(str, backend_command))
        else:
            executable = app_path or os.environ.get("MAINE_SOURCE_APP")
            if not executable and os.name == "nt":
                for name in ("Maine Source", "maine-source"):
                    candidate = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / name / "Maine Source.exe"
                    if candidate.is_file():
                        executable = candidate
                        break
            if executable:
                packaged_runtime = True
                executable = Path(executable).resolve()
                worker = executable.parent / "resources" / "app.asar" / "desktop" / "headless.cjs"
                bootstrap = 'require(process.argv[1]).run(process.argv[process.argv.indexOf("--workspace")+1]).catch(()=>{process.stderr.write("Maine Source headless startup failed\\n");process.exitCode=1;})'
                command = [str(executable), "-e", bootstrap, str(worker)]
            else:
                worker = Path(__file__).resolve().parents[2] / "scripts" / "agent-worker.mjs"
                node = shutil.which("node")
                if not worker.is_file() or not node:
                    raise MaineSourceError("Set app_path or MAINE_SOURCE_APP to an installed Maine Source.exe, or supply backend_command")
                command = [node, str(worker)]
        command += ["--workspace", str(self.workspace)]
        env = os.environ.copy()
        if packaged_runtime:
            env["ELECTRON_RUN_AS_NODE"] = "1"
        else:
            env.pop("ELECTRON_RUN_AS_NODE", None)
        self._process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         text=True, encoding="utf-8", errors="replace", bufsize=1, env=env,
                                         creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._drain_errors, daemon=True).start()
        try:
            hello = self._request("ping", timeout=30)
            if hello.get("protocol") != "maine-source.agent.v1":
                raise MaineSourceError("Incompatible Maine Source backend")
            if keys_file:
                self.import_keys(keys_file)
            if credentials:
                self.set_credentials(credentials)
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            for line in self._process.stdout:
                try:
                    reply = json.loads(line)
                    if isinstance(reply, dict) and "id" in reply:
                        self._queue.put(reply)
                except ValueError:
                    pass
        finally:
            self._process.stdout.close()
            self._queue.put(None)

    def _drain_errors(self):
        # Drain to avoid blocking the backend. Never surface raw stderr as it may
        # contain provider/runtime details; structured API errors are sanitized.
        try:
            while self._process.stderr.read(4096):
                pass
        finally:
            self._process.stderr.close()

    def _request(self, method, params=None, *, timeout=None):
        with self._mutex:
            if self._closed:
                raise MaineSourceError("Client is closed")
            self._seq += 1
            frame = json.dumps({"id": self._seq, "method": method, "params": params or {}}, ensure_ascii=False)
            if len(frame.encode("utf-8")) > 1048576:
                raise MaineSourceError("Agent request exceeds 1 MiB")
            try:
                self._process.stdin.write(frame + "\n")
                self._process.stdin.flush()
            except (OSError, ValueError):
                raise MaineSourceError("Headless backend is unavailable; check whether the workspace is in use") from None
            deadline = time.monotonic() + (self.request_timeout if timeout is None else timeout)
            while True:
                try:
                    reply = self._queue.get(timeout=max(0, deadline - time.monotonic()))
                except queue.Empty:
                    raise TimeoutError("Maine Source API request timed out") from None
                if reply is None:
                    raise MaineSourceError("Headless backend exited; check whether the workspace is in use")
                if reply.get("id") != self._seq:
                    continue
                if "error" in reply:
                    raise MaineSourceError(reply["error"].get("message", "API operation failed"))
                return reply.get("result")

    def sources(self):
        return self._request("sources")

    def recipe(self, **overrides):
        recipe = self._request("recipe:default")
        recipe.update(overrides)
        return recipe

    def set_credentials(self, keys):
        validated = _keys(dict(keys))
        result = self._request("credentials:set", {"keys": validated})
        self._credentials.update(validated)
        return result

    def import_keys(self, filename):
        return self.set_credentials(load_keys(filename))

    def export_keys(self, filename):
        save_keys(filename, self._credentials)

    def start(self, recipe, *, local_files=None):
        params = {"recipe": recipe}
        if local_files is not None:
            params["localFiles"] = [str(Path(p).resolve()) for p in local_files]
        return self._request("dataset:start", params)["id"]

    def collect(self, recipe, *, local_files=None, timeout=None):
        return self.wait(self.start(recipe, local_files=local_files), timeout=timeout)

    def datasets(self):
        return self._request("dataset:list")

    def get(self, dataset_id):
        return self._request("dataset:get", {"id": dataset_id})

    def wait(self, dataset_id, *, timeout=None, poll_interval=0.2):
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            job = self.get(dataset_id)
            if job["status"] not in ("running", "paused", "stopping"):
                return job
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError("Collection is still active; call stop() to stop it")
            time.sleep(max(0.02, poll_interval))

    def pause(self, dataset_id):
        return self._request("dataset:pause", {"id": dataset_id})

    def resume(self, dataset_id, *, limits=None, local_files=None):
        params = {"id": dataset_id}
        if limits is not None:
            params["limits"] = limits
        if local_files is not None:
            params["localFiles"] = [str(Path(p).resolve()) for p in local_files]
        return self._request("dataset:resume", params)

    def stop(self, dataset_id):
        return self._request("dataset:stop", {"id": dataset_id})

    def browse(self, dataset_id, **options):
        return self._request("dataset:browse", {"id": dataset_id, "options": options})

    def record(self, dataset_id, filename, *, offset=0):
        return self._request("dataset:record", {"id": dataset_id, "file": filename, "offset": offset})

    def validate(self, dataset_id):
        return self._request("dataset:validate", {"id": dataset_id})

    def move(self, dataset_id, parent):
        return self._request("dataset:move", {"id": dataset_id, "parent": str(Path(parent).resolve())})["directory"]

    def export(self, dataset_id, destination, *, format="jsonl", text_output=None):
        params = {"id": dataset_id, "destination": str(Path(destination).resolve()), "format": format}
        if text_output is not None:
            params["textOutput"] = text_output
        return self._request("dataset:export", params)

    def close(self):
        if getattr(self, "_closed", True):
            return
        try:
            if self._process.poll() is None:
                self._request("shutdown", timeout=15)
        except (MaineSourceError, TimeoutError, OSError):
            pass
        finally:
            self._closed = True
            self._credentials.clear()
            try:
                self._process.stdin.close()
            except OSError:
                pass
            try:
                self._process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self._process.terminate()
                try:
                    self._process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    self._process.wait()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
