#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按本地审计数据统计 DeepSeek 用量：全部时间 + 最近 N 小时（默认 24）。

数据来源是代理落盘的审计目录（`proxy-captures/`）：
  * 优先读 `index.jsonl`（快）；
  * 再扫每个请求目录的 `meta.json`，把索引里没有的补上
    （进程被强杀时留下的 in-flight 记录也在其中）。
也接受 `--log-file` 生成的 JSONL（两种字段布局都能识别）。

只读、零依赖、不联网。

用法：
    python3 tools/deepseek-proxy/usage_report.py
    python3 tools/deepseek-proxy/usage_report.py proxy-captures --hours 24
    python3 tools/deepseek-proxy/usage_report.py proxy-captures --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple


# --------------------------------------------------------------------------- #
# 读取与解析
# --------------------------------------------------------------------------- #


def _configure_output() -> None:
    """非交互输出统一 UTF-8，且任何情况下都不因编码报错（Windows cp936 重定向）。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            if not stream.isatty():
                stream.reconfigure(encoding="utf-8")
            stream.reconfigure(errors="replace")
        except Exception:
            pass


def parse_timestamp(value: Any) -> Optional[datetime]:
    """宽容解析审计里的时间戳（`2026-09-28T21:56:10+0800` / `...Z` / 无时区）。"""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    for attempt in (text, _normalize_offset(text)):
        if attempt is None:
            continue
        try:
            parsed = datetime.fromisoformat(attempt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.now().astimezone().tzinfo)
        return parsed
    return None


def _normalize_offset(text: str) -> Optional[str]:
    if text.endswith("Z"):
        return text[:-1] + "+00:00"
    if len(text) >= 5 and text[-5] in "+-" and text[-4:].isdigit():
        return f"{text[:-5]}{text[-5:-2]}:{text[-2:]}"
    return None


def _read_json(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _read_jsonl(path: str) -> List[dict]:
    records: List[dict] = []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    records.append(value)
    except OSError:
        return []
    return records


def _usage_from(record: dict) -> Dict[str, int]:
    """兼容两种布局：审计 meta 里的嵌套 usage，与 --log-file 的扁平字段。"""
    nested = record.get("usage")
    source = nested if isinstance(nested, dict) else record
    reported = bool(source.get("reported", True)) if isinstance(nested, dict) else True

    def number(key: str) -> int:
        value = source.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return 0
        return max(0, int(value))

    prompt = number("prompt_tokens")
    completion = number("completion_tokens")
    total = number("total_tokens") or (prompt + completion)
    is_reported = bool(reported and (prompt or completion or total))
    # 估算值始终在记录顶层（审计 meta 与 --log-file 都是），不在嵌套的 usage 里；
    # 老版本可能同时写了上报 usage 与估算值，这里以「是否上报」为准，避免重复计入口径。
    estimated = record.get("estimated_completion_tokens")
    if isinstance(estimated, bool) or not isinstance(estimated, (int, float)):
        estimated = 0
    return {
        "reported": 1 if is_reported else 0,
        "prompt": prompt,
        "completion": completion,
        "total": total,
        "cache_hit": number("cache_hit_tokens"),
        "cache_miss": number("cache_miss_tokens"),
        "reasoning": number("reasoning_tokens"),
        "estimated": 0 if is_reported else max(0, int(estimated)),
    }


def normalize(record: dict, base_dir: Optional[str] = None) -> Optional[dict]:
    when = parse_timestamp(record.get("started_at") or record.get("timestamp"))
    if when is None:
        return None
    usage = _usage_from(record)
    status = record.get("status")
    request_bytes = record.get("request_bytes")
    if not isinstance(request_bytes, int):
        request_bytes = 0
        if base_dir:
            capture = record.get("capture_dir")
            if isinstance(capture, str):
                path = os.path.join(base_dir, capture, "request.body")
                try:
                    request_bytes = os.path.getsize(path)
                except OSError:
                    request_bytes = 0
    response_bytes = record.get("response_bytes")
    if not isinstance(response_bytes, int):
        response_bytes = 0
    error = record.get("error")
    return {
        "when": when,
        "status": status if isinstance(status, int) else None,
        "model": record.get("model") if isinstance(record.get("model"), str) else None,
        "path": record.get("path") if isinstance(record.get("path"), str) else None,
        "state": record.get("state") if isinstance(record.get("state"), str) else "complete",
        "error": error if isinstance(error, str) else None,
        "request_bytes": request_bytes,
        "response_bytes": response_bytes,
        **usage,
    }


def load_records(paths: List[str]) -> Tuple[List[dict], List[str]]:
    """返回（记录列表, 实际读到的数据源列表）。"""
    records: List[dict] = []
    sources: List[str] = []
    seen: set = set()

    for path in paths:
        path = os.path.abspath(path)
        candidates: List[Tuple[str, Optional[str]]] = []
        if os.path.isdir(path):
            index_path = os.path.join(path, "index.jsonl")
            for record in _read_jsonl(index_path):
                # 索引里的 capture_dir 是相对本目录的，补上 base_dir 才能算出请求体字节
                candidates.append((json.dumps(record, sort_keys=True), path))
            if os.path.exists(index_path):
                sources.append(index_path)
            for name in sorted(os.listdir(path)):
                directory = os.path.join(path, name)
                meta_path = os.path.join(directory, "meta.json")
                if os.path.isdir(directory) and os.path.exists(meta_path):
                    raw = _read_json(meta_path)
                    if raw is not None:
                        raw.setdefault("capture_dir", name)
                        candidates.append((json.dumps(raw, sort_keys=True), path))
        elif os.path.isfile(path):
            for record in _read_jsonl(path):
                candidates.append((json.dumps(record, sort_keys=True), None))
            sources.append(path)
        else:
            continue

        for fingerprint, base_dir in candidates:
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            item = normalize(json.loads(fingerprint), base_dir)
            if item is not None:
                records.append(item)

    records.sort(key=lambda item: item["when"])
    return records, sources


# --------------------------------------------------------------------------- #
# 汇总
# --------------------------------------------------------------------------- #


@dataclass
class Totals:
    requests: int = 0
    ok: int = 0
    failed: int = 0
    unfinished: int = 0
    prompt: int = 0
    completion: int = 0
    total: int = 0
    cache_hit: int = 0
    cache_miss: int = 0
    reasoning: int = 0
    reported: int = 0
    estimated_responses: int = 0
    estimated_tokens: int = 0
    request_bytes: int = 0
    response_bytes: int = 0
    by_model: Dict[str, Dict[str, int]] = field(default_factory=dict)

    def add(self, record: dict) -> None:
        self.requests += 1
        if record["state"] != "complete":
            self.unfinished += 1
        elif record["status"] is None or record["status"] >= 400 or record["error"]:
            self.failed += 1
        else:
            self.ok += 1
        self.prompt += record["prompt"]
        self.completion += record["completion"]
        self.total += record["total"]
        self.cache_hit += record["cache_hit"]
        self.cache_miss += record["cache_miss"]
        self.reasoning += record["reasoning"]
        self.reported += record["reported"]
        if record["estimated"]:
            self.estimated_responses += 1
            self.estimated_tokens += record["estimated"]
        self.request_bytes += record["request_bytes"]
        self.response_bytes += record["response_bytes"]

        model = record["model"] or "(unknown)"
        bucket = self.by_model.setdefault(
            model, {"requests": 0, "prompt": 0, "completion": 0, "total": 0, "estimated": 0}
        )
        bucket["requests"] += 1
        bucket["prompt"] += record["prompt"]
        bucket["completion"] += record["completion"]
        bucket["total"] += record["total"]
        bucket["estimated"] += record["estimated"]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "requests": self.requests,
            "ok": self.ok,
            "failed": self.failed,
            "unfinished": self.unfinished,
            "prompt_tokens": self.prompt,
            "completion_tokens": self.completion,
            "total_tokens": self.total,
            "cache_hit_tokens": self.cache_hit,
            "cache_miss_tokens": self.cache_miss,
            "reasoning_tokens": self.reasoning,
            "reported_responses": self.reported,
            "estimated_responses": self.estimated_responses,
            "estimated_completion_tokens": self.estimated_tokens,
            "request_bytes": self.request_bytes,
            "response_bytes": self.response_bytes,
            "by_model": self.by_model,
        }


def _display_tz(records: List[dict]) -> timezone:
    """用记录里最常见的时区显示（代理常跑在 +0800，容器可能跑在 UTC）。"""
    counts: Dict[int, int] = {}
    for record in records:
        offset = record["when"].utcoffset()
        if offset is None:
            continue
        minutes = int(offset.total_seconds() // 60)
        counts[minutes] = counts.get(minutes, 0) + 1
    if not counts:
        return datetime.now().astimezone().tzinfo or timezone.utc  # type: ignore[return-value]
    minutes = max(counts, key=lambda key: counts[key])
    return timezone(timedelta(minutes=minutes))


def _format_bytes(value: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{value} B"


def _display_width(text: str) -> int:
    """终端显示宽度：CJK 全角字符算 2 列，否则中文表头会与数字列错位。"""
    return sum(2 if unicodedata.east_asian_width(char) in ("W", "F") else 1 for char in text)


def _pad(text: str, width: int, align: str = "left") -> str:
    spaces = " " * max(0, width - _display_width(text))
    return spaces + text if align == "right" else text + spaces


def _cache_rate(totals: Totals) -> str:
    denominator = totals.cache_hit + totals.cache_miss
    if denominator <= 0:
        return "—"
    return f"{totals.cache_hit / denominator * 100:.1f}%"


def _totals_block(title: str, totals: Totals, share: Optional[Totals] = None) -> List[str]:
    lines = [f"──────── {title} ────────"]
    lines.append(
        f"  请求      : {totals.requests}（成功 {totals.ok}，失败/非 2xx {totals.failed}，未完成 {totals.unfinished}）"
    )
    lines.append(f"  输入 token : {totals.prompt:,}（prompt）")
    lines.append(
        f"  输出 token : {totals.completion:,}（completion，其中 reasoning {totals.reasoning:,} 是子集）"
    )
    lines.append(
        f"  合计 token : {totals.total:,}"
        + (f"   占全部 {totals.total / share.total * 100:.1f}%" if share and share.total else "")
    )
    lines.append(
        f"  输入侧缓存 : hit {totals.cache_hit:,} | miss {totals.cache_miss:,} | 命中率 {_cache_rate(totals)}"
    )
    if totals.estimated_responses:
        lines.append(
            f"  估算输出   : {totals.estimated_responses} 条响应未上报 usage，"
            f"输出 ≈ {totals.estimated_tokens:,}（仅估算输出，不计入上面的合计）"
        )
    lines.append(
        f"  字节      : 请求 {_format_bytes(totals.request_bytes)} | 响应 {_format_bytes(totals.response_bytes)}"
    )
    return lines


def _model_table(totals: Totals, share: Optional[Totals]) -> List[str]:
    if not totals.by_model:
        return []
    window_models = share.by_model if share else {}
    lines = ["──────── 按模型（全部 / 窗口内）────────"]
    lines.append(
        "  "
        + _pad("模型", 24)
        + _pad("请求", 7, "right")
        + _pad("输入", 12, "right")
        + _pad("输出", 12, "right")
        + _pad("合计", 14, "right")
        + "   │"
        + _pad("窗口请求", 10, "right")
        + _pad("窗口输入", 12, "right")
        + _pad("窗口输出", 12, "right")
        + _pad("窗口合计", 14, "right")
    )
    for model, bucket in sorted(totals.by_model.items(), key=lambda item: -item[1]["total"]):
        current = window_models.get(model, {})
        lines.append(
            "  "
            + _pad(model, 24)
            + _pad(f"{bucket['requests']:,}", 7, "right")
            + _pad(f"{bucket['prompt']:,}", 12, "right")
            + _pad(f"{bucket['completion']:,}", 12, "right")
            + _pad(f"{bucket['total']:,}", 14, "right")
            + "   │"
            + _pad(f"{current.get('requests', 0):,}", 10, "right")
            + _pad(f"{current.get('prompt', 0):,}", 12, "right")
            + _pad(f"{current.get('completion', 0):,}", 12, "right")
            + _pad(f"{current.get('total', 0):,}", 14, "right")
        )
    return lines


def _hourly_block(records: List[dict], since: datetime, tz: timezone, hours: int) -> List[str]:
    buckets: Dict[datetime, Totals] = {}
    for record in records:
        if record["when"] < since:
            continue
        moment = record["when"].astimezone(tz)
        key = moment.replace(minute=0, second=0, microsecond=0)
        buckets.setdefault(key, Totals()).add(record)
    if not buckets:
        return []
    peak = max(bucket.total for bucket in buckets.values()) or 1
    lines = [f"──────── 最近 {hours} 小时按小时（{tz.tzname(None) or tz}）────────"]
    for key in sorted(buckets):
        bucket = buckets[key]
        width = int(round(bucket.total / peak * 28))
        bar = "#" * width if width else ""
        lines.append(
            f"  {key.strftime('%m-%d %H:00')}"
            f"  输入 {bucket.prompt:>9,}  输出 {bucket.completion:>9,}  合计 {bucket.total:>10,}"
            f"  {bar}"
            + (f"  ({bucket.requests} 次)" if bucket.requests else "")
        )
    return lines


def _human_time(moment: Optional[datetime], tz: timezone) -> str:
    return moment.astimezone(tz).strftime("%Y-%m-%d %H:%M") if moment else "—"


def build_report(records: List[dict], sources: List[str], hours: int) -> Dict[str, Any]:
    tz = _display_tz(records)
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)

    all_totals = Totals()
    for record in records:
        all_totals.add(record)
    window_totals = Totals()
    for record in records:
        if record["when"] >= since:
            window_totals.add(record)

    lines = ["", "================ DeepSeek 本地用量报告 ================"]
    lines.append(f"  数据源    : {', '.join(sources) if sources else '（无）'}")
    lines.append(f"  记录数    : {len(records)}")
    if records:
        first, last = records[0]["when"], records[-1]["when"]
        lines.append(
            f"  时间范围  : {_human_time(first, tz)} → {_human_time(last, tz)}"
            f"（{tz.tzname(None) or tz}）"
        )
    lines.append(f"  统计时刻  : {_human_time(now, tz)}，窗口 = 最近 {hours} 小时")
    lines.append("")
    if not records:
        lines.append("  没有读到任何用量记录。确认代理运行时开启了审计（默认开启），")
        lines.append("  或用参数指定目录：usage_report.py <proxy-captures 路径>")
        lines.append("=======================================================")
        return {
            "generated_at": now.isoformat(),
            "window_hours": hours,
            "sources": sources,
            "record_count": 0,
            "total": all_totals.as_dict(),
            "window": window_totals.as_dict(),
            "hourly": [],
            "text": "\n".join(lines),
        }

    lines += _totals_block("全部时间", all_totals)
    lines.append("")
    lines += _totals_block(f"最近 {hours} 小时", window_totals, share=all_totals)
    lines.append("")
    lines += _model_table(all_totals, window_totals)
    hourly = _hourly_block(records, since, tz, hours)
    if hourly:
        lines.append("")
        lines += hourly
    lines.append("")
    lines.append("说明：输入 = prompt_tokens，输出 = completion_tokens（reasoning 是输出的子集，不额外相加）。")
    lines.append("      分项只统计服务端上报的 usage；流式响应默认不带 usage，估算值单列且不计入合计。")
    lines.append("=======================================================")

    hourly_data = []
    for record in records:
        if record["when"] < since:
            continue
        moment = record["when"].astimezone(tz).replace(minute=0, second=0, microsecond=0)
        hourly_data.append({"hour": moment.strftime("%Y-%m-%d %H:00"), "total_tokens": record["total"]})

    return {
        "generated_at": now.isoformat(),
        "window_hours": hours,
        "sources": sources,
        "record_count": len(records),
        "time_range": {
            "first": records[0]["when"].astimezone(tz).isoformat(),
            "last": records[-1]["when"].astimezone(tz).isoformat(),
        },
        "total": all_totals.as_dict(),
        "window": window_totals.as_dict(),
        "hourly": hourly_data,
        "text": "\n".join(lines),
    }


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #


def main(argv: Optional[List[str]] = None) -> int:
    _configure_output()
    parser = argparse.ArgumentParser(
        prog="usage_report.py",
        description="按本地审计数据统计 DeepSeek 用量（全部时间 + 最近若干小时）",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        default=None,
        help="审计目录或 JSONL 文件（默认 ./proxy-captures）",
    )
    parser.add_argument("--hours", type=float, default=24.0, help="窗口小时数（默认 24）")
    parser.add_argument("--json", action="store_true", help="输出 JSON（便于脚本消费）")
    args = parser.parse_args(argv)

    paths = args.paths or ["proxy-captures"]
    missing = [path for path in paths if not os.path.exists(path)]
    records, sources = load_records(paths)
    if missing and not records:
        for path in missing:
            print(f"路径不存在：{path}", file=sys.stderr)
        return 1

    report = build_report(records, sources or paths, args.hours)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(report["text"])
    return 0 if records else 1


if __name__ == "__main__":
    raise SystemExit(main())
