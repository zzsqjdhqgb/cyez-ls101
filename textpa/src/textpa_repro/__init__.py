"""Deployable TextPA-style pronunciation assessment pipeline."""

from .models import AlignmentSpan, Assessment, TextCues
from .scoring import paper_smith_waterman_similarity

__all__ = [
    "AlignmentSpan",
    "Assessment",
    "TextCues",
    "paper_smith_waterman_similarity",
]

__version__ = "0.1.0"

