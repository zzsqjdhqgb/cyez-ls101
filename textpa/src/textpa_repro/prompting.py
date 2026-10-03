from __future__ import annotations

from dataclasses import dataclass
import json
import math
from typing import Any, Mapping, Sequence

from .errors import SchemaError
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


def _calibration_score(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaError(f"calibration {field} must be a number from 1 to 5")
    score = float(value)
    if not math.isfinite(score) or not 1.0 <= score <= 5.0:
        raise SchemaError(f"calibration {field} must be a finite number from 1 to 5")
    return score


@dataclass(frozen=True)
class CalibrationAnchor:
    cues: TextCues
    accuracy: float
    fluency: float

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "accuracy", _calibration_score(self.accuracy, "accuracy")
        )
        object.__setattr__(
            self, "fluency", _calibration_score(self.fluency, "fluency")
        )

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "CalibrationAnchor":
        scores = value.get("human_scores")
        if not isinstance(scores, Mapping):
            raise SchemaError("calibration anchor is missing human_scores")
        return cls(
            cues=TextCues.from_dict(value),
            accuracy=_calibration_score(scores.get("accuracy"), "accuracy"),
            fluency=_calibration_score(scores.get("fluency"), "fluency"),
        )

    def manifest_dict(self) -> dict[str, str | float]:
        return {
            "id": self.cues.utterance_id,
            "accuracy": self.accuracy,
            "fluency": self.fluency,
        }


def _serialize(value: Mapping[str, Any], *, paper_compat: bool) -> str:
    if paper_compat:
        return str(dict(value))
    return json.dumps(value, ensure_ascii=False)


def render_prompt(
    cues: TextCues,
    *,
    paper_compat: bool = True,
    calibration_anchors: Sequence[CalibrationAnchor] = (),
) -> str:
    payload = cue_payload(cues)
    if not calibration_anchors:
        # The released code used Python's dict repr, including single quotes.
        return PAPER_PROMPT + _serialize(payload, paper_compat=paper_compat)

    input_marker = "Input: \n"
    if not PAPER_PROMPT.endswith(input_marker):
        raise AssertionError("paper prompt input marker changed")
    parts = [
        PAPER_PROMPT.removesuffix(input_marker),
        "The following calibration examples have final scores averaged across "
        "five human evaluators. Use them as reference points for the same 1-to-5 "
        "Accuracy and Fluency scales.\n\n",
    ]
    for index, anchor in enumerate(calibration_anchors, start=1):
        scores = {"Accuracy": anchor.accuracy, "Fluency": anchor.fluency}
        parts.extend(
            [
                f"Calibration example {index} input:\n",
                _serialize(cue_payload(anchor.cues), paper_compat=paper_compat),
                f"\nCalibration example {index} final scores:\n",
                _serialize(scores, paper_compat=paper_compat),
                "\n\n",
            ]
        )
    parts.extend(
        [
            "Input to assess:\n",
            _serialize(payload, paper_compat=paper_compat),
        ]
    )
    return "".join(parts)
