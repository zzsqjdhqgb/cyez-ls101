from __future__ import annotations

import json

from .models import TextCues


PAPER_PROMPT = """
You are an expert evaluator of English pronunciation. Assess the accuracy and fluency of the given text input on a scale of 1 to 5, with higher scores indicating better performance. A score of 5 represents native-speaker-level proficiency.

Input format: 
{
  "Transcript": "<Recognized ASR sentence>",
  "Phonemes_CMU": "<Recognized CMU pronouncing phoneme sequence, with (time.s pause) indicating pauses in speech.>",
  "Phonemes_IPA": "<Recognized IPA pronouncing phoneme sequence.>",
  }


Task: Return a dictionary with the following format:
{
  "Accuracy": <the assessment accuracy score>, 
  "Fluency": <the assessment fluency score>,
  "Reasoning": <detailed reasoning for the assigned score>
}

Note: Do not include any other text other than the json object. 

Input: 
"""


def cue_payload(cues: TextCues) -> dict[str, str]:
    return {
        "Transcript": cues.transcript,
        "Phonemes_CMU": cues.phonemes_cmu,
        "Phonemes_IPA": cues.phonemes_ipa,
    }


def render_prompt(cues: TextCues, *, paper_compat: bool = True) -> str:
    payload = cue_payload(cues)
    if paper_compat:
        # The released code used Python's dict repr, including single quotes.
        return PAPER_PROMPT + str(payload)
    return PAPER_PROMPT + json.dumps(payload, ensure_ascii=False)

