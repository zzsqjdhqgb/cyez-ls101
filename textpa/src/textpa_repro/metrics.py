from __future__ import annotations

import csv
from collections import defaultdict
import math
from pathlib import Path
import re
from typing import Any, Iterable, Mapping

from .errors import SchemaError


SCORE_PREFIX = re.compile(r"^\s*([1-5])(?:\D|$)")


def pearson(first: Iterable[float], second: Iterable[float]) -> float:
    left = [float(value) for value in first]
    right = [float(value) for value in second]
    if len(left) != len(right):
        raise ValueError("Pearson inputs must have equal length")
    if len(left) < 2:
        raise ValueError("Pearson correlation requires at least two pairs")
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right)
    )
    left_scale = math.sqrt(sum((value - left_mean) ** 2 for value in left))
    right_scale = math.sqrt(sum((value - right_mean) ** 2 for value in right))
    if left_scale == 0 or right_scale == 0:
        raise ValueError("Pearson correlation is undefined for a constant series")
    return numerator / (left_scale * right_scale)


def _annotation_score(value: str, field: str, row_number: int) -> float:
    match = SCORE_PREFIX.match(value)
    if not match:
        raise SchemaError(f"annotation row {row_number}: invalid {field} score")
    return float(match.group(1))


def load_multipa_annotations(path: str | Path) -> dict[str, dict[str, float]]:
    grouped: dict[str, dict[str, list[float]]] = defaultdict(
        lambda: {"accuracy": [], "fluency": []}
    )
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"audio", "accuracy", "fluency"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise SchemaError("MultiPA annotations must contain audio/accuracy/fluency")
        for row_number, row in enumerate(reader, start=2):
            audio = row.get("audio", "").strip()
            if not audio:
                raise SchemaError(f"annotation row {row_number}: missing audio")
            grouped[audio]["accuracy"].append(
                _annotation_score(row.get("accuracy", ""), "accuracy", row_number)
            )
            grouped[audio]["fluency"].append(
                _annotation_score(row.get("fluency", ""), "fluency", row_number)
            )

    result: dict[str, dict[str, float]] = {}
    for audio, scores in grouped.items():
        result[audio] = {
            name: sum(values) / len(values) for name, values in scores.items()
        }
    return result


def dotted_value(record: Mapping[str, Any], path: str) -> float:
    value: Any = record
    for component in path.split("."):
        if not isinstance(value, Mapping) or component not in value:
            raise SchemaError(f"prediction is missing '{path}'")
        value = value[component]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaError(f"prediction field '{path}' must be numeric")
    return float(value)


def evaluate_multipa(
    records: Iterable[Mapping[str, Any]],
    annotation_path: str | Path,
    *,
    accuracy_field: str = "assessment.accuracy",
    fluency_field: str = "assessment.fluency",
    allow_subset: bool = False,
) -> dict[str, float | int]:
    annotations = load_multipa_annotations(annotation_path)
    predictions: dict[str, Mapping[str, Any]] = {}
    for record in records:
        utterance_id = record.get("id")
        if not isinstance(utterance_id, str):
            raise SchemaError("prediction record is missing a string id")
        if utterance_id in predictions:
            raise SchemaError(f"duplicate prediction id '{utterance_id}'")
        predictions[utterance_id] = record

    annotation_ids = set(annotations)
    prediction_ids = set(predictions)
    missing = sorted(annotation_ids - prediction_ids)
    extra = sorted(prediction_ids - annotation_ids)
    if not allow_subset and (missing or extra):
        raise SchemaError(
            "predictions do not exactly cover MultiPA annotations "
            f"(missing={len(missing)}, extra={len(extra)}); "
            "use allow_subset=True only for an intentional subset"
        )

    shared = sorted(annotation_ids & prediction_ids)
    if len(shared) < 2:
        raise SchemaError("fewer than two predictions match MultiPA annotations")
    human_accuracy = [annotations[item]["accuracy"] for item in shared]
    human_fluency = [annotations[item]["fluency"] for item in shared]
    predicted_accuracy = [
        dotted_value(predictions[item], accuracy_field) for item in shared
    ]
    predicted_fluency = [
        dotted_value(predictions[item], fluency_field) for item in shared
    ]
    return {
        "n": len(shared),
        "accuracy_pcc": pearson(predicted_accuracy, human_accuracy),
        "fluency_pcc": pearson(predicted_fluency, human_fluency),
    }
