from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from run_pronunciation_gop_llm_demo import (  # noqa: E402
    low_gop_evidence,
    render_prompt,
    validate_evidence_package,
    validate_feedback,
)


def phone(
    index: int,
    score: float,
    *,
    word: str = "test",
    word_index: int = 0,
    phone_index: int | None = None,
    expected: str = "B",
    expected_ipa: str = "b",
    acoustic_winner: str = "P",
    acoustic_winner_ipa: str = "p",
) -> dict[str, object]:
    return {
        "index": index,
        "word_index": word_index,
        "phone_index": index if phone_index is None else phone_index,
        "word": word,
        "expected": expected,
        "expected_ipa": expected_ipa,
        "acoustic_winner": acoustic_winner,
        "acoustic_winner_ipa": acoustic_winner_ipa,
        "best_alternative": "P",
        "best_alternative_ipa": "p",
        "gop_log_ratio": score,
        "confidence": 0.8,
        "start_ms": index * 20,
        "end_ms": index * 20 + 20,
    }


class EvidenceTests(unittest.TestCase):
    def test_selects_every_low_row_without_consonant_filter(self) -> None:
        result = {
            "audio_path": "/tmp/sample.wav",
            "transcript": "test",
            "transcript_source": "ASR",
            "phones": [
                phone(0, -0.35),
                phone(1, -0.2),
                {**phone(2, -0.5), "expected": "AE", "acoustic_winner": "AH"},
            ],
        }

        evidence = low_gop_evidence(result, -0.35)

        self.assertEqual([row["evidence_id"] for row in evidence["rows"]], ["GOP-0002", "GOP-0000"])
        self.assertEqual(evidence["selection_policy"]["selected_count"], 2)
        self.assertIn("No consonant", evidence["selection_policy"]["meaning"])

    def test_prompt_contains_all_selected_evidence_ids(self) -> None:
        evidence = low_gop_evidence(
            {
                "transcript": "FULL TRANSCRIPT MUST STAY LOCAL",
                "phones": [phone(0, -1.0), phone(1, -2.0)],
            },
            -0.35,
        )
        prompt = render_prompt(evidence)
        self.assertIn("GOP-0000", prompt)
        self.assertIn("GOP-0001", prompt)
        self.assertIn("word_contexts", prompt)
        self.assertIn("reference_phones", prompt)
        self.assertIn("observed_phones", prompt)
        self.assertIn("gop_evidence", prompt)
        self.assertNotIn("FULL TRANSCRIPT MUST STAY LOCAL", prompt)

    def test_builds_word_context_with_complete_sequences(self) -> None:
        phones: list[dict[str, object]] = []
        words: list[dict[str, object]] = []
        for word_index in range(5):
            word = f"word{word_index}"
            expected = ["B", "EH"]
            expected_ipa = ["b", "ɛ"]
            observed = ["B", "AE"] if word_index == 2 else ["B", "EH"]
            word_phones = []
            for phone_index in range(2):
                row = phone(
                    len(phones),
                    -1.0 if word_index == 2 and phone_index == 1 else 1.0,
                    word=word,
                    word_index=word_index,
                    phone_index=phone_index,
                    expected=expected[phone_index],
                    expected_ipa=expected_ipa[phone_index],
                    acoustic_winner=observed[phone_index],
                    acoustic_winner_ipa=("b", "æ")[phone_index]
                    if word_index == 2
                    else expected_ipa[phone_index],
                )
                phones.append(row)
                word_phones.append(row)
            words.append(
                {
                    "word_index": word_index,
                    "text": word,
                    "expected_arpabet": expected,
                    "expected_ipa": expected_ipa,
                    "start_ms": word_index * 100,
                    "end_ms": word_index * 100 + 80,
                    "phones": word_phones,
                }
            )

        evidence = low_gop_evidence({"phones": phones, "words": words}, -0.35)

        self.assertEqual(len(evidence["word_contexts"]), 1)
        context = evidence["word_contexts"][0]
        self.assertEqual(context["word"], "word2")
        self.assertEqual(
            [(item["relative_position"], item["word"]) for item in context["context_words"]],
            [(-2, "word0"), (-1, "word1"), (0, "word2"), (1, "word3"), (2, "word4")],
        )
        self.assertEqual(context["reference_phones"]["arpabet"], ["B", "EH"])
        self.assertEqual(context["observed_phones"]["arpabet"], ["B", "AE"])
        self.assertEqual([row["evidence_id"] for row in context["gop_evidence"]], ["GOP-0005"])
        validate_evidence_package(evidence)

    def test_context_window_is_clipped_at_transcript_boundary(self) -> None:
        rows = [phone(index, -1.0 if index == 0 else 1.0, word=f"w{index}", word_index=index) for index in range(3)]
        evidence = low_gop_evidence({"phones": rows}, -0.35)
        context = evidence["word_contexts"][0]
        self.assertEqual([item["word"] for item in context["context_words"]], ["w0", "w1", "w2"])


class ValidationTests(unittest.TestCase):
    def test_requires_exactly_once_coverage(self) -> None:
        evidence = low_gop_evidence({"phones": [phone(0, -1.0), phone(1, -2.0)]}, -0.35)
        valid = {
            "summary_zh": "保守整理。",
            "feedback_items": [
                {
                    "evidence_ids": ["GOP-0000"],
                    "decision": "needs_listening",
                    "observations": [
                        {
                            "evidence_id": "GOP-0000",
                            "expected": "B",
                            "expected_ipa": "b",
                            "acoustic_winner": "P",
                            "acoustic_winner_ipa": "p",
                        }
                    ],
                    "finding_zh": "可能存在差异。",
                    "rationale_zh": "需要听音确认。",
                    "practice_zh": "对比练习。",
                }
            ],
            "withheld_differences": [
                {
                    "evidence_ids": ["GOP-0001"],
                    "observations": [
                        {
                            "evidence_id": "GOP-0001",
                            "expected": "B",
                            "expected_ipa": "b",
                            "acoustic_winner": "P",
                            "acoustic_winner_ipa": "p",
                        }
                    ],
                    "reason_zh": "可能是模型混淆。",
                }
            ],
            "limitations_zh": ["不能听音。"],
        }
        validate_feedback(valid, evidence)

        invalid = json.loads(json.dumps(valid))
        invalid["withheld_differences"] = []
        with self.assertRaisesRegex(ValueError, "every low-GOP"):
            validate_feedback(invalid, evidence)

    def test_rejects_unknown_or_duplicate_ids(self) -> None:
        evidence = low_gop_evidence({"phones": [phone(0, -1.0)]}, -0.35)
        invalid = {
            "summary_zh": "保守整理。",
            "feedback_items": [
                {
                    "evidence_ids": ["GOP-9999"],
                    "decision": "likely_issue",
                    "observations": [],
                    "finding_zh": "x",
                    "rationale_zh": "x",
                    "practice_zh": "x",
                }
            ],
            "withheld_differences": [],
            "limitations_zh": ["x"],
        }
        with self.assertRaisesRegex(ValueError, "unknown"):
            validate_feedback(invalid, evidence)


if __name__ == "__main__":
    unittest.main()
