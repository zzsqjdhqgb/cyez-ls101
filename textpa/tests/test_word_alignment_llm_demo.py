from pathlib import Path
import sys
import unittest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from run_word_alignment_llm_demo import (  # noqa: E402
    mismatch_ids,
    word_alignment_evidence,
)


class WordAlignmentEvidenceTests(unittest.TestCase):
    def test_evidence_contains_raw_winners_without_evaluation_fields(self) -> None:
        source = {
            "id": "sample.wav",
            "transcript": "A test",
            "transcript_source": "ASR",
            "references": {
                "espeak": {
                    "ctc": {
                        "words": [
                            {
                                "word_index": 0,
                                "text": "A",
                                "start_ms": 10,
                                "end_ms": 50,
                                "score": 12,
                                "phones": [
                                    {
                                        "expected": "ɐ",
                                        "observed": "ə",
                                        "score": 1,
                                        "confidence": 0.9,
                                        "start_ms": 10,
                                        "end_ms": 50,
                                    }
                                ],
                            },
                            {
                                "word_index": 1,
                                "text": "test",
                                "start_ms": 50,
                                "end_ms": 100,
                                "phones": [
                                    {
                                        "expected": "t",
                                        "score": 99,
                                        "confidence": 0.8,
                                        "start_ms": 50,
                                        "end_ms": 70,
                                    }
                                ],
                            },
                        ]
                    }
                }
            },
        }

        evidence = word_alignment_evidence(source)

        serialized = repr(evidence)
        self.assertNotIn("score", serialized)
        self.assertNotIn("confidence", serialized)
        self.assertNotIn("strength", serialized)
        self.assertEqual(
            evidence["words"][0]["phones"][0]["acoustic_winner"], "ə"
        )
        self.assertEqual(
            evidence["words"][1]["phones"][0]["acoustic_winner"], "t"
        )
        self.assertEqual(mismatch_ids(evidence), {"W001-P01"})


if __name__ == "__main__":
    unittest.main()
