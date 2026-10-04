#!/usr/bin/env python3
"""Send unscored word-level eSpeak CTC alignments to an LLM for feedback."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
TEXTPA_ROOT = SCRIPT_DIR.parent
WORKSPACE_ROOT = TEXTPA_ROOT.parent
if os.fspath(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, os.fspath(SCRIPT_DIR))

from run_ctc_pause_correction_demo import (  # noqa: E402
    BillingError,
    SYSTEM_PROMPT,
    call_llm,
    load_env,
    parse_json_response,
    sha256_bytes,
    sha256_file,
    utc_now,
    write_json,
    write_text,
)


DEFAULT_INPUT = (
    TEXTPA_ROOT
    / "benchmark-data/ctc-espeak-reference-ab/run-seed-20260820/results.json"
)
DEFAULT_OUTPUT = (
    TEXTPA_ROOT
    / "benchmark-data/word-alignment-llm-demo/run-seed-20260820"
)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def repository_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(WORKSPACE_ROOT.resolve()).as_posix()
    except ValueError:
        return os.fspath(resolved)


def word_alignment_evidence(record: dict[str, Any]) -> dict[str, Any]:
    """Strip all scores, margins, thresholds, and preselected candidates."""
    ctc = record["references"]["espeak"]["ctc"]
    words: list[dict[str, Any]] = []
    for word in ctc["words"]:
        word_id = f"W{int(word['word_index']) + 1:03d}"
        phones: list[dict[str, Any]] = []
        for phone_index, phone in enumerate(word["phones"], 1):
            phones.append(
                {
                    "phone_id": f"{word_id}-P{phone_index:02d}",
                    "expected_phone": phone["expected"],
                    "acoustic_winner": phone.get("observed", phone["expected"]),
                    "start_ms": phone["start_ms"],
                    "end_ms": phone["end_ms"],
                }
            )
        words.append(
            {
                "word_id": word_id,
                "word": word["text"],
                "start_ms": word["start_ms"],
                "end_ms": word["end_ms"],
                "phones": phones,
            }
        )
    return {
        "schema_version": 1,
        "sample_id": record["id"],
        "provisional_transcript": record["transcript"],
        "transcript_source": record["transcript_source"],
        "transcript_is_ground_truth": False,
        "reference_phones": (
            "eSpeak NG en-us whole-utterance phonemization mapped back to words"
        ),
        "alignment": (
            "CTC Viterbi forced alignment using "
            "facebook/wav2vec2-lv-60-espeak-cv-ft ONNX INT8"
        ),
        "acoustic_winner_definition": (
            "the highest-logit phone token averaged over the forced span; "
            "not an error label or correctness probability"
        ),
        "words": words,
    }


def render_prompt(evidence: dict[str, Any]) -> str:
    return """下面是一段英语自由表达录音的完整词级 CTC 强制对齐。请生成中文发音反馈。

输入口径：
1. 输入没有经过问题筛选，也没有分数、阈值、置信度或预先作出的好坏判断。
2. provisional transcript 来自 Whisper ASR，不是已知原文，可能转写错误。
3. 每个 phone_id 表示 eSpeak 期望音素在强制对齐路径中的时间片；acoustic_winner 是
   该时间片里声学模型 logit 最高的 token，不等于人工听到的真值，也不是错误概率。
4. 强制对齐会把全部参考音素压到音频上。不得据此断言漏词、错词、语法问题或整体水平。
5. 请自行考虑合法口音、自然弱读、闪音、复合 token、相邻音素错位和连锁对齐错误。
   expected_phone 与 acoustic_winner 不同不自动等于发音错误；相同也不证明发音正确。
6. 只把你认为具有实际教学价值的差异放进 feedback_items。证据不充分但值得复听的可标
   needs_listening；很可能是自然变体、token 表示或对齐问题的差异放进 withheld_differences。
7. 每个判断必须引用输入中真实存在的 phone_id，且不要捏造音高、重音、语调、音量、
   情绪、流利度或停顿信息。没有可信问题时允许 feedback_items 为空。

严格输出以下 JSON，不要 Markdown 代码块，不要增加字段：
{
  "summary_zh": "保守的一句话总结",
  "feedback_items": [
    {
      "phone_ids": ["W001-P01"],
      "word": "对应单词",
      "decision": "likely_issue 或 needs_listening",
      "finding_zh": "观察到的具体音素差异",
      "rationale_zh": "为什么该差异值得反馈或复听",
      "practice_zh": "具体且不过度承诺的练习建议"
    }
  ],
  "withheld_differences": [
    {
      "phone_ids": ["W001-P01"],
      "word": "对应单词",
      "reason_zh": "为什么不应直接向学习者报错"
    }
  ],
  "limitations_zh": ["本条分析的具体限制"]
}

