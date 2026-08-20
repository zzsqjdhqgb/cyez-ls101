#!/usr/bin/env python3
"""Compare CMU-derived and eSpeak-derived references on identical CTC logits."""
from __future__ import annotations

import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path
import statistics
import sys
from typing import Any, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
TEXTPA_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = TEXTPA_ROOT.parent
TEXTPA_SRC = TEXTPA_ROOT / "src"
for import_path in (SCRIPT_DIR, TEXTPA_SRC):
    path_text = os.fspath(import_path)
    if path_text not in sys.path:
        sys.path.insert(0, path_text)

from run_ctc_pause_correction_demo import (  # noqa: E402
    DEFAULT_DICTIONARY,
    DEFAULT_MODEL_DIR,
    HIGH_CONFIDENCE_MIN,
    HIGH_CONFIDENCE_SCORE,
    PronunciationReference,
    SAMPLE_RATE,
    assess_ctc_pronunciation,
    create_contextual_phonemized_reference,
    create_onnx_session,
    decode_audio,
    infer_logits,
    load_cmu_dictionary,
    pronunciation_candidates,
    sha256_file,
    utc_now,
    write_json,
    write_text,
)
from textpa_repro.phonemize import (  # noqa: E402
    EspeakCanonicalIpa,
    EspeakModelReferenceIpa,
)


