import unittest

from textpa_repro.errors import CalibrationError
from textpa_repro.scoring import (
    deployment_accuracy,
    minmax,
    paper_cohort_fusion,
    paper_smith_waterman_similarity,
    phone_smith_waterman_similarity,
)


class ScoringTests(unittest.TestCase):
    def test_paper_similarity_is_character_level(self) -> None:
        self.assertEqual(paper_smith_waterman_similarity("abc", "abc"), 1.0)
        self.assertAlmostEqual(
            paper_smith_waterman_similarity("abc", "axc"), 2.0 / 3.0
        )
        self.assertEqual(paper_smith_waterman_similarity("", "abc"), 1.0)

    def test_phone_variant_tokenizes_on_spaces(self) -> None:
        character_score = paper_smith_waterman_similarity("t ʃ", "tʃ")
        phone_score = phone_smith_waterman_similarity("t ʃ", "tʃ")
        self.assertGreater(character_score, phone_score)

    def test_phone_variant_does_not_reward_one_empty_sequence(self) -> None:
        self.assertEqual(phone_smith_waterman_similarity("", "a"), 0.0)
        self.assertEqual(phone_smith_waterman_similarity("a", ""), 0.0)

    def test_paper_cohort_fusion(self) -> None:
        llm, ipa, final = paper_cohort_fusion([1, 3, 5], [0.8, 0.2, 0.5])
        self.assertEqual(llm, [0.0, 0.5, 1.0])
        self.assertEqual(ipa, [1.0, 0.0, 0.4999999999999999])
        self.assertEqual(final[0], 0.5)
        self.assertEqual(final[1], 0.25)

    def test_constant_cohort_is_rejected(self) -> None:
        with self.assertRaises(CalibrationError):
            minmax([3, 3])

    def test_deployment_score_has_stable_one_to_five_scale(self) -> None:
        self.assertEqual(deployment_accuracy(1, 0), 1.0)
        self.assertEqual(deployment_accuracy(5, 1), 5.0)
        self.assertEqual(deployment_accuracy(3, 0.5), 3.0)


if __name__ == "__main__":
    unittest.main()
