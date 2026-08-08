import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from textpa_repro.cli import (
    _whisper_model_identity,
    command_extract_cues,
)
from textpa_repro.errors import SchemaError
from textpa_repro.models import TextCues


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


if __name__ == "__main__":
    unittest.main()
