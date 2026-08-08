import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from textpa_repro.errors import SchemaError
from textpa_repro.io import JsonlResumeWriter, read_jsonl, write_json_atomic


class JsonlResumeWriterTests(unittest.TestCase):
    def test_written_record_is_immediately_readable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            record = {"id": "a.wav", "transcript": "Hello."}

            with JsonlResumeWriter(path) as writer:
                writer.write(record)
                self.assertEqual(list(read_jsonl(path)), [record])

    def test_duplicate_id_is_rejected_when_resuming(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            record = {"id": "a.wav", "transcript": "Hello."}

            with JsonlResumeWriter(path) as writer:
                writer.write(record)

            with JsonlResumeWriter(path) as writer:
                with self.assertRaises(SchemaError):
                    writer.write({"id": "a.wav", "transcript": "Changed."})

            self.assertEqual(list(read_jsonl(path)), [record])

    def test_damaged_unterminated_tail_is_truncated_before_resuming(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            first = {"id": "a.wav", "transcript": "First."}
            path.write_text(
                json.dumps(first, separators=(",", ":")) + "\n" + '{"id":"torn"',
                encoding="utf-8",
            )

            second = {"id": "b.wav", "transcript": "Second."}
            with JsonlResumeWriter(path) as writer:
                self.assertEqual(writer.seen_ids, {"a.wav"})
                writer.write(second)

            self.assertEqual(list(read_jsonl(path)), [first, second])

    def test_valid_unterminated_tail_gets_a_separator_before_append(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            first = {"id": "a.wav", "transcript": "First."}
            path.write_text(json.dumps(first, separators=(",", ":")), encoding="utf-8")

            second = {"id": "b.wav", "transcript": "Second."}
            with JsonlResumeWriter(path) as writer:
                writer.write(second)

            self.assertEqual(list(read_jsonl(path)), [first, second])

    def test_manifest_mismatch_rejects_resume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            with JsonlResumeWriter(
                path, manifest={"stage": "assess", "model": "model-a"}
            ) as writer:
                writer.write({"id": "a.wav", "assessment": {"accuracy": 4}})

            with self.assertRaises(SchemaError):
                JsonlResumeWriter(
                    path, manifest={"stage": "assess", "model": "model-b"}
                )

    def test_overwrite_truncates_output_before_committing_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "results.jsonl"
            path.write_text('{"id":"old.wav"}\n', encoding="utf-8")
            manifest = {"stage": "assess", "model": "model-b"}

            def observe_manifest_write(
                manifest_path: str | Path, value: dict[str, str]
            ) -> None:
                self.assertEqual(path.read_bytes(), b"")
                write_json_atomic(manifest_path, value)

            with patch(
                "textpa_repro.io.write_json_atomic",
                side_effect=observe_manifest_write,
            ) as write_manifest:
                with JsonlResumeWriter(path, overwrite=True, manifest=manifest):
                    pass

            write_manifest.assert_called_once()


if __name__ == "__main__":
    unittest.main()
