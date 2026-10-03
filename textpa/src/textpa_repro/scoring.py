from __future__ import annotations

import math
from typing import Iterable, Sequence, TypeVar

from .errors import CalibrationError


T = TypeVar("T")


def _paper_smith_waterman_score(first: Sequence[T], second: Sequence[T]) -> float:
    """Reproduce textdistance's default Smith-Waterman implementation.

    Matching items score 1, mismatches score 0, and gaps cost 1. The released
    TextPA code used textdistance's terminal DP cell rather than a traceback.
    """
    if first == second:
        return float(min(len(first), len(second)))
    if not first or not second:
        return 0.0

    previous = [0.0] * (len(second) + 1)
    for left in first:
        current = [0.0]
        for index, right in enumerate(second, start=1):
            match = previous[index - 1] + (1.0 if left == right else 0.0)
            delete = previous[index] - 1.0
            insert = current[index - 1] - 1.0
            current.append(max(0.0, match, delete, insert))
        previous = current
    return previous[-1]


def paper_smith_waterman_similarity(recognized_ipa: str, canonical_ipa: str) -> float:
    """Return the exact character-level similarity used by the author code."""
    maximum = min(len(recognized_ipa), len(canonical_ipa))
    if maximum == 0:
        # This matches textdistance 4.x, including its surprising empty case.
        return 1.0
    return _paper_smith_waterman_score(recognized_ipa, canonical_ipa) / maximum


def phone_smith_waterman_similarity(recognized_ipa: str, canonical_ipa: str) -> float:
    """A deployment-oriented variant that aligns whitespace-delimited phones."""
    recognized = tuple(recognized_ipa.split())
    canonical = tuple(canonical_ipa.split())
    maximum = min(len(recognized), len(canonical))
    if maximum == 0:
        return 1.0 if recognized == canonical else 0.0
    return _paper_smith_waterman_score(recognized, canonical) / maximum


def minmax(values: Iterable[float]) -> list[float]:
    data = [float(value) for value in values]
    if not data:
        raise CalibrationError("cannot min-max normalize an empty cohort")
    if not all(math.isfinite(value) for value in data):
        raise CalibrationError("calibration values must be finite")
    minimum = min(data)
    maximum = max(data)
    if maximum == minimum:
        raise CalibrationError("cohort min-max is undefined when all values are equal")
    scale = maximum - minimum
    return [(value - minimum) / scale for value in data]


def paper_cohort_fusion(
    llm_accuracy: Sequence[float], ipa_similarity: Sequence[float]
) -> tuple[list[float], list[float], list[float]]:
    """Apply the paper's test-set calibration and equal-weight fusion."""
    if len(llm_accuracy) != len(ipa_similarity):
        raise CalibrationError("LLM and IPA score cohorts must have equal length")
    llm_normalized = minmax(llm_accuracy)
    ipa_normalized = minmax(ipa_similarity)
    fused = [
        (llm_value + ipa_value) / 2.0
        for llm_value, ipa_value in zip(llm_normalized, ipa_normalized)
    ]
    return llm_normalized, ipa_normalized, fused


def deployment_accuracy(llm_accuracy: float, ipa_similarity: float) -> float:
    """Fuse one utterance on a stable 1-5 scale for online serving.

    This is intentionally distinct from the paper's cohort-dependent score.
    """
    if not 1.0 <= llm_accuracy <= 5.0:
        raise ValueError("llm_accuracy must be from 1 to 5")
    if not 0.0 <= ipa_similarity <= 1.0:
        raise ValueError("ipa_similarity must be from 0 to 1")
    normalized = (((llm_accuracy - 1.0) / 4.0) + ipa_similarity) / 2.0
    return 1.0 + 4.0 * normalized
