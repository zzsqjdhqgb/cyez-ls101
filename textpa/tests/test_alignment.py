import unittest

from textpa_repro.alignment import format_cmu_with_pauses, frame_labels_to_alignment
from textpa_repro.models import AlignmentSpan


class AlignmentTests(unittest.TestCase):
    def test_frame_labels_are_merged_at_ten_milliseconds(self) -> None:
        spans = frame_labels_to_alignment(["[SIL]", "AA", "AA", "T"], 0.01)
        self.assertEqual(
            spans,
            (
                AlignmentSpan(0.0, 0.01, "[SIL]"),
                AlignmentSpan(0.01, 0.03, "AA"),
                AlignmentSpan(0.03, 0.04, "T"),
            ),
        )

    def test_cmu_format_trims_edge_silence_and_keeps_internal_pause(self) -> None:
        spans = (
            AlignmentSpan(0.0, 0.1, "[SIL]"),
            AlignmentSpan(0.1, 0.2, "D"),
            AlignmentSpan(0.2, 0.32, "[SIL]"),
            AlignmentSpan(0.32, 0.4, "[UNK]"),
            AlignmentSpan(0.4, 0.5, "G"),
            AlignmentSpan(0.5, 0.7, "[SIL]"),
        )
        self.assertEqual(format_cmu_with_pauses(spans), "D (0.12s pause) ? G")


if __name__ == "__main__":
    unittest.main()

