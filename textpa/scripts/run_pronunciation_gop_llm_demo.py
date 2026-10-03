#!/usr/bin/env python3
"""Ask an LLM to organize low-GOP phone evidence by target word.

This is a post-processing step.  It does not recompute GOP, alter alignment,
or decide which rows are "true" errors in code.  Every word with at least one
selected row is sent with a small ASR context window, complete reference and
alignment-conditioned acoustic-winner phone sequences, and detailed GOP rows.
Every selected row must be accounted for exactly once in the returned JSON as
either feedback or a withheld difference.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
from typing import Any, Mapping, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
TEXTPA_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = TEXTPA_ROOT.parent
if os.fspath(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, os.fspath(SCRIPT_DIR))

from run_ctc_pause_correction_demo import (  # noqa: E402
    BillingError,
    call_llm,
    load_env,
    parse_json_response,
    sha256_bytes,
    sha256_file,
    utc_now,
    write_json,
    write_text,
)


DEFAULT_INPUT = WORKSPACE_ROOT / ".gop-research/exam/stable-gop-demo/result.json"
DEFAULT_OUTPUT = WORKSPACE_ROOT / ".gop-research/exam/stable-gop-demo-llm-v3"
DEFAULT_ENV = TEXTPA_ROOT / ".env.local"
DEFAULT_THRESHOLD = -0.35
WORD_CONTEXT_RADIUS = 2


SYSTEM_PROMPT = """You are an evidence-constrained English pronunciation feedback editor.
You cannot hear the audio. You may only organize and cautiously explain the supplied
CMU-phone CTC-GOP word-context evidence. Never invent acoustic, prosodic, grammatical,
semantic, or audio observations. Return the requested JSON contract exactly."""


def read_result(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read GOP result: {path}") from exc
    if not isinstance(value, dict) or not isinstance(value.get("phones"), list):
        raise ValueError("GOP result must be an object with a phones list")
    return value


def _finite_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"GOP phone field {name} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"GOP phone field {name} must be finite")
    return number


def _optional_finite_number(raw: Mapping[str, Any], name: str) -> float | None:
    """Copy an optional numeric GOP field without accepting non-finite values."""
    if name not in raw or raw[name] is None:
        return None
    return _finite_number(raw[name], name)


def _nonnegative_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def _phone_sort_key(row: Mapping[str, Any], ordinal: int = 0) -> tuple[int, float, int, int]:
    phone_index = row.get("phone_index")
    if isinstance(phone_index, bool) or not isinstance(phone_index, int):
        phone_order = 10**9
    else:
        phone_order = phone_index
    start_ms = row.get("start_ms")
    if isinstance(start_ms, bool) or not isinstance(start_ms, (int, float)):
        start_order = math.inf
    else:
        start_order = float(start_ms) if math.isfinite(float(start_ms)) else math.inf
    index = row.get("index")
    index_order = index if isinstance(index, int) and not isinstance(index, bool) else 10**9
    return phone_order, start_order, index_order, ordinal


def _phone_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return value.split()
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return []


def _derive_word_record(
    word_index: int,
    raw_word: Mapping[str, Any] | None,
    rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Build a complete word record from the flattened rows and optional words[]."""
    ordered_rows = [
        row
        for _, row in sorted(
            enumerate(rows), key=lambda pair: _phone_sort_key(pair[1], pair[0])
        )
    ]
    raw_word = raw_word or {}
    text = raw_word.get("text")
    if text is None and ordered_rows:
        text = ordered_rows[0].get("word")
    if text is None:
        text = ""

    reference_arpabet = _phone_list(raw_word.get("expected_arpabet"))
    reference_ipa = _phone_list(raw_word.get("expected_ipa"))
    if not reference_arpabet:
        reference_arpabet = [str(row.get("expected", "")) for row in ordered_rows]
    if not reference_ipa:
        reference_ipa = [str(row.get("expected_ipa", "")) for row in ordered_rows]

    observed_arpabet = [
        str(row.get("acoustic_winner", "")) for row in ordered_rows
    ]
    observed_ipa = [
        str(row.get("acoustic_winner_ipa", "")) for row in ordered_rows
    ]
    start_ms = raw_word.get("start_ms")
    end_ms = raw_word.get("end_ms")
    if start_ms is None and ordered_rows:
        start_ms = ordered_rows[0].get("start_ms")
    if end_ms is None and ordered_rows:
        end_ms = ordered_rows[-1].get("end_ms")
    return {
        "word_index": word_index,
        "word": str(text),
        "start_ms": start_ms,
        "end_ms": end_ms,
        "reference_phones": {
            "arpabet": reference_arpabet,
            "ipa": reference_ipa,
        },
        "observed_phones": {
            "arpabet": observed_arpabet,
            "ipa": observed_ipa,
            "source": (
                "acoustic_winner for each forced-aligned reference-phone segment; "
                "not an independent word-level decode"
            ),
        },
    }