完整词级对齐 JSON：
""" + json.dumps(evidence, ensure_ascii=False, indent=2)


def phone_index(evidence: dict[str, Any]) -> dict[str, str]:
    return {
        phone["phone_id"]: word["word"]
        for word in evidence["words"]
        for phone in word["phones"]
    }


def validate_feedback(value: dict[str, Any], evidence: dict[str, Any]) -> None:
    if set(value) != {
        "summary_zh",
        "feedback_items",
        "withheld_differences",
        "limitations_zh",
    }:
        raise ValueError("LLM response top-level keys differ from the contract")
    if not isinstance(value["summary_zh"], str):
        raise ValueError("summary_zh must be a string")
    for field in ("feedback_items", "withheld_differences", "limitations_zh"):
        if not isinstance(value[field], list):
            raise ValueError(f"{field} must be a list")
    if not all(isinstance(item, str) for item in value["limitations_zh"]):
        raise ValueError("limitations_zh items must be strings")

    valid_phones = phone_index(evidence)
    cited: set[str] = set()
    for field in ("feedback_items", "withheld_differences"):
        expected_keys = (
            {
                "phone_ids",
                "word",
                "decision",
                "finding_zh",
                "rationale_zh",
                "practice_zh",
            }
            if field == "feedback_items"
            else {"phone_ids", "word", "reason_zh"}
        )
        for item in value[field]:
            if not isinstance(item, dict) or set(item) != expected_keys:
                raise ValueError(f"{field} item differs from the contract")
            ids = item["phone_ids"]
            if (
                not isinstance(ids, list)
                or not ids
                or not all(isinstance(phone_id, str) for phone_id in ids)
                or not all(phone_id in valid_phones for phone_id in ids)
            ):
                raise ValueError(f"{field} cites invalid phone IDs: {ids}")
            if len(ids) != len(set(ids)) or cited.intersection(ids):
                raise ValueError(f"{field} duplicates a phone ID: {ids}")
            cited.update(ids)
            words = {valid_phones[phone_id] for phone_id in ids}
            if words != {item["word"]}:
                raise ValueError(
                    f"{field} word {item['word']!r} does not match phone IDs {ids}"
                )
            if field == "feedback_items":
                if item["decision"] not in {"likely_issue", "needs_listening"}:
                    raise ValueError("feedback decision is invalid")
                if not all(
                    isinstance(item[key], str)
                    for key in ("word", "finding_zh", "rationale_zh", "practice_zh")
                ):
                    raise ValueError("feedback text fields must be strings")
            elif not isinstance(item["word"], str) or not isinstance(
                item["reason_zh"], str
            ):
                raise ValueError("withheld difference text fields must be strings")


def mismatch_ids(evidence: dict[str, Any]) -> set[str]:
    return {
        phone["phone_id"]
        for word in evidence["words"]
        for phone in word["phones"]
        if phone["expected_phone"] != phone["acoustic_winner"]
    }


def feedback_markdown(feedback: dict[str, Any]) -> str:
    lines = [feedback["summary_zh"], "", "### 向学习者反馈"]
    if not feedback["feedback_items"]:
        lines.append("- 没有选择需要反馈的项目。")
    for item in feedback["feedback_items"]:
        ids = ", ".join(item["phone_ids"])
        lines.extend(
            [
                f"- **{item['word']}**（{item['decision']}；{ids}）：{item['finding_zh']}",
                f"  理由：{item['rationale_zh']}",
                f"  练习：{item['practice_zh']}",
            ]
        )
    lines.extend(["", "### 主动暂缓的差异"])
    if not feedback["withheld_differences"]:
        lines.append("- 没有列出主动暂缓项。")
    for item in feedback["withheld_differences"]:
        ids = ", ".join(item["phone_ids"])
        lines.append(f"- **{item['word']}**（{ids}）：{item['reason_zh']}")
    if feedback["limitations_zh"]:
        lines.extend(["", "### 限制"])
        lines.extend(f"- {item}" for item in feedback["limitations_zh"])
    return "\n".join(lines)


def build_report(results: Sequence[dict[str, Any]]) -> str:
    lines = [
        "# Unscored word-alignment LLM demo",
        "",
        "输入是完整 eSpeak 词级 CTC 对齐；没有向 LLM 提供分数、阈值、confidence、",
        "候选排序、停顿信息或预先作出的错误判断。以下保留模型原始结构化反馈。",
        "",
    ]
    for index, result in enumerate(results, 1):
        feedback = result["feedback"]
        lines.extend(
            [
                f"## 样本 {index}",
                "",
                f"- ID：`{result['id']}`",
                f"- 对齐词数：`{result['word_count']}`",
                f"- 原始不一致位置：`{result['raw_mismatch_count']}`",
                f"- LLM 反馈项：`{len(feedback['feedback_items'])}`",
                f"- LLM 主动暂缓项：`{len(feedback['withheld_differences'])}`",
                "",
                "**Whisper 临时参考文本**",
                "",
                result["transcript"].strip(),
                "",
                feedback_markdown(feedback),
                "",
                f"输入证据：[JSON](samples/{result['id']}.evidence.json)",
                "",
            ]
        )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--env", type=Path, default=TEXTPA_ROOT / ".env.local")
    parser.add_argument("--overwrite-llm", action="store_true")
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--retries", type=int, default=4)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.retries < 1:
        raise ValueError("retries must be positive")
    source_path = args.input.resolve()
    source = read_json(source_path)
    if not isinstance(source, list) or not source:
        raise ValueError("input must be a non-empty JSON array")

    output_dir = args.output_dir.resolve()
    samples_dir = output_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    load_env(args.env)
    api_key = os.environ.get("TEXTPA_API_KEY")
    if not api_key:
        raise ValueError("TEXTPA_API_KEY is missing")
    if os.environ.get("TEXTPA_API_STYLE", "chat") != "chat":
        raise ValueError("this demo requires the chat completions API")
    base_url = os.environ.get("TEXTPA_BASE_URL", "").rstrip("/")
    if not base_url:
        raise ValueError("TEXTPA_BASE_URL is missing")
    endpoint = base_url + "/chat/completions"
    model = os.environ.get("TEXTPA_MODEL", "agnes-2.5-flash")
    max_tokens = int(os.environ.get("TEXTPA_MAX_TOKENS", "65535"))

    results: list[dict[str, Any]] = []
    for index, record in enumerate(source, 1):
        sample_id = str(record["id"])
        evidence = word_alignment_evidence(record)
        prompt = render_prompt(evidence)
        evidence_path = samples_dir / f"{sample_id}.evidence.json"
        prompt_path = samples_dir / f"{sample_id}.prompt.txt"
        response_path = samples_dir / f"{sample_id}.response.json"
        write_json(evidence_path, evidence)
        write_text(prompt_path, prompt)

        request_identity = {
            "schema_version": 1,
            "system_prompt": SYSTEM_PROMPT,
            "user_prompt": prompt,
            "endpoint": endpoint,
            "model": model,
            "max_tokens": max_tokens,
            "temperature": args.temperature,
            "thinking": args.thinking,
        }
        request_sha256 = sha256_bytes(
            json.dumps(
                request_identity, ensure_ascii=False, sort_keys=True
            ).encode("utf-8")
        )
        if response_path.exists() and not args.overwrite_llm:
            wrapper = read_json(response_path)
            if wrapper.get("request_sha256") != request_sha256:
                raise ValueError(
                    f"saved response request differs for {sample_id}; "
                    "use --overwrite-llm intentionally"
                )
            feedback = wrapper["feedback"]
            validate_feedback(feedback, evidence)
            print(f"[{index}/{len(source)}] reusing saved LLM response", flush=True)
        else:
            print(f"[{index}/{len(source)}] requesting {model}", flush=True)
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
            )
            feedback = parse_json_response(response["content"])
            validate_feedback(feedback, evidence)
            wrapper = {
                "schema_version": 1,
                "id": sample_id,
                "request_sha256": request_sha256,
                "request_config": {
                    "endpoint": endpoint,
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": args.temperature,
                    "thinking": args.thinking,
                },
                "api_response": response["api_response"],
                "feedback": feedback,
            }
            write_json(response_path, wrapper)

        results.append(
            {
                "schema_version": 1,
                "id": sample_id,
                "transcript": evidence["provisional_transcript"],
                "word_count": len(evidence["words"]),
                "raw_mismatch_count": len(mismatch_ids(evidence)),
                "feedback": feedback,
            }
        )

    write_json(output_dir / "results.json", results)
    write_text(output_dir / "report.md", build_report(results))
    write_json(
        output_dir / "manifest.json",
        {
            "schema_version": 1,
            "completed_at": utc_now(),
            "experiment": "unscored full word-level eSpeak CTC alignment to LLM",
            "input": {
                "path": repository_path(source_path),
                "sha256": sha256_file(source_path),
            },
            "script": {
                "path": repository_path(Path(__file__)),
                "sha256": sha256_file(Path(__file__)),
            },
            "llm": {
                "endpoint": endpoint,
                "model": model,
                "max_tokens": max_tokens,
                "temperature": args.temperature,
                "thinking": args.thinking,
            },
            "result_count": len(results),
        },
    )
    print(f"demo complete: {output_dir / 'report.md'}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BillingError as exc:
        print(f"STOPPED: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(2) from exc
