#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在 MultiPA 论文 cues 上跑「思考强度 × 锚点」对照，复现 benchmark-data/deepseek-effort-sweep。

为什么不用 ``textpa assess``：CLI 没有暴露 ``temperature``，而本数据集是在
``temperature=0`` 下采样的；这个 runner 只用标准库，直接调 OpenAI 兼容端点，
把 prompt 构造/结果解析仍然委托给 textpa_repro，和 CLI 走同一套代码。

典型用法（Key 由本地代理注入时，--api-key 随便填）::

    python3 scripts/run_effort_sweep.py \
        --base-url http://127.0.0.1:8787/v1 --api-key anything \
        --tiers none,minimal,high,max --concurrency 25 --out-dir /tmp/effort

    # 四锚点协议（4 锚点入 prompt，按 cli.py 语义校验并排除，评估其余 46 条）
    python3 scripts/run_effort_sweep.py --anchors benchmark-data/calibration/multipa-extreme4-anchors.jsonl \
        --tiers none,minimal,high,max --concurrency 25 --out-dir /tmp/anchor

输出每个条件一个 JSONL（``effort-<tier>.jsonl`` / ``anchor-<tier>.jsonl``），
已存在的 id 会跳过，中断后可直接重跑续采。
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from textpa_repro.llm import parse_assessment  # noqa: E402
from textpa_repro.models import TextCues  # noqa: E402
from textpa_repro.prompting import CalibrationAnchor, cue_payload, render_prompt  # noqa: E402

DEFAULT_CUES = "benchmark-data/multipa-reference/paper_cues.jsonl"
_LOCK = threading.Lock()


def call_once(
    endpoint: Tuple[str, int, str],
    model: str,
    prompt: str,
    tier: str,
    api_key: str,
    max_tokens: int,
    temperature: float,
    timeout: float,
    retries: int,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """发一次请求；返回（结果, 错误）。只对 429/5xx 与网络异常重试。"""
    host, port, scheme = endpoint
    body: Dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "reasoning_effort": tier,
    }
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    last: Optional[str] = None
    for attempt in range(retries):
        started = time.monotonic()
        try:
            if scheme == "https":
                connection: Any = http.client.HTTPSConnection(host, port, timeout=timeout)
            else:
                connection = http.client.HTTPConnection(host, port, timeout=timeout)
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=payload,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            response = connection.getresponse()
            raw = response.read()
            elapsed = time.monotonic() - started
            connection.close()
            if response.status == 200:
                parsed = json.loads(raw)
                usage = parsed["usage"]
                details = usage.get("completion_tokens_details") or {}
                choice = parsed["choices"][0]
                return (
                    {
                        "usage": {
                            "prompt": usage["prompt_tokens"],
                            "completion": usage["completion_tokens"],
                            "reasoning": details.get("reasoning_tokens", 0),
                            "cache_hit": usage.get("prompt_cache_hit_tokens", 0),
                        },
                        "content": choice["message"].get("content") or "",
                        "finish": choice.get("finish_reason"),
                        "seconds": round(elapsed, 1),
                    },
                    None,
                )
            last = f"HTTP {response.status}: {raw[:200]!r}"
            if response.status in (429, 500, 502, 503, 504) and attempt + 1 < retries:
                time.sleep(20 * (attempt + 1))
                continue
            return None, last
        except Exception as exc:  # noqa: BLE001 - 采集脚本要把任何失败都记下来
            last = f"{type(exc).__name__}: {exc}"
            if attempt + 1 < retries:
                time.sleep(5 * (attempt + 1))
    return None, last


