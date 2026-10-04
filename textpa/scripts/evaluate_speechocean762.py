#!/usr/bin/env python3
"""Evaluate sentence-level SpeechOcean762 predictions against human scores."""
from __future__ import annotations

import argparse
import collections
import json
import math
from pathlib import Path
from typing import Any, Mapping


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            records.append(value)
    return records


def index_by_id(records: list[dict[str, Any]], source: Path) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for line_number, record in enumerate(records, 1):
        utterance_id = record.get("id")
        if not isinstance(utterance_id, str) or not utterance_id:
            raise ValueError(f"{source}:{line_number}: missing non-empty id")
        if utterance_id in indexed:
            raise ValueError(f"{source}:{line_number}: duplicate id {utterance_id!r}")
        indexed[utterance_id] = record
    return indexed


def dotted_number(record: Mapping[str, Any], path: str) -> float:
    value: Any = record
    for component in path.split("."):
        if not isinstance(value, Mapping) or component not in value:
            raise ValueError(f"prediction is missing {path!r}")
        value = value[component]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"prediction field {path!r} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"prediction field {path!r} must be finite")
    return result


def pearson(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or len(left) < 2:
        raise ValueError("Pearson correlation needs at least two equal-length inputs")
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum(
        (x - left_mean) * (y - right_mean) for x, y in zip(left, right)
    )
    denominator = math.sqrt(
        sum((x - left_mean) ** 2 for x in left)
        * sum((y - right_mean) ** 2 for y in right)
    )
    if denominator == 0:
        raise ValueError("Pearson correlation is undefined for a constant series")
    return numerator / denominator


def distribution(values: list[float]) -> dict[str, int]:
    return {
        str(value): count
        for value, count in sorted(collections.Counter(values).items())
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("predictions", type=Path)
    parser.add_argument("--annotations", type=Path, required=True)
    parser.add_argument("--accuracy-field", default="assessment.accuracy")
    parser.add_argument("--fluency-field", default="assessment.fluency")
    parser.add_argument("--allow-subset", action="store_true")
    args = parser.parse_args()

    predictions = index_by_id(read_jsonl(args.predictions), args.predictions)
    annotations = index_by_id(read_jsonl(args.annotations), args.annotations)
    prediction_ids = set(predictions)
    annotation_ids = set(annotations)
    missing = sorted(annotation_ids - prediction_ids)
    extra = sorted(prediction_ids - annotation_ids)
    if not args.allow_subset and (missing or extra):
        raise ValueError(
            "predictions do not exactly cover annotations "
            f"(missing={len(missing)}, extra={len(extra)})"
        )
    shared = sorted(prediction_ids & annotation_ids)
    if len(shared) < 2:
        raise ValueError("fewer than two prediction IDs match annotations")

    predicted_accuracy = [
        dotted_number(predictions[item], args.accuracy_field) for item in shared
    ]
    predicted_fluency = [
        dotted_number(predictions[item], args.fluency_field) for item in shared
    ]
    human_accuracy = [
        dotted_number(annotations[item], "human_scores.accuracy_0_10")
        for item in shared
    ]
    human_fluency = [
        dotted_number(annotations[item], "human_scores.fluency_0_10")
        for item in shared
    ]
    result = {
        "n": len(shared),
        "missing": len(missing),
        "extra": len(extra),
        "accuracy_field": args.accuracy_field,
        "fluency_field": args.fluency_field,
        "accuracy_pcc": pearson(predicted_accuracy, human_accuracy),
        "fluency_pcc": pearson(predicted_fluency, human_fluency),
        "prediction_distribution": {
            "accuracy": distribution(predicted_accuracy),
            "fluency": distribution(predicted_fluency),
        },
        "human_distribution": {
            "accuracy": distribution(human_accuracy),
            "fluency": distribution(human_fluency),
        },
    }
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
