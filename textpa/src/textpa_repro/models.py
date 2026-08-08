from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Mapping, Sequence

from .errors import SchemaError


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SchemaError(f"{field} must be a non-empty string")
    return value


def _score(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaError(f"{field} must be a number from 1 to 5")
    result = float(value)
    if not math.isfinite(result) or not 1.0 <= result <= 5.0:
        raise SchemaError(f"{field} must be a finite number from 1 to 5")
    return result


@dataclass(frozen=True)
class AlignmentSpan:
    start: float
    end: float
    phone: str

    def __post_init__(self) -> None:
        if not math.isfinite(self.start) or not math.isfinite(self.end):
            raise SchemaError("alignment times must be finite")
        if self.start < 0 or self.end < self.start:
            raise SchemaError("alignment must satisfy 0 <= start <= end")
        _nonempty_string(self.phone, "alignment phone")

    @property
    def duration(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict[str, Any]:
        return {"start": self.start, "end": self.end, "phone": self.phone}

    @classmethod
    def from_value(cls, value: Any) -> "AlignmentSpan":
        if isinstance(value, Mapping):
            try:
                return cls(float(value["start"]), float(value["end"]), str(value["phone"]))
            except (KeyError, TypeError, ValueError) as exc:
                raise SchemaError("invalid alignment object") from exc
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            if len(value) != 3:
                raise SchemaError("alignment arrays must contain start, end, phone")
            try:
                return cls(float(value[0]), float(value[1]), str(value[2]))
            except (TypeError, ValueError) as exc:
                raise SchemaError("invalid alignment array") from exc
        raise SchemaError("alignment must be an object or a three-item array")


@dataclass(frozen=True)
class TextCues:
    utterance_id: str
    transcript: str
    phonemes_cmu: str
    phonemes_ipa: str
    audio_path: str | None = None
    alignment: tuple[AlignmentSpan, ...] = ()

    def __post_init__(self) -> None:
        _nonempty_string(self.utterance_id, "id")
        _nonempty_string(self.transcript, "transcript")
        _nonempty_string(self.phonemes_cmu, "phonemes_cmu")
        _nonempty_string(self.phonemes_ipa, "phonemes_ipa")
        if self.audio_path is not None and not isinstance(self.audio_path, str):
            raise SchemaError("audio_path must be a string or null")

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema_version": 1,
            "id": self.utterance_id,
            "transcript": self.transcript,
            "phonemes_cmu": self.phonemes_cmu,
            "phonemes_ipa": self.phonemes_ipa,
        }
        if self.audio_path is not None:
            result["audio_path"] = self.audio_path
        if self.alignment:
            result["alignment"] = [span.to_dict() for span in self.alignment]
        return result

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "TextCues":
        alignment = tuple(
            AlignmentSpan.from_value(item) for item in value.get("alignment", ())
        )
        return cls(
            utterance_id=_nonempty_string(value.get("id"), "id"),
            transcript=_nonempty_string(value.get("transcript"), "transcript"),
            phonemes_cmu=_nonempty_string(value.get("phonemes_cmu"), "phonemes_cmu"),
            phonemes_ipa=_nonempty_string(value.get("phonemes_ipa"), "phonemes_ipa"),
            audio_path=value.get("audio_path"),
            alignment=alignment,
        )


@dataclass(frozen=True)
class Assessment:
    accuracy: float
    fluency: float
    reasoning: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "accuracy", _score(self.accuracy, "accuracy"))
        object.__setattr__(self, "fluency", _score(self.fluency, "fluency"))
        _nonempty_string(self.reasoning, "reasoning")

    def to_dict(self) -> dict[str, Any]:
        return {
            "accuracy": self.accuracy,
            "fluency": self.fluency,
            "reasoning": self.reasoning,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Assessment":
        lowered = {str(key).lower(): item for key, item in value.items()}
        return cls(
            accuracy=_score(lowered.get("accuracy"), "accuracy"),
            fluency=_score(lowered.get("fluency"), "fluency"),
            reasoning=_nonempty_string(lowered.get("reasoning"), "reasoning"),
        )