def load_anchors(path: str, cues_by_id: Dict[str, dict]) -> List[CalibrationAnchor]:
    anchors = [CalibrationAnchor.from_dict(json.loads(line)) for line in open(path, encoding="utf-8")]
    ids = {anchor.cues.utterance_id for anchor in anchors}
    missing = sorted(ids - set(cues_by_id))
    if missing:
        raise SystemExit(f"锚点 ID 不在 cues 里：{missing[:3]}")
    mismatched = [
        anchor.cues.utterance_id
        for anchor in anchors
        if cue_payload(anchor.cues) != cue_payload(TextCues.from_dict(cues_by_id[anchor.cues.utterance_id]))
    ]
    if mismatched:
        raise SystemExit(f"锚点 payload 与 cues 不一致：{mismatched[:3]}")
    return anchors


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cues", default=DEFAULT_CUES)
    parser.add_argument("--anchors", help="给了就走四锚点协议（并排除锚点自身）")
    parser.add_argument("--tiers", default="none,minimal,high,max")
    parser.add_argument("--model", default="deepseek-flash")
    parser.add_argument("--base-url", default=os.environ.get("TEXTPA_BASE_URL", "https://api.deepseek.com/v1"))
    parser.add_argument("--api-key", default=os.environ.get("TEXTPA_API_KEY", ""))
    parser.add_argument("--max-tokens", type=int, default=65535)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="只跑前 N 条（调试用）")
    parser.add_argument("--out-dir", default="artifacts/effort-sweep")
    args = parser.parse_args(argv)

    parts = urlsplit(args.base_url if "://" in args.base_url else "https://" + args.base_url)
    endpoint = (parts.hostname or "", parts.port or (443 if parts.scheme == "https" else 80), parts.scheme)

    cues = [json.loads(line) for line in open(args.cues, encoding="utf-8")]
    cues_by_id = {str(cue["id"]): cue for cue in cues}
    anchors: List[CalibrationAnchor] = []
    prefix = "effort"
    if args.anchors:
        anchors = load_anchors(args.anchors, cues_by_id)
        anchor_ids = {anchor.cues.utterance_id for anchor in anchors}
        cues = [cue for cue in cues if cue["id"] not in anchor_ids]
        prefix = "anchor"
        print(f"四锚点协议：{len(anchors)} 个锚点入 prompt，评估 {len(cues)} 条")
    if args.limit:
        cues = cues[: args.limit]

    os.makedirs(args.out_dir, exist_ok=True)
    for tier in [item.strip() for item in args.tiers.split(",") if item.strip()]:
        path = os.path.join(args.out_dir, f"{prefix}-{tier}.jsonl")
        done = set()
        if os.path.exists(path):
            for line in open(path, encoding="utf-8"):
                try:
                    done.add(json.loads(line)["id"])
                except (json.JSONDecodeError, KeyError):
                    continue
        todo = [cue for cue in cues if cue["id"] not in done]
        print(f"[{tier}] 待跑 {len(todo)} 条（并发 {args.concurrency}）", flush=True)
        handle = open(path, "a", encoding="utf-8")
        counter = {"n": 0}

        def work(cue: dict) -> None:
            prompt = render_prompt(TextCues.from_dict(cue), calibration_anchors=anchors)
            result, error = call_once(
                endpoint, args.model, prompt, tier, args.api_key,
                args.max_tokens, args.temperature, args.timeout, args.retries,
            )
            record: Dict[str, Any] = {
                "schema_version": 1,
                "id": cue["id"],
                "tier": tier,
                "requested_effort": tier,
                "prompt_mode": "paper-with-calibration-anchors" if anchors else "paper",
                "llm_model": args.model,
            }
            if result is None:
                record["error"] = error
            else:
                record.update(result)
                try:
                    record["assessment"] = parse_assessment(result["content"]).to_dict()
                except Exception as exc:  # noqa: BLE001
                    record["parse_error"] = f"{type(exc).__name__}: {exc}"
            with _LOCK:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                handle.flush()
                counter["n"] += 1
                if counter["n"] % 10 == 0 or counter["n"] == len(todo):
                    print(f"  [{tier}] {counter['n']}/{len(todo)}", flush=True)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            list(pool.map(work, todo))
        handle.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
