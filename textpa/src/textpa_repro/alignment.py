from __future__ import annotations

from itertools import groupby
from typing import Iterable, Sequence

from .models import AlignmentSpan


def frame_labels_to_alignment(
    labels: Iterable[str], resolution_seconds: float = 0.01
) -> tuple[AlignmentSpan, ...]:
    """Convert frame labels to Charsiu-compatible phone intervals."""
    cursor = 0
    spans: list[AlignmentSpan] = []
    for phone, grouped in groupby(labels):
        length = sum(1 for _ in grouped)
        start = round(cursor * resolution_seconds, 2)
        end = round((cursor + length) * resolution_seconds, 2)
        spans.append(AlignmentSpan(start=start, end=end, phone=phone))
        cursor += length
    return tuple(spans)


def format_cmu_with_pauses(alignment: Sequence[AlignmentSpan]) -> str:
    """Match the paper's CMU sequence format, including internal silence lengths."""
    start = 0
    end = len(alignment)
    while start < end and alignment[start].phone == "[SIL]":
        start += 1
    while end > start and alignment[end - 1].phone == "[SIL]":
        end -= 1

    tokens: list[str] = []
    for span in alignment[start:end]:
        if span.phone == "[UNK]":
            tokens.append("?")
        elif span.phone == "[SIL]":
            tokens.append(f"({span.duration:.2f}s pause)")
        else:
            tokens.append(span.phone)
    return " ".join(tokens)

