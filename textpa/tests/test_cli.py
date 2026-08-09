import argparse
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from textpa_repro.cli import (
    _whisper_model_identity,
    command_assess,
    command_extract_cues,
)
from textpa_repro.errors import SchemaError
from textpa_repro.io import read_jsonl
from textpa_repro.models import Assessment, TextCues


class TrackingAssessor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.call_count = 0
        self.prompts: list[str] = []

    def assess(self, prompt: str) -> Assessment:
        with self._lock:
            self.active += 1
            self.call_count += 1
            self.prompts.append(prompt)
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.03)
            return Assessment(accuracy=4, fluency=4, reasoning="Clear.")
        finally:
            with self._lock:
                self.active -= 1


class CliProvenanceTests(unittest.TestCase):
    def test_extract_resume_rejects_audio_content_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "sample.wav"
            audio.write_bytes(b"first audio content")
            source = root / "transcripts.jsonl"
            source.write_text(
                json.dumps(
                    {
                        "id": "sample.wav",
                        "audio_path": str(audio),
                        "transcript": "A short sample.",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            output = root / "cues.jsonl"
            args = argparse.Namespace(
                input=str(source),
                output=str(output),
                device="cpu",
                torch_threads=1,
                max_audio_seconds=30.0,
                cache_dir=None,
                overwrite=True,
            )
            fake_extractor = Mock()
            fake_extractor.make_cues.return_value = TextCues(
                utterance_id="sample.wav",
                audio_path=str(audio),
                transcript="A short sample.",
                phonemes_cmu="AH",
                phonemes_ipa="ə",
            )
            with patch("textpa_repro.cli.enforce_audio_duration"), patch(
                "textpa_repro.cli.PhonemeExtractor", return_value=fake_extractor
            ):
                self.assertEqual(command_extract_cues(args), 0)

            audio.write_bytes(b"replacement audio content")
            args.overwrite = False
            with patch("textpa_repro.cli.enforce_audio_duration"), patch(
                "textpa_repro.cli.PhonemeExtractor"
            ) as extractor_class:
                with self.assertRaises(SchemaError):
                    command_extract_cues(args)
                extractor_class.assert_not_called()

    def test_custom_whisper_model_identity_hashes_local_contents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model"
            model.mkdir()
            weights = model / "model.bin"
            weights.write_bytes(b"first")
            first = _whisper_model_identity(str(model))

            weights.write_bytes(b"second")
            second = _whisper_model_identity(str(model))

            self.assertNotEqual(first["sha256"], second["sha256"])

    def test_unpinned_remote_whisper_model_is_rejected(self) -> None:
        with self.assertRaises(SchemaError):
            _whisper_model_identity("organization/mutable-model-name")


class CliAssessConcurrencyTests(unittest.TestCase):
    def _write_cues(self, root: Path, count: int = 6) -> Path:
        path = root / "cues.jsonl"
        records = [
            TextCues(
                utterance_id=f"sample-{index}.wav",
                transcript=f"Sample number {index}.",
                phonemes_cmu="S AE M P AH L",
                phonemes_ipa="s ae m p əl",
            ).to_dict()
            for index in range(count)
        ]
        path.write_text(
            "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
            encoding="utf-8",
        )
        return path

    @staticmethod
    def _args(source: Path, output: Path, concurrency: int) -> argparse.Namespace:
        return argparse.Namespace(
            input=str(source),
            output=str(output),
            model="test-model",
            base_url=None,
            api_key_env="TEXTPA_API_KEY",
            api_style="chat",
            json_mode=False,
            json_input=False,
            calibration_anchors=None,
            exclude_calibration_anchors=False,
            reasoning_effort="high",
            retries=3,
            timeout=120.0,
            concurrency=concurrency,
            overwrite=True,
        )

    def test_assess_respects_concurrency_and_writes_each_record_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._write_cues(root)
            output = root / "assessments.jsonl"
            assessor = TrackingAssessor()
            args = self._args(source, output, concurrency=2)

            with patch(
                "textpa_repro.cli.OpenAICompatibleAssessor", return_value=assessor
            ):
                self.assertEqual(command_assess(args), 0)

            records = list(read_jsonl(output))
            ids = [record["id"] for record in records]
            self.assertEqual(assessor.call_count, 6)
            self.assertGreater(assessor.max_active, 1)
            self.assertLessEqual(assessor.max_active, 2)
            self.assertEqual(len(ids), 6)
            self.assertEqual(len(set(ids)), 6)
            self.assertEqual(set(ids), {f"sample-{index}.wav" for index in range(6)})
            self.assertTrue(
                all(record["reasoning_effort"] == "high" for record in records)
            )
            manifest = json.loads(
                Path(f"{output}.manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["config"]["reasoning_effort"], "high")

    def test_assess_uses_and_excludes_calibration_anchors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._write_cues(root, count=3)
            anchors = root / "anchors.jsonl"
            anchor_record = TextCues(
                utterance_id="sample-1.wav",
                transcript="Sample number 1.",
                phonemes_cmu="S AE M P AH L",
                phonemes_ipa="s ae m p əl",
            ).to_dict()
            anchor_record["human_scores"] = {"accuracy": 1.6, "fluency": 2.0}
            anchors.write_text(
                json.dumps(anchor_record, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            output = root / "assessments.jsonl"
            assessor = TrackingAssessor()
            args = self._args(source, output, concurrency=2)
            args.calibration_anchors = str(anchors)
            args.exclude_calibration_anchors = True

            with patch(
                "textpa_repro.cli.OpenAICompatibleAssessor", return_value=assessor
            ):
                self.assertEqual(command_assess(args), 0)

            records = list(read_jsonl(output))
            self.assertEqual(
                {item["id"] for item in records},
                {"sample-0.wav", "sample-2.wav"},
            )
            self.assertTrue(
                all(
                    item["prompt_mode"] == "paper-with-calibration-anchors"
                    for item in records
                )
            )
            manifest = json.loads(
                Path(f"{output}.manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                manifest["config"]["calibration_anchors"],
                [{"id": "sample-1.wav", "accuracy": 1.6, "fluency": 2.0}],
            )
            self.assertTrue(manifest["config"]["exclude_calibration_anchors"])
            self.assertEqual(len(assessor.prompts), 2)
            self.assertTrue(
                all("Sample number 1." in prompt for prompt in assessor.prompts)
            )
            self.assertTrue(
                all(
                    "{'Accuracy': 1.6, 'Fluency': 2.0}" in prompt
                    for prompt in assessor.prompts
                )
            )

    def test_assess_rejects_mismatched_excluded_anchor_cues(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._write_cues(root, count=2)
            anchors = root / "anchors.jsonl"
            anchor_record = TextCues(
                utterance_id="sample-1.wav",
                transcript="Different cues under the same ID.",
                phonemes_cmu="D IH F ER AH N T",
                phonemes_ipa="d ɪ f ɚ ə n t",
            ).to_dict()
            anchor_record["human_scores"] = {"accuracy": 1.6, "fluency": 2.0}
            anchors.write_text(
                json.dumps(anchor_record, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            args = self._args(source, root / "output.jsonl", concurrency=1)
            args.calibration_anchors = str(anchors)
            args.exclude_calibration_anchors = True

            with patch("textpa_repro.cli.OpenAICompatibleAssessor") as assessor_class:
                with self.assertRaisesRegex(SchemaError, "do not match cues"):
                    command_assess(args)
                assessor_class.assert_not_called()

    def test_nonpositive_concurrency_is_rejected_before_output_or_assessor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = self._write_cues(root, count=1)

            for concurrency in (0, -1):
                with self.subTest(concurrency=concurrency):
                    output = root / f"invalid-{concurrency}.jsonl"
                    args = self._args(source, output, concurrency=concurrency)
                    with patch(
                        "textpa_repro.cli.OpenAICompatibleAssessor"
                    ) as assessor_class, patch(
                        "textpa_repro.cli.JsonlResumeWriter"
                    ) as writer_class:
                        with self.assertRaises(ValueError):
                            command_assess(args)

                    assessor_class.assert_not_called()
                    writer_class.assert_not_called()
                    self.assertFalse(output.exists())
                    self.assertFalse(Path(f"{output}.manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
