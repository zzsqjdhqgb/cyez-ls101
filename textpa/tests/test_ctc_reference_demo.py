from pathlib import Path
import sys
import unittest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(SRC_DIR))

from run_ctc_pause_correction_demo import (  # noqa: E402
    create_contextual_phonemized_reference,
)
from textpa_repro.errors import DependencyError  # noqa: E402
from textpa_repro.phonemize import EspeakModelReferenceIpa  # noqa: E402


class ContextualReferenceTests(unittest.TestCase):
    def test_model_reference_keeps_phone_separator_across_words(self) -> None:
        try:
            phonemizer = EspeakModelReferenceIpa()
        except DependencyError as exc:
            self.skipTest(str(exc))
        phones = phonemizer("depends I").split()

        self.assertEqual(phones[-1], "aɪ")
        self.assertNotIn("zaɪ", phones)

    def test_contextual_weak_forms_keep_word_ownership(self) -> None:
        independent = {"a": "eɪ", "to": "t uː", "school": "s k uː l"}

        reference = create_contextual_phonemized_reference(
            "A to school",
            lambda word: independent[word.lower()],
            lambda _text: "ɐ t ə s k uː l",
        )

        self.assertEqual([word.text for word in reference.words], ["A", "to", "school"])
        self.assertEqual(reference.words[0].phones, ("ɐ",))
        self.assertEqual(reference.words[1].phones, ("t", "ə"))
        self.assertEqual(reference.words[2].phones, ("s", "k", "uː", "l"))
        self.assertEqual(reference.phones, ("ɐ", "t", "ə", "s", "k", "uː", "l"))

    def test_repeated_pronouns_cannot_leave_a_word_empty(self) -> None:
        independent = {"i": "aɪ", "mean": "m iː n", "agree": "ɐ ɡ ɹ iː"}

        reference = create_contextual_phonemized_reference(
            "I mean I agree",
            lambda word: independent[word.lower()],
            lambda _text: "aɪ m iː n aɪ ɐ ɡ ɹ iː",
        )

        self.assertEqual(
            [word.phones for word in reference.words],
            [("aɪ",), ("m", "iː", "n"), ("aɪ",), ("ɐ", "ɡ", "ɹ", "iː")],
        )

    def test_espeak_boundary_hint_owns_linking_phone(self) -> None:
        independent = {"computer": "k ə m p j uː ɾ ɚ", "i": "aɪ"}

        reference = create_contextual_phonemized_reference(
            "computer I",
            lambda word: independent[word.lower()],
            lambda _text: "k ə m p j uː ɾ ɚ ɹ aɪ",
            lambda _text: [("k", "ə", "m", "p", "j", "uː", "ɾ", "ɚ", "ɹ"), ("aɪ",)],
        )

        self.assertEqual(reference.words[0].phones[-1], "ɹ")
        self.assertEqual(reference.words[1].phones, ("aɪ",))

    def test_merged_espeak_group_can_be_split_between_written_words(self) -> None:
        independent = {"of": "ʌ v", "the": "ð ə"}

        reference = create_contextual_phonemized_reference(
            "of the",
            lambda word: independent[word.lower()],
            lambda _text: "ʌ v ð ə",
            lambda _text: [("ʌ", "v", "ð", "ə")],
        )

        self.assertEqual(reference.words[0].phones, ("ʌ", "v"))
        self.assertEqual(reference.words[1].phones, ("ð", "ə"))


if __name__ == "__main__":
    unittest.main()
