import csv
from pathlib import Path
import tempfile
import unittest

from textpa_repro.errors import SchemaError
from textpa_repro.metrics import evaluate_multipa, pearson


class MetricsTests(unittest.TestCase):
    def _write_annotations(self, directory: str) -> Path:
        path = Path(directory) / "annotations.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle, fieldnames=["audio", "accuracy", "fluency"]
            )
            writer.writeheader()
            writer.writerows(
                [
                    {"audio": "a.wav", "accuracy": "1 (low)", "fluency": "2"},
                    {"audio": "a.wav", "accuracy": "3 (mid)", "fluency": "4"},
                    {"audio": "b.wav", "accuracy": "4", "fluency": "5"},
                    {"audio": "b.wav", "accuracy": "2", "fluency": "3"},
                    {"audio": "c.wav", "accuracy": "4", "fluency": "5"},
                ]
            )
        return path

    @staticmethod
    def _predictions() -> list[dict[str, object]]:
        return [
            {"id": "a.wav", "assessment": {"accuracy": 2, "fluency": 3}},
            {"id": "b.wav", "assessment": {"accuracy": 3, "fluency": 4}},
            {"id": "c.wav", "assessment": {"accuracy": 4, "fluency": 5}},
        ]

    def test_pearson_perfect_relationship(self) -> None:
        self.assertAlmostEqual(pearson([1, 2, 3], [2, 4, 6]), 1.0)

    def test_multipa_annotations_are_averaged_by_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_annotations(directory)
            result = evaluate_multipa(self._predictions(), path)
            self.assertEqual(result["n"], 3)
            self.assertAlmostEqual(result["accuracy_pcc"], 1.0)
            self.assertAlmostEqual(result["fluency_pcc"], 1.0)

    def test_duplicate_prediction_id_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_annotations(directory)
            records = self._predictions()
            records.append(
                {"id": "a.wav", "assessment": {"accuracy": 5, "fluency": 5}}
            )

            with self.assertRaises(SchemaError):
                evaluate_multipa(records, path)

    def test_missing_predictions_are_rejected_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_annotations(directory)

            with self.assertRaises(SchemaError):
                evaluate_multipa(self._predictions()[:2], path)

    def test_allow_subset_evaluates_matching_predictions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self._write_annotations(directory)
            result = evaluate_multipa(
                self._predictions()[:2], path, allow_subset=True
            )

            self.assertEqual(result["n"], 2)
            self.assertAlmostEqual(result["accuracy_pcc"], 1.0)
            self.assertAlmostEqual(result["fluency_pcc"], 1.0)


if __name__ == "__main__":
    unittest.main()
