from __future__ import annotations

import itertools
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from run_pronunciation_gop_demo import (  # noqa: E402
    DemoError,
    atomic_write,
    build_word_references,
    choose_gop_method,
    conservative_diagnostics,
    exact_gop_scores,
    load_dictionary,
    parse_args,
    parse_manual_pronunciations,
    run,
    run_qwen3_asr,
)


class DictionaryTests(unittest.TestCase):
    def test_loads_repository_style_js_dictionary_and_variants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.js"
            path.write_text(
                """export const dictionary = {
  "read": "R EH1 D",
  "read(2)": "R IY1 D",
  "books": "B UH1 K S",
}
""",
                encoding="utf-8",
            )
            dictionary, source = load_dictionary(path)
            normalized, words = build_word_references("Read books.", dictionary, {})

        self.assertEqual(normalized, "Read books.")
        self.assertEqual(source, str(path.resolve()))
        self.assertEqual(
            [variant.tokens for variant in words[0].variants],
            [("R", "EH", "D"), ("R", "IY", "D")],
        )
        self.assertEqual(words[1].selected.tokens, ("B", "UH", "K", "S"))

    def test_unknown_word_requires_an_explicit_pronunciation(self) -> None:
        dictionary = {"known": ["N OW1 N"]}
        with self.assertRaisesRegex(DemoError, "--pronunciation florp"):
            build_word_references("known florp", dictionary, {})

        manual = parse_manual_pronunciations(["florp=F L AO R P"])
        _, words = build_word_references("known florp", dictionary, manual)
        self.assertEqual(words[1].selected.tokens, ("F", "L", "AO", "R", "P"))


class AsrBridgeTests(unittest.TestCase):
    def test_collects_qwen_chunk_text_without_shell_interpolation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets = root / "assets"
            assets.mkdir()
            runner = root / "runner.js"
            runner.write_text("", encoding="utf-8")
            audio = root / "answer with spaces.webm"
            audio.write_bytes(b"audio")
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=(
                    "[ASR] chunk #1: 0.00s - 30.00s (30.00s) \"First part.\"\n"
                    "[ASR] chunk #2: 30.00s - 60.00s (30.00s) \"Second part.\"\n"
                ),
                stderr="",
            )
            with patch(
                "run_pronunciation_gop_demo.subprocess.run", return_value=completed
            ) as invoke:
                transcript = run_qwen3_asr(audio, assets, runner, "node")

        self.assertEqual(transcript, "First part. Second part.")
        command = invoke.call_args.args[0]
        self.assertEqual(command[-1], str(audio))
        self.assertNotIsInstance(command, str)


class GopPolicyTests(unittest.TestCase):
    def test_auto_bounds_exact_gop_work(self) -> None:
        self.assertEqual(choose_gop_method("auto", 100, 10, 25_000)[0], "exact")
        method, reason = choose_gop_method("auto", 3000, 400, 25_000)
        self.assertEqual(method, "viterbi")
        self.assertIn("fallback", reason)

    def test_explicit_exact_rejects_unbounded_run(self) -> None:
        with self.assertRaisesRegex(DemoError, "超过限制"):
            choose_gop_method("exact", 3000, 400, 25_000)

    def test_exact_gop_matches_brute_force_ctc_paths(self) -> None:
        try:
            from run_pronunciation_gop_demo import runtime

            torch = runtime().torch
        except DemoError as exc:
            self.skipTest(str(exc))
        probabilities = [
            [0.60, 0.20, 0.10, 0.10],
            [0.10, 0.70, 0.10, 0.10],
            [0.65, 0.10, 0.20, 0.05],
            [0.10, 0.10, 0.70, 0.10],
            [0.70, 0.10, 0.10, 0.10],
        ]
        posteriors = torch.tensor(probabilities, dtype=torch.float64).transpose(0, 1)
        actual = exact_gop_scores(posteriors, [1, 2])

        def collapse(path: tuple[int, ...]) -> tuple[int, ...]:
            deduplicated = [token for index, token in enumerate(path) if index == 0 or token != path[index - 1]]
            return tuple(token for token in deduplicated if token != 0)

        mass: dict[tuple[int, ...], float] = {}
        for path in itertools.product(range(4), repeat=5):
            probability = math.prod(probabilities[frame][token] for frame, token in enumerate(path))
            sequence = collapse(path)
            mass[sequence] = mass.get(sequence, 0.0) + probability
        numerator = mass[(1, 2)]
        expected = [
            math.log(numerator / sum(value for sequence, value in mass.items() if len(sequence) == 2 and sequence[1] == 2)),
            math.log(numerator / sum(value for sequence, value in mass.items() if len(sequence) == 2 and sequence[0] == 1)),
        ]
        for observed, wanted in zip(actual, expected):
            self.assertAlmostEqual(observed, wanted, places=5)


