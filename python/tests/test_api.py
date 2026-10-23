import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from maine_source import Client, MaineSourceError, load_keys, save_keys


class AgentAPI(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / ".test-data"
        root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root, prefix="python-api-")
        self.root = Path(self.temp.name)
        self.workspace = self.root / "workspace"
        self.options = {"app_path": os.environ["MAINE_SOURCE_TEST_APP"]} if os.environ.get("MAINE_SOURCE_TEST_APP") else {}
        self.input = self.root / "input.jsonl"
        with self.input.open("w", encoding="utf-8") as stream:
            for n in range(300):
                stream.write(json.dumps({"id": str(n), "text": f"Engineering document {n}: café 😀", "rights": {"expression": "CC0-1.0", "basis": "source-declaration"}}) + "\n")

    def tearDown(self):
        self.temp.cleanup()

    def client(self):
        return Client(workspace=self.workspace, **self.options)

    def recipe(self, client, files=80):
        return client.recipe(name="Python dataset", sourceIds=["local"], minLength=1, limits={"files": files, "minutes": 0, "megabytes": 0})

    def test_collect_pause_resume_move_export(self):
        chosen = self.root / "Chosen downloads"
        moved = self.root / "Moved downloads"
        chosen.mkdir(); moved.mkdir()
        with self.client() as api:
            self.assertIn("local", {source["id"] for source in api.sources()})
            recipe = self.recipe(api)
            recipe["downloadDirectory"] = str(chosen)
            dataset = api.start(recipe, local_files=[self.input])
            self.assertEqual(api.pause(dataset)["status"], "paused")
            with self.assertRaises(MaineSourceError):
                api.set_credentials({"github": "test-secret-key"})
            api.resume(dataset)
            job = api.wait(dataset, timeout=30)
            self.assertEqual(job["accepted"], 80)
            self.assertEqual(job["status"], "completed")
            self.assertEqual(api.browse(dataset, query="café")["total"], 80)
            first = api.browse(dataset)["rows"][0]["file"]
            self.assertIn("😀", api.record(dataset, first)["text"])
            self.assertFalse(api.validate(dataset)["issues"])
            directory = api.move(dataset, moved)
            self.assertEqual(Path(directory).parent, moved)
            output = self.root / "portable.jsonl"
            api.export(dataset, output)
            self.assertEqual(len(output.read_text(encoding="utf-8").splitlines()), 80)
        with self.client() as reopened:
            self.assertEqual(reopened.get(dataset)["directory"], directory)
            self.assertEqual(reopened.get(dataset)["accepted"], 80)

    def test_stopped_and_crashed_runs_resume_without_duplicates(self):
        with self.client() as api:
            dataset = api.start(self.recipe(api, 100), local_files=[self.input])
            api.pause(dataset)
            api.stop(dataset)
            self.assertEqual(api.get(dataset)["status"], "stopped")
        crashed = self.client()
        crashed.resume(dataset, local_files=[self.input])
        crashed.pause(dataset)
        crashed._process.kill(); crashed._process.wait()
        crashed.close()
        with self.client() as api:
            self.assertEqual(api.get(dataset)["status"], "interrupted")
            api.resume(dataset, local_files=[self.input])
            self.assertEqual(api.wait(dataset, timeout=30)["accepted"], 100)
            self.assertEqual(api.browse(dataset)["total"], 100)
            self.assertFalse(api.validate(dataset)["issues"])

    def test_keys_are_portable_and_never_saved_in_dataset_or_history(self):
        file = self.root / "keys.json"
        save_keys(file, {"github": "test-secret-value", "nasa": "test-second-key"})
        self.assertEqual(load_keys(file)["github"], "test-secret-value")
        with self.client() as api:
            api.import_keys(file)
            second = self.root / "second.json"
            api.export_keys(second)
            self.assertEqual(load_keys(second), load_keys(file))
            with self.assertRaises(MaineSourceError):
                api.set_credentials({"unknown": "test-third-key"})
            job = api.collect(self.recipe(api, 1), local_files=[self.input], timeout=30)
            output = self.root / "out.jsonl"
            api.export(job["id"], output)
        for filename in self.workspace.rglob("*"):
            if filename.is_file():
                self.assertNotIn(b"test-secret-value", filename.read_bytes())
        self.assertNotIn("test-secret-value", output.read_text(encoding="utf-8"))
        file.write_text('{"github": 123}', encoding="utf-8")
        with self.assertRaises(MaineSourceError):
            load_keys(file)

    def test_workspace_collision_and_path_validation(self):
        with self.client() as api:
            with self.assertRaises(MaineSourceError):
                with self.client():
                    pass
            with self.assertRaises(MaineSourceError):
                api.browse("../outside")
            with self.assertRaises(MaineSourceError):
                api.start({**self.recipe(api), "credentials": {"github": "do-not-persist"}})
        # A normal close releases the lock immediately.
        with self.client() as api:
            self.assertEqual(api.datasets(), [])


if __name__ == "__main__":
    unittest.main()