DEFAULT_INPUT_RUN = (
    TEXTPA_ROOT
    / "benchmark-data/ctc-pause-correction-demo/run-seed-20260820"
)
DEFAULT_OUTPUT = (
    TEXTPA_ROOT
    / "benchmark-data/ctc-espeak-reference-ab/run-seed-20260820"
)
TEACHER_NEGATIVE_TEXT = (
    "The rapid development of artificial intelligence has raised important "
    "questions about the future of employment and the skills that young people "
    "need to acquire."
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def repository_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(WORKSPACE_ROOT.resolve()).as_posix()
    except ValueError:
        return os.fspath(resolved)


def version_details(language: str) -> dict[str, Any]:
    from phonemizer.backend import EspeakBackend

    return {
        "language": language,
        "phonemizer": version("phonemizer"),
        "espeak_ng": ".".join(str(item) for item in EspeakBackend.version()),
        "generation": (
            "whole utterance with the upstream model tokenizer settings; word ownership "
            "recovered from eSpeak delimiter hints plus ordered edit alignment"
        ),
        "upstream_tokenizer_revision": "ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4",
    }


def all_candidate_counts(ctc: dict[str, Any]) -> dict[str, int]:
    raw = 0
    eligible = 0
    high = 0
    tentative = 0
    for word in ctc["words"]:
        for phone in word["phones"]:
            if "observed" not in phone:
                continue
            raw += 1
            is_high = (
                phone["score"] < HIGH_CONFIDENCE_SCORE
                and phone["confidence"] >= HIGH_CONFIDENCE_MIN
            )
            if not is_high and phone["confidence"] < 0.15:
                continue
            eligible += 1
            if is_high:
                high += 1
            else:
                tentative += 1
    return {
        "raw_conflicts": raw,
        "eligible_candidates": eligible,
        "high_candidates": high,
        "tentative_candidates": tentative,
    }


def candidate_word_map(candidates: dict[str, Any]) -> dict[int, str]:
    return {
        int(item["word_index"]): str(item["word"])
        for item in candidates["candidates"]
    }


def reference_result(ctc: dict[str, Any]) -> dict[str, Any]:
    candidates = pronunciation_candidates(ctc)
    return {
        "reference_phone_count": sum(
            len(word["expected_phones"]) for word in ctc["words"]
        ),
        "overall_score": ctc["overall_score"],
        "alignment_path_score": ctc["alignment_path_score"],
        "candidate_counts": all_candidate_counts(ctc),
        "pronunciation_candidates": candidates,
        "ctc": ctc,
    }


def compare_results(
    cmu: dict[str, Any], espeak: dict[str, Any]
) -> dict[str, Any]:
    cmu_candidates = cmu["pronunciation_candidates"]
    espeak_candidates = espeak["pronunciation_candidates"]
    cmu_words = candidate_word_map(cmu_candidates)
    espeak_words = candidate_word_map(espeak_candidates)
    cmu_indexes = set(cmu_words)
    espeak_indexes = set(espeak_words)

    word_score_changes: list[dict[str, Any]] = []
    for cmu_word, espeak_word in zip(cmu["ctc"]["words"], espeak["ctc"]["words"]):
        if (
            cmu_word["word_index"] != espeak_word["word_index"]
            or cmu_word["text"] != espeak_word["text"]
        ):
            raise ValueError("CMU and eSpeak word sequences differ")
        delta = int(espeak_word["score"]) - int(cmu_word["score"])
        word_score_changes.append(
            {
                "word_index": cmu_word["word_index"],
                "word": cmu_word["text"],
                "cmu_score": cmu_word["score"],
                "espeak_score": espeak_word["score"],
                "delta": delta,
                "cmu_expected_phones": cmu_word["expected_phones"],
                "espeak_expected_phones": espeak_word["expected_phones"],
            }
        )
    word_score_changes.sort(key=lambda item: (-abs(item["delta"]), item["word_index"]))

    return {
        "overall_score_delta_espeak_minus_cmu": (
            espeak["overall_score"] - cmu["overall_score"]
        ),
        "alignment_path_score_delta_espeak_minus_cmu": round(
            espeak["alignment_path_score"] - cmu["alignment_path_score"], 6
        ),
        "top_candidate_words": {
            "cmu_only": [cmu_words[index] for index in sorted(cmu_indexes - espeak_indexes)],
            "espeak_only": [
                espeak_words[index] for index in sorted(espeak_indexes - cmu_indexes)
            ],
            "shared": [cmu_words[index] for index in sorted(cmu_indexes & espeak_indexes)],
        },
        "largest_absolute_word_score_changes": word_score_changes[:12],
    }


def candidate_markdown(candidates: dict[str, Any]) -> str:
    rows: list[str] = []
    for item in candidates["candidates"]:
        rows.append(
            f"`{item['word']}` {item['expected_phone']}→{item['observed_phone']} "
            f"({item['match_score']}, {item['strength']})"
        )
    return "; ".join(rows) if rows else "none"


def build_report(results: Sequence[dict[str, Any]], output_dir: Path) -> str:
    cmu_scores = [item["references"]["cmudict"]["overall_score"] for item in results]
    espeak_scores = [item["references"]["espeak"]["overall_score"] for item in results]
    cmu_high = sum(
        item["references"]["cmudict"]["candidate_counts"]["high_candidates"]
        for item in results
    )
    espeak_high = sum(
        item["references"]["espeak"]["candidate_counts"]["high_candidates"]
        for item in results
    )
    lines = [
        "# CMU vs eSpeak CTC reference A/B",
        "",
        "同一音频只运行一次 ONNX 推理，再用 CMUdict IPA 和 eSpeak `en-us` IPA 分别做",
        "CTC 强制对齐。本实验不调用 LLM；分数和候选数仅用于比较参考体系，不代表人工真值。",
        "",
        "## Aggregate",
        "",
        f"- CMU overall mean: `{statistics.fmean(cmu_scores):.2f}`",
        f"- eSpeak overall mean: `{statistics.fmean(espeak_scores):.2f}`",
        f"- CMU high candidates: `{cmu_high}`",
        f"- eSpeak high candidates: `{espeak_high}`",
        "",
        "| Sample | CMU score | eSpeak score | Delta | CMU high | eSpeak high |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for index, item in enumerate(results, 1):
        cmu = item["references"]["cmudict"]
        espeak = item["references"]["espeak"]
        lines.append(
            f"| {index} | {cmu['overall_score']} | {espeak['overall_score']} | "
            f"{item['comparison']['overall_score_delta_espeak_minus_cmu']:+d} | "
            f"{cmu['candidate_counts']['high_candidates']} | "
            f"{espeak['candidate_counts']['high_candidates']} |"
        )

    for index, item in enumerate(results, 1):
        sample_id = item["id"]
        cmu = item["references"]["cmudict"]
        espeak = item["references"]["espeak"]
        audio_path = WORKSPACE_ROOT / item["audio_path"]
        try:
            audio_link = os.path.relpath(audio_path, output_dir)
        except ValueError:
            audio_link = os.fspath(audio_path)
        changes = item["comparison"]["top_candidate_words"]
        lines.extend(
            [
                "",
                f"## Sample {index}",
                "",
                f"- ID: `{sample_id}`",
                f"- Audio: [WAV]({Path(audio_link).as_posix()})",
                f"- CMU reference phones: `{cmu['reference_phone_count']}`",
                f"- eSpeak reference phones: `{espeak['reference_phone_count']}`",
                f"- Top-candidate words removed by eSpeak: "
                f"`{', '.join(changes['cmu_only']) or 'none'}`",
                f"- Top-candidate words introduced by eSpeak: "
                f"`{', '.join(changes['espeak_only']) or 'none'}`",
                "",
                "**CMU top candidates**",
                "",
                candidate_markdown(cmu["pronunciation_candidates"]),
                "",
                "**eSpeak top candidates**",
                "",
                candidate_markdown(espeak["pronunciation_candidates"]),
                "",
                f"Full comparison: [JSON](samples/{sample_id}.json)",
            ]
        )
    lines.extend(
        [
            "",
            "## Known gap",
            "",
            "The teacher-read negative regression described in `SIDE_CONVERSATION_HANDOFF.md`",
            "has no corresponding audio file in the workspace, so it is not included in this run.",
            "The reference sentence itself was phonemized successfully and all resulting eSpeak",
            "tokens exist in the model vocabulary. See",
            "[`teacher-negative-reference-check.json`](teacher-negative-reference-check.json).",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-run", type=Path, default=DEFAULT_INPUT_RUN)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--dictionary", type=Path, default=DEFAULT_DICTIONARY)
    parser.add_argument("--language", default="en-us")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_run = args.input_run.resolve()
    output_dir = args.output_dir.resolve()
    samples_dir = output_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    evidence_path = input_run / "evidence-summary.json"
    evidence_records = read_json(evidence_path)
    if not isinstance(evidence_records, list) or not evidence_records:
        raise ValueError("input evidence summary must be a non-empty JSON array")

    dictionary = load_cmu_dictionary(args.dictionary)
    vocabulary_path = args.model_dir / "vocab.json"
    vocabulary = {
        str(key): int(value)
        for key, value in read_json(vocabulary_path).items()
    }
    model_path = args.model_dir / "onnx/model_quantized.onnx"
    word_phonemizer = EspeakCanonicalIpa(args.language)
    utterance_phonemizer = EspeakModelReferenceIpa(args.language)
    session = create_onnx_session(model_path)

    teacher_tokens = utterance_phonemizer(TEACHER_NEGATIVE_TEXT).split()
    teacher_missing_tokens = sorted(set(teacher_tokens) - set(vocabulary))
    teacher_check_path = output_dir / "teacher-negative-reference-check.json"
    write_json(
        teacher_check_path,
        {
            "schema_version": 1,
            "status": "reference_only_audio_not_available",
            "transcript": TEACHER_NEGATIVE_TEXT,
            "phonemizer": version_details(args.language),
            "phones": teacher_tokens,
            "phone_count": len(teacher_tokens),
            "missing_vocabulary_tokens": teacher_missing_tokens,
            "ready_for_ctc_when_audio_is_supplied": not teacher_missing_tokens,
        },
    )

    results: list[dict[str, Any]] = []
    for index, baseline in enumerate(evidence_records, 1):
        sample_id = str(baseline["id"])
        print(f"[{index}/{len(evidence_records)}] {sample_id}", flush=True)
        audio_path = (input_run / str(baseline["audio_path"])).resolve()
        if sha256_file(audio_path) != baseline["audio_sha256"]:
            raise ValueError(f"audio hash differs from baseline evidence: {sample_id}")
        samples = decode_audio(audio_path)
        logits = infer_logits(session, samples)
        duration_ms = samples.size / SAMPLE_RATE * 1000
        transcript = str(baseline["transcript"])

        cmu_ctc = assess_ctc_pronunciation(
            logits,
            vocabulary,
            transcript,
            duration_ms,
            dictionary,
        )
        if cmu_ctc != baseline["ctc"]:
            raise ValueError(f"CMU baseline drifted before eSpeak comparison: {sample_id}")

        espeak_reference: PronunciationReference = create_contextual_phonemized_reference(
            transcript,
            word_phonemizer,
            utterance_phonemizer,
            utterance_phonemizer.word_groups,
        )
        missing_tokens = sorted(set(espeak_reference.phones) - set(vocabulary))
        if missing_tokens:
            raise ValueError(
                f"eSpeak produced tokens outside the model vocabulary for {sample_id}: "
                f"{missing_tokens}"
            )
        espeak_ctc = assess_ctc_pronunciation(
            logits,
            vocabulary,
            transcript,
            duration_ms,
            dictionary,
            candidate_references=[espeak_reference],
            reference_source=(
                f"published Whisper ASR hypothesis phonemized by eSpeak {args.language}"
            ),
        )
        if cmu_ctc["recognized_phones"] != espeak_ctc["recognized_phones"]:
            raise ValueError("reference comparison did not reuse identical logits")

        cmu = reference_result(cmu_ctc)
        espeak = reference_result(espeak_ctc)
        result = {
            "schema_version": 1,
            "id": sample_id,
            "audio_path": repository_path(audio_path),
            "audio_sha256": baseline["audio_sha256"],
            "transcript": transcript,
            "transcript_source": baseline["transcript_source"],
            "references": {"cmudict": cmu, "espeak": espeak},
            "comparison": compare_results(cmu, espeak),
        }
        results.append(result)
        write_json(samples_dir / f"{sample_id}.json", result)

    write_json(output_dir / "results.json", results)
    write_text(output_dir / "report.md", build_report(results, output_dir))
    write_json(
        output_dir / "manifest.json",
        {
            "schema_version": 1,
            "completed_at": utc_now(),
            "experiment": "same-logits CMUdict vs eSpeak CTC forced-alignment reference",
            "input_evidence": {
                "path": repository_path(evidence_path),
                "sha256": sha256_file(evidence_path),
            },
            "model": {
                "path": repository_path(model_path),
                "sha256": sha256_file(model_path),
            },
            "vocabulary": {
                "path": repository_path(vocabulary_path),
                "sha256": sha256_file(vocabulary_path),
            },
            "dictionary": {
                "path": repository_path(args.dictionary),
                "sha256": sha256_file(args.dictionary),
            },
            "phonemizer": version_details(args.language),
            "teacher_negative_reference_check": {
                "path": repository_path(teacher_check_path),
                "sha256": sha256_file(teacher_check_path),
            },
            "scripts": {
                "comparison": {
                    "path": repository_path(Path(__file__)),
                    "sha256": sha256_file(Path(__file__)),
                },
                "ctc_demo": {
                    "path": repository_path(SCRIPT_DIR / "run_ctc_pause_correction_demo.py"),
                    "sha256": sha256_file(
                        SCRIPT_DIR / "run_ctc_pause_correction_demo.py"
                    ),
                },
                "phonemizer": {
                    "path": repository_path(
                        TEXTPA_SRC / "textpa_repro/phonemize.py"
                    ),
                    "sha256": sha256_file(
                        TEXTPA_SRC / "textpa_repro/phonemize.py"
                    ),
                },
            },
            "result_count": len(results),
            "llm_requests": 0,
        },
    )
    print(f"comparison complete: {output_dir / 'report.md'}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