class ConservativeFeedbackTests(unittest.TestCase):
    @staticmethod
    def row(
        index: int,
        word_index: int,
        word: str,
        phone_index: int,
        expected: str,
        observed: str,
    ) -> dict[str, object]:
        ipa = {
            "B": "b",
            "P": "p",
            "TH": "θ",
            "S": "s",
            "Z": "z",
        }
        return {
            "index": index,
            "word_index": word_index,
            "phone_index": phone_index,
            "word": word,
            "expected": expected,
            "expected_ipa": ipa[expected],
            "acoustic_winner": observed,
            "acoustic_winner_ipa": ipa[observed],
            "gop_log_ratio": -2.0,
            "confidence": 0.8,
            "start_ms": index * 100,
            "end_ms": index * 100 + 20,
        }

    def test_requires_repeated_consonant_evidence_and_word_final_z(self) -> None:
        rows = [
            self.row(0, 0, "three", 0, "TH", "S"),
            self.row(1, 1, "both", 0, "TH", "S"),
            self.row(2, 2, "terms", 0, "Z", "S"),
            self.row(3, 3, "papers", 0, "Z", "S"),
            self.row(4, 4, "journals", 0, "Z", "S"),
        ]

        diagnostics = conservative_diagnostics(rows)

        self.assertEqual(
            [item["id"] for item in diagnostics],
            ["voiceless-dental-fricative", "final-z-devoicing"],
        )

    def test_initial_b_rule_ignores_internal_b(self) -> None:
        rows = [
            self.row(0, 0, "about", 1, "B", "P"),
            self.row(1, 1, "cabin", 2, "B", "P"),
        ]

        self.assertEqual(conservative_diagnostics(rows), [])


class OutputTests(unittest.TestCase):
    def test_atomic_write_replaces_output_with_readable_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            path.write_text("old", encoding="utf-8")

            atomic_write(path, "new\n")

            self.assertEqual(path.read_text(encoding="utf-8"), "new\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
            self.assertEqual(list(path.parent.glob("tmp*")), [])


class CliTests(unittest.TestCase):
    def test_requires_exactly_one_transcript_source(self) -> None:
        with patch("sys.stderr"):
            with self.assertRaises(SystemExit):
                parse_args(["--audio", "sample.wav"])
        args = parse_args(["--audio", "sample.wav", "--asr", "qwen3"])
        self.assertEqual(args.asr, "qwen3")

    def test_existing_output_fails_before_asr_or_model_work(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            audio = root / "sample.wav"
            audio.write_bytes(b"audio")
            model = root / "model"
            model.mkdir()
            output = root / "output"
            output.mkdir()
            (output / "result.json").write_text("{}", encoding="utf-8")
            args = parse_args(
                [
                    "--audio",
                    str(audio),
                    "--asr",
                    "qwen3",
                    "--model-dir",
                    str(model),
                    "--output-dir",
                    str(output),
                ]
            )

            with patch(
                "run_pronunciation_gop_demo.read_text_argument"
            ) as read_transcript:
                with self.assertRaisesRegex(DemoError, "输出已存在"):
                    run(args)

        read_transcript.assert_not_called()


if __name__ == "__main__":
    unittest.main()