def _build_word_records(result: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Collect every transcript word so neighboring context is available."""
    raw_rows = result["phones"]
    rows_by_word: dict[int, list[Mapping[str, Any]]] = {}
    for raw in raw_rows:
        if not isinstance(raw, Mapping):
            raise ValueError("each GOP phone row must be an object")
        word_index = _nonnegative_int(raw.get("word_index"), "word_index")
        rows_by_word.setdefault(word_index, []).append(raw)

    raw_words = result.get("words")
    raw_word_by_index: dict[int, Mapping[str, Any]] = {}
    if isinstance(raw_words, list):
        for position, raw_word in enumerate(raw_words):
            if not isinstance(raw_word, Mapping):
                raise ValueError("each GOP word row must be an object")
            word_index = raw_word.get("word_index", position)
            word_index = _nonnegative_int(word_index, "word_index")
            if word_index in raw_word_by_index:
                raise ValueError(f"duplicate word_index {word_index}")
            raw_word_by_index[word_index] = raw_word

    word_indices = sorted(set(rows_by_word) | set(raw_word_by_index))
    if not word_indices:
        raise ValueError("GOP result contains no words")
    records = []
    for word_index in word_indices:
        records.append(
            _derive_word_record(
                word_index,
                raw_word_by_index.get(word_index),
                rows_by_word.get(word_index, []),
            )
        )
    return records


def _build_word_contexts(
    result: Mapping[str, Any],
    selected: Sequence[Mapping[str, Any]],
    window: int = WORD_CONTEXT_RADIUS,
) -> list[dict[str, Any]]:
    """Attach a +/- window of ASR words to every word containing selected evidence."""
    if window < 0:
        raise ValueError("word context window must be non-negative")
    records = _build_word_records(result)
    record_by_index = {record["word_index"]: record for record in records}
    selected_by_word: dict[int, list[Mapping[str, Any]]] = {}
    for row in selected:
        word_index = _nonnegative_int(row.get("word_index"), "word_index")
        if word_index not in record_by_index:
            raise ValueError(f"selected GOP row references unknown word_index {word_index}")
        selected_by_word.setdefault(word_index, []).append(row)

    position_by_index = {
        record["word_index"]: position for position, record in enumerate(records)
    }
    contexts: list[dict[str, Any]] = []
    for word_index in sorted(selected_by_word, key=lambda value: position_by_index[value]):
        target = record_by_index[word_index]
        position = position_by_index[word_index]
        first = max(0, position - window)
        last = min(len(records), position + window + 1)
        context_words = []
        for context_position in range(first, last):
            context = records[context_position]
            item = {
                "relative_position": context_position - position,
                "word_index": context["word_index"],
                "word": context["word"],
            }
            if context["start_ms"] is not None:
                item["start_ms"] = context["start_ms"]
            if context["end_ms"] is not None:
                item["end_ms"] = context["end_ms"]
            context_words.append(item)
        gop_rows = sorted(
            selected_by_word[word_index],
            key=lambda row: _phone_sort_key(row),
        )
        contexts.append(
            {
                "word_index": word_index,
                "word": target["word"],
                "context_text": " ".join(item["word"] for item in context_words),
                "context_words": context_words,
                "reference_phones": target["reference_phones"],
                "observed_phones": target["observed_phones"],
                "gop_evidence": gop_rows,
            }
        )
    return contexts


def validate_evidence_package(evidence: Mapping[str, Any]) -> None:
    """Check that each selected row is represented by exactly one word context."""
    rows = evidence.get("rows")
    contexts = evidence.get("word_contexts")
    if not isinstance(rows, list) or not isinstance(contexts, list):
        raise ValueError("evidence package must contain rows and word_contexts lists")
    row_by_id = {str(row.get("evidence_id")): row for row in rows if isinstance(row, Mapping)}
    if len(row_by_id) != len(rows) or any(not isinstance(row, Mapping) for row in rows):
        raise ValueError("evidence rows must be unique objects")
    seen: set[str] = set()
    for context in contexts:
        if not isinstance(context, Mapping):
            raise ValueError("word_contexts items must be objects")
        required = {
            "word_index",
            "word",
            "context_text",
            "context_words",
            "reference_phones",
            "observed_phones",
            "gop_evidence",
        }
        if set(context) != required:
            raise ValueError("word context differs from the evidence contract")
        reference = context["reference_phones"]
        observed = context["observed_phones"]
        if (
            not isinstance(reference, Mapping)
            or set(reference) != {"arpabet", "ipa"}
            or not isinstance(observed, Mapping)
            or set(observed) != {"arpabet", "ipa", "source"}
        ):
            raise ValueError("word context phone sequences differ from the contract")
        for sequence in (
            reference["arpabet"],
            reference["ipa"],
            observed["arpabet"],
            observed["ipa"],
        ):
            if not isinstance(sequence, list) or not all(isinstance(item, str) for item in sequence):
                raise ValueError("word context phone sequences must be string lists")
        context_words = context["context_words"]
        if not isinstance(context_words, list) or not context_words:
            raise ValueError("word context must contain context_words")
        if not isinstance(context["gop_evidence"], list) or not context["gop_evidence"]:
            raise ValueError("word context must contain gop_evidence")
        for row in context["gop_evidence"]:
            if not isinstance(row, Mapping):
                raise ValueError("word context GOP evidence must be objects")
            evidence_id = row.get("evidence_id")
            if not isinstance(evidence_id, str) or evidence_id not in row_by_id:
                raise ValueError("word context cites unknown evidence ID")
            if row != row_by_id[evidence_id]:
                raise ValueError(f"word context {evidence_id} does not copy its evidence row")
            if evidence_id in seen:
                raise ValueError(f"evidence ID appears in multiple word contexts: {evidence_id}")
            seen.add(evidence_id)
    expected_ids = set(row_by_id)
    if seen != expected_ids:
        raise ValueError(
            "word contexts do not account for every selected row; "
            f"missing={sorted(expected_ids - seen)}"
        )


def low_gop_evidence(result: Mapping[str, Any], threshold: float) -> dict[str, Any]:
    """Select every phone row at or below threshold without semantic filtering."""
    if not math.isfinite(threshold):
        raise ValueError("--threshold must be finite")
    selected: list[dict[str, Any]] = []
    for raw in result["phones"]:
        if not isinstance(raw, Mapping):
            raise ValueError("each GOP phone row must be an object")
        score = _finite_number(raw.get("gop_log_ratio"), "gop_log_ratio")
        if score > threshold:
            continue
        index = _nonnegative_int(raw.get("index"), "each GOP phone row index")
        selected.append(
            {
                "evidence_id": f"GOP-{index:04d}",
                "index": index,
                "word_index": raw.get("word_index"),
                "phone_index": raw.get("phone_index"),
                "word": raw.get("word"),
                "expected": raw.get("expected"),
                "expected_ipa": raw.get("expected_ipa"),
                "acoustic_winner": raw.get("acoustic_winner"),
                "acoustic_winner_ipa": raw.get("acoustic_winner_ipa"),
                "best_alternative": raw.get("best_alternative"),
                "best_alternative_ipa": raw.get("best_alternative_ipa"),
                "expected_log_p": _optional_finite_number(raw, "expected_log_p"),
                "alternative_log_p": _optional_finite_number(raw, "alternative_log_p"),
                "gop_log_ratio": score,
                "confidence": _finite_number(raw.get("confidence"), "confidence"),
                "start_ms": raw.get("start_ms"),
                "end_ms": raw.get("end_ms"),
            }
        )
    selected.sort(key=lambda row: (row["gop_log_ratio"], row["start_ms"], row["index"]))
    ids = [row["evidence_id"] for row in selected]
    if len(ids) != len(set(ids)):
        raise ValueError("GOP phone indexes are not unique")
    if not selected:
        raise ValueError(f"no GOP phone rows have gop_log_ratio <= {threshold}")
    word_contexts = _build_word_contexts(result, selected)
    evidence = {
        "schema_version": 2,
        "source_result": {
            "path": os.fspath(Path(result.get("audio_path", "")).resolve())
            if result.get("audio_path")
            else None,
            "transcript": result.get("transcript", ""),
            "transcript_source": result.get("transcript_source", "unknown"),
            "audio_duration_ms": result.get("audio_duration_ms"),
            "gop_method": result.get("gop_method"),
            "model_dir": result.get("model_dir"),
            "reference_source": result.get("reference_source"),
            "dictionary_source": result.get("dictionary_source"),
        },
        "selection_policy": {
            "gop_log_ratio_lte": threshold,
            "selected_count": len(selected),
            "word_context_count": len(word_contexts),
            "meaning": (
                "Every phone row at or below the threshold is included. No consonant, "
                "word-position, acoustic-winner, or hand-written diagnostic filter was applied."
            ),
        },
        "word_context_policy": {
            "radius_words": WORD_CONTEXT_RADIUS,
            "meaning": (
                "For every word containing at least one selected row, include that word and "
                "up to two preceding and two following transcript words."
            ),
        },
        "interpretation_boundary": (
            "A low GOP is model evidence, not a pronunciation error or a calibrated probability. "
            "The LLM cannot hear the audio."
        ),
        "rows": selected,
        "word_contexts": word_contexts,
    }
    validate_evidence_package(evidence)
    return evidence


def render_prompt(evidence: Mapping[str, Any]) -> str:
    source_result = {
        key: value
        for key, value in evidence["source_result"].items()
        if key != "transcript"
    }
    source_result["transcript_scope"] = (
        "The full ASR transcript is retained in local evidence.json for audit only; "
        "the prompt contains only the local context_words/context_text windows."
    )
    prompt_evidence = {
        "source_result": source_result,
        "selection_policy": evidence["selection_policy"],
        "word_context_policy": evidence["word_context_policy"],
        "interpretation_boundary": evidence["interpretation_boundary"],
        "word_contexts": evidence["word_contexts"],
    }
    return """请把下面所有存在低 GOP 质疑的单词证据整理成保守的中文发音反馈，不要评分。

输入按“问题单词”组织：每个 `word_context` 都表示至少含有一条低 GOP 音素的单词，
并包含该词前后各最多两个 ASR 单词、该词完整的参考音素序列、
以及沿强制对齐窗口得到的用户声学赢家音素序列。`gop_evidence` 是该词内每一条
低 GOP 音素的详细原始证据。

必须遵守：
1. 你看不到音频。每一条 evidence_id 都是程序按阈值选出的原始声学证据，不是人工标注，
   也不是错误概率；expected 与 acoustic_winner 不同不自动等于发音错误。
2. 本次请求不包含完整 ASR transcript；`context_words` 和 `context_text` 来自 ASR，
   可能有错词，只用于提供局部语境。
   不得讨论语法、内容、措辞、停顿、流利度、
   音高、重音、语调、音量、情绪或整体水平。
3. `reference_phones` 是标准参考的 CMU/IPA 序列；`observed_phones` 是每个参考音素
   对齐窗口的 `acoustic_winner` 拼接，不是独立无条件的单词 ASR，也不是已经确认的用户发音。
4. 可以结合单词、CMU 音素、IPA、相邻证据和重复模式判断教学价值，但必须承认模型/对齐
   混淆、连读、弱读、合法变体和边界偏移的可能性。
5. `likely_issue` 只用于你认为值得明确反馈的重复或相对清晰模式；`needs_listening` 用于
   值得人工复听但不能确定的模式；其余放入 `withheld_differences`，说明为什么不应直接报错。
6. 必须让每个输入 evidence_id 在 `feedback_items` 或 `withheld_differences` 中出现且只出现
   一次。可以把同类 evidence_id 合并成一条，但不要丢弃任何一条，也不要创造 ID。
7. 每个反馈/暂缓项都必须在 `observations` 中逐字复制所引用行的 expected、expected_ipa、
   acoustic_winner、acoustic_winner_ipa；程序会核对这些字段。不要把 ARPAbet 音素改名，
   也不要把单个音素拼成输入中没有的整词 IPA、音节重音或方言转写。
8. 反馈只能引用输入中的音素和数值。练习建议要针对具体音素，且不能承诺模型已经证明了
   某个错误；不要用外部词典知识替换输入中的 CMU 音素。

严格输出以下 JSON，不要 Markdown 代码块，不要增加字段：
{
  "summary_zh": "一句保守总结",
  "feedback_items": [
    {
      "evidence_ids": ["GOP-0001"],
      "decision": "likely_issue 或 needs_listening",
      "observations": [
        {
          "evidence_id": "GOP-0001",
          "expected": "B",
          "expected_ipa": "b",
          "acoustic_winner": "P",
          "acoustic_winner_ipa": "p"
        }
      ],
      "finding_zh": "证据支持的发音观察",
      "rationale_zh": "为什么值得反馈或复听",
      "practice_zh": "具体而保守的练习建议"
    }
  ],
  "withheld_differences": [
    {
      "evidence_ids": ["GOP-0002"],
      "observations": [
        {
          "evidence_id": "GOP-0002",
          "expected": "B",
          "expected_ipa": "b",
          "acoustic_winner": "P",
          "acoustic_winner_ipa": "p"
        }
      ],
      "reason_zh": "为什么不能直接向学习者报错"
    }
  ],
  "limitations_zh": ["本次整理的具体限制"]
}

按单词组织的低 GOP 证据 JSON：
""" + json.dumps(prompt_evidence, ensure_ascii=False, indent=2)


def _validate_text(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")


def validate_feedback(value: Mapping[str, Any], evidence: Mapping[str, Any]) -> None:
    validate_evidence_package(evidence)
    expected_keys = {
        "summary_zh",
        "feedback_items",
        "withheld_differences",
        "limitations_zh",
    }
    if set(value) != expected_keys:
        raise ValueError(
            f"LLM response keys differ from the contract: {sorted(value)}"
        )
    _validate_text(value["summary_zh"], "summary_zh")
    for field in ("feedback_items", "withheld_differences", "limitations_zh"):
        if not isinstance(value[field], list):
            raise ValueError(f"{field} must be a list")
    if not all(isinstance(item, str) and item.strip() for item in value["limitations_zh"]):
        raise ValueError("limitations_zh must contain non-empty strings")

    rows = evidence["rows"]
    row_by_id = {str(row["evidence_id"]): row for row in rows}
    seen: set[str] = set()
    for field in ("feedback_items", "withheld_differences"):
        for item in value[field]:
            if not isinstance(item, Mapping):
                raise ValueError(f"{field} items must be objects")
            if field == "feedback_items":
                expected_item_keys = {
                    "evidence_ids",
                    "decision",
                    "observations",
                    "finding_zh",
                    "rationale_zh",
                    "practice_zh",
                }
                if set(item) != expected_item_keys:
                    raise ValueError("feedback item differs from the contract")
                if item["decision"] not in {"likely_issue", "needs_listening"}:
                    raise ValueError("feedback decision is invalid")
                for key in ("finding_zh", "rationale_zh", "practice_zh"):
                    _validate_text(item[key], key)
            else:
                if set(item) != {"evidence_ids", "observations", "reason_zh"}:
                    raise ValueError("withheld item differs from the contract")
                _validate_text(item["reason_zh"], "reason_zh")
            ids = item["evidence_ids"]
            if (
                not isinstance(ids, list)
                or not ids
                or not all(isinstance(item_id, str) for item_id in ids)
            ):
                raise ValueError(f"{field} evidence_ids must be a non-empty string list")
            if len(ids) != len(set(ids)):
                raise ValueError(f"{field} contains duplicate evidence IDs")
            unknown = set(ids) - set(row_by_id)
            if unknown:
                raise ValueError(f"{field} cites unknown evidence IDs: {sorted(unknown)}")
            overlap = seen.intersection(ids)
            if overlap:
                raise ValueError(f"evidence IDs appear more than once: {sorted(overlap)}")
            seen.update(ids)
            observations = item["observations"]
            if not isinstance(observations, list) or len(observations) != len(ids):
                raise ValueError("observations must contain one entry per evidence ID")
            observation_ids: list[str] = []
            for observation in observations:
                if not isinstance(observation, Mapping) or set(observation) != {
                    "evidence_id",
                    "expected",
                    "expected_ipa",
                    "acoustic_winner",
                    "acoustic_winner_ipa",
                }:
                    raise ValueError("observation differs from the contract")
                observation_id = observation["evidence_id"]
                if observation_id not in ids:
                    raise ValueError("observation cites an ID outside its item")
                observation_ids.append(observation_id)
                source = row_by_id[observation_id]
                for key in (
                    "expected",
                    "expected_ipa",
                    "acoustic_winner",
                    "acoustic_winner_ipa",
                ):
                    if observation[key] != source[key]:
                        raise ValueError(
                            f"observation {observation_id} does not copy {key} exactly"
                        )
            if observation_ids != ids:
                raise ValueError("observation IDs must match evidence_ids in order")
    expected_ids = set(row_by_id)
    if seen != expected_ids:
        raise ValueError(
            f"LLM did not account for every low-GOP row; missing={sorted(expected_ids - seen)}"
        )


def format_time(milliseconds: Any) -> str:
    seconds = float(milliseconds) / 1000.0
    minutes = int(seconds // 60)
    return f"{minutes:02d}:{seconds - minutes * 60:05.2f}"


def row_label(row: Mapping[str, Any]) -> str:
    return (
        f"`{row['evidence_id']}` `{row['word']}` {format_time(row['start_ms'])}-"
        f"{format_time(row['end_ms'])}: /{row['expected_ipa']}/ ({row['expected']}) -> "
        f"/{row['acoustic_winner_ipa']}/ ({row['acoustic_winner']})，"
        f"GOP {row['gop_log_ratio']}"
    )


def sequence_label(sequence: Mapping[str, Any]) -> str:
    arpabet = " ".join(str(phone) for phone in sequence.get("arpabet", []))
    ipa = " ".join(str(phone) for phone in sequence.get("ipa", []))
    return f"CMU `{arpabet}`；IPA `{ipa}`"


def render_report(evidence: Mapping[str, Any], feedback: Mapping[str, Any], config: Mapping[str, Any]) -> str:
    row_by_id = {str(row["evidence_id"]): row for row in evidence["rows"]}
    lines = [
        "# 低 GOP 数据的 LLM 整理结果",
        "",
        "本报告把达到阈值的全部 GOP 音素行交给 LLM 归纳；LLM 看不到音频，以下不是自动判错。",
        "",
        f"- 输入：`{config['input']}`",
        f"- GOP 阈值：`gop_log_ratio <= {evidence['selection_policy']['gop_log_ratio_lte']}`",
        f"- 送入 LLM：`{len(evidence['rows'])}` 条",
        f"- 问题单词：`{len(evidence['word_contexts'])}` 个",
        f"- 模型：`{config['model']}`",
        "",
        "## 问题单词上下文",
        "",
        "每个词包含前后最多两个 ASR 单词；观测序列是强制对齐窗口的 acoustic winner 拼接，",
        "不是独立的词级 ASR 结果。",
        "",
    ]
    for context in evidence["word_contexts"]:
        lines.extend(
            [
                f"### `{context['word']}`（word_index {context['word_index']}）",
                "",
                f"上下文：`{context['context_text']}`",
                f"参考序列：{sequence_label(context['reference_phones'])}",
                f"观测序列：{sequence_label(context['observed_phones'])}",
                f"低 GOP 证据：{', '.join(row['evidence_id'] for row in context['gop_evidence'])}",
                "",
            ]
        )
    if not evidence["word_contexts"]:
        lines.extend(["- 没有问题单词。", ""])
    lines.extend(
        [
        "## LLM 总结",
        "",
        feedback["summary_zh"],
        "",
        "## LLM 认为值得反馈或复听",
        "",
        ]
    )
    if not feedback["feedback_items"]:
        lines.append("- 没有单独列出反馈项。")
    for item in feedback["feedback_items"]:
        lines.extend(
            [
                f"### {item['decision']}",
                "",
                f"证据：{', '.join(item['evidence_ids'])}",
                "",
                item["finding_zh"],
                "",
                f"理由：{item['rationale_zh']}",
                "",
                f"练习：{item['practice_zh']}",
                "",
                "原始行：",
            ]
        )
        lines.extend(f"- {row_label(row_by_id[evidence_id])}" for evidence_id in item["evidence_ids"])
        lines.append("")
    lines.extend(["## LLM 暂缓的低 GOP 差异", ""])
    if not feedback["withheld_differences"]:
        lines.append("- 没有暂缓项。")
    for item in feedback["withheld_differences"]:
        lines.append(
            f"- **{', '.join(item['evidence_ids'])}**：{item['reason_zh']}"
        )
        lines.extend(f"  - {row_label(row_by_id[evidence_id])}" for evidence_id in item["evidence_ids"])
    lines.extend(["", "## 全部低 GOP 原始行", ""])
    lines.extend(f"- {row_label(row)}" for row in evidence["rows"])
    lines.extend(["", "## 限制", ""])
    lines.extend(f"- {item}" for item in feedback["limitations_zh"])
    lines.extend(
        [
            "- GOP 是模型内部声学证据，不是校准概率；低 GOP 可能来自模型混淆、强制对齐边界、",
            "  连读/弱读或 ASR 临时文本错误。最终应复听原音频。",
        ]
    )
    return "\n".join(lines) + "\n"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="run_pronunciation_gop_demo.py 的 result.json")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV, help="OpenAI-compatible endpoint 配置文件")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="选择 gop_log_ratio <= threshold 的全部音素行")
    parser.add_argument("--overwrite-llm", action="store_true", help="允许重新调用 LLM")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--retries", type=int, default=4)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.retries < 1:
        raise ValueError("--retries must be positive")
    if args.timeout <= 0 or not math.isfinite(args.timeout):
        raise ValueError("--timeout must be positive and finite")
    if args.temperature < 0 or not math.isfinite(args.temperature):
        raise ValueError("--temperature must be non-negative and finite")
    input_path = args.input.resolve()
    output_dir = args.output_dir.resolve()
    result = read_result(input_path)
    evidence = low_gop_evidence(result, args.threshold)
    prompt = render_prompt(evidence)
    output_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = output_dir / "evidence.json"
    prompt_path = output_dir / "prompt.txt"
    response_path = output_dir / "response.json"
    result_path = output_dir / "result.json"
    report_path = output_dir / "report.md"
    write_json(evidence_path, evidence)
    write_text(prompt_path, prompt)

    load_env(args.env.resolve())
    api_key = os.environ.get("TEXTPA_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("TEXTPA_API_KEY or OPENAI_API_KEY is missing")
    api_style = os.environ.get("TEXTPA_API_STYLE", "chat")
    if api_style != "chat":
        raise ValueError("this demo currently requires TEXTPA_API_STYLE=chat")
    base_url = os.environ.get("TEXTPA_BASE_URL", "").rstrip("/")
    if not base_url:
        raise ValueError("TEXTPA_BASE_URL is missing")
    endpoint = base_url + "/chat/completions"
    model = os.environ.get("TEXTPA_MODEL", "agnes-2.5-flash")
    max_tokens = int(os.environ.get("TEXTPA_MAX_TOKENS", "65535"))
    request_identity = {
        "schema_version": 2,
        "input_sha256": sha256_file(input_path),
        "prompt_sha256": sha256_bytes(prompt.encode("utf-8")),
        "endpoint": endpoint,
        "model": model,
        "max_tokens": max_tokens,
        "temperature": args.temperature,
        "thinking": args.thinking,
        "threshold": args.threshold,
    }
    request_sha256 = sha256_bytes(
        json.dumps(request_identity, ensure_ascii=False, sort_keys=True).encode("utf-8")
    )

    if response_path.exists() and not args.overwrite_llm:
        wrapper = json.loads(response_path.read_text(encoding="utf-8"))
        if wrapper.get("request_sha256") != request_sha256:
            raise ValueError(
                "saved response configuration differs; use --overwrite-llm intentionally"
            )
        feedback = wrapper.get("feedback")
        if not isinstance(feedback, Mapping):
            raise ValueError("saved response has no feedback object")
        validate_feedback(feedback, evidence)
        api_response = wrapper.get("api_response")
        print("reusing saved LLM response", flush=True)
    else:
        print(
            f"sending {len(evidence['rows'])} low-GOP rows in "
            f"{len(evidence['word_contexts'])} word contexts to {model}",
            flush=True,
        )
        response = call_llm(
            prompt,
            endpoint=endpoint,
            api_key=api_key,
            model=model,
            max_tokens=max_tokens,
            temperature=args.temperature,
            thinking=args.thinking,
            timeout=args.timeout,
            retries=args.retries,
            system_prompt=SYSTEM_PROMPT,
        )
        feedback = parse_json_response(response["content"])
        validate_feedback(feedback, evidence)
        api_response = response["api_response"]
        write_json(
            response_path,
            {
                "schema_version": 2,
                "request_sha256": request_sha256,
                "request_config": request_identity,
                "api_response": api_response,
                "feedback": feedback,
            },
        )

    config = {
        "input": os.fspath(input_path),
        "output_dir": os.fspath(output_dir),
        "endpoint": endpoint,
        "model": model,
        "threshold": args.threshold,
        "temperature": args.temperature,
        "thinking": args.thinking,
    }
    final = {
        "schema_version": 2,
        "input": os.fspath(input_path),
        "input_sha256": sha256_file(input_path),
        "selection_policy": evidence["selection_policy"],
        "word_context_policy": evidence["word_context_policy"],
        "evidence": evidence["rows"],
        "word_contexts": evidence["word_contexts"],
        "feedback": feedback,
        "llm": config,
    }
    write_json(result_path, final)
    write_text(report_path, render_report(evidence, feedback, config))
    write_json(
        output_dir / "manifest.json",
        {
            "schema_version": 2,
            "completed_at": utc_now(),
            "input": {
                "path": os.fspath(input_path),
                "sha256": sha256_file(input_path),
            },
            "script": {
                "path": os.fspath(Path(__file__).resolve()),
                "sha256": sha256_file(Path(__file__).resolve()),
            },
            "llm": config,
            "selected_count": len(evidence["rows"]),
            "word_context_count": len(evidence["word_contexts"]),
            "feedback_item_count": len(feedback["feedback_items"]),
            "withheld_count": len(feedback["withheld_differences"]),
        },
    )
    return {
        "result": os.fspath(result_path),
        "report": os.fspath(report_path),
        "response": os.fspath(response_path),
        "selected_count": len(evidence["rows"]),
        "word_context_count": len(evidence["word_contexts"]),
        "feedback_item_count": len(feedback["feedback_items"]),
        "withheld_count": len(feedback["withheld_differences"]),
        "model": model,
    }


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        summary = run(args)
    except (BillingError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
