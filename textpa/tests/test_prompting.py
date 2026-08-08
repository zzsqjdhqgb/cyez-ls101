import unittest

from textpa_repro.models import TextCues
from textpa_repro.prompting import PAPER_PROMPT, render_prompt


class PromptingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cues = TextCues(
            utterance_id="sample.wav",
            transcript="Maybe we should get some cards.",
            phonemes_cmu="M EY B IY (0.12s pause) W IY",
            phonemes_ipa="m E m b i w i",
        )

    def test_paper_prompt_uses_python_dict_representation(self) -> None:
        rendered = render_prompt(self.cues)
        self.assertTrue(rendered.startswith(PAPER_PROMPT))
        self.assertTrue(
            rendered.endswith(
                "{'Transcript': 'Maybe we should get some cards.', "
                "'Phonemes_CMU': 'M EY B IY (0.12s pause) W IY', "
                "'Phonemes_IPA': 'm E m b i w i'}"
            )
        )

    def test_json_input_preserves_ipa(self) -> None:
        rendered = render_prompt(self.cues, paper_compat=False)
        self.assertIn('"Phonemes_IPA": "m E m b i w i"', rendered)


if __name__ == "__main__":
    unittest.main()

