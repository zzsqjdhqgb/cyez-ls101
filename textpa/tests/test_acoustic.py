import math
import subprocess
import unittest
from unittest.mock import patch

from textpa_repro.acoustic import (
    audio_duration_seconds,
    enforce_audio_duration,
    load_audio_16khz,
)
from textpa_repro.errors import TextPAError


class AudioDurationTests(unittest.TestCase):
    @staticmethod
    def _probe_result(duration: str) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            args=["ffprobe"], returncode=0, stdout=duration, stderr=""
        )

    def test_audio_duration_parses_ffprobe_output(self) -> None:
        with patch(
            "textpa_repro.acoustic.subprocess.run",
            return_value=self._probe_result("12.750000\n"),
        ) as run:
            duration = audio_duration_seconds("sample.wav")

        self.assertEqual(duration, 12.75)
        run.assert_called_once()
        command = run.call_args.args[0]
        self.assertEqual(command[0], "ffprobe")
        self.assertEqual(command[-1], "sample.wav")

    def test_audio_over_duration_limit_is_rejected(self) -> None:
        with patch(
            "textpa_repro.acoustic.subprocess.run",
            return_value=self._probe_result("30.01\n"),
        ):
            with self.assertRaises(TextPAError):
                enforce_audio_duration("too-long.wav", 30.0)

    def test_invalid_duration_limits_are_rejected_before_probe(self) -> None:
        with patch("textpa_repro.acoustic.subprocess.run") as run:
            for maximum in (0.0, -1.0, math.nan):
                with self.subTest(maximum=maximum):
                    with self.assertRaises(ValueError):
                        enforce_audio_duration("sample.wav", maximum)

        run.assert_not_called()

    def test_audio_decode_passes_a_bounded_duration_to_ffmpeg(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["ffmpeg"],
            returncode=0,
            stdout=b"\x00\x00\x00\x00" * 16000,
            stderr=b"",
        )
        with patch(
            "textpa_repro.acoustic.subprocess.run", return_value=completed
        ) as run:
            audio = load_audio_16khz("sample.wav", 1.0)

        self.assertEqual(audio.size, 16000)
        command = run.call_args.args[0]
        duration_index = command.index("-t")
        decode_bound = float(command[duration_index + 1])
        self.assertTrue(math.isfinite(decode_bound))
        self.assertGreaterEqual(decode_bound, 1.0)
        self.assertLessEqual(decode_bound, 2.0)

    def test_audio_decode_rejects_samples_beyond_actual_limit(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["ffmpeg"],
            returncode=0,
            stdout=b"\x00\x00\x00\x00" * 16001,
            stderr=b"",
        )
        with patch(
            "textpa_repro.acoustic.subprocess.run", return_value=completed
        ) as run:
            with self.assertRaises(TextPAError):
                load_audio_16khz("too-long.wav", 1.0)

        self.assertIn("-t", run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
