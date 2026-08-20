#!/usr/bin/env python3
"""Run TextPA cues through an OpenAI-compatible Agnes chat endpoint."""
from __future__ import annotations

import argparse
import ast
import csv
import json
import os
from pathlib import Path
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zipfile import ZipFile

import sys
sys.path.insert(0, "/workspace/textpa/src")
from textpa_repro.llm import parse_assessment
from textpa_repro.models import TextCues
from textpa_repro.prompting import CalibrationAnchor, cue_payload, render_prompt


BILLING_WORDS = (
    "insufficient balance", "insufficient credit", "insufficient funds",
    "insufficient_quota", "balance is insufficient", "credit balance",
    "billing", "payment required", "out of credit", "no credit",
    "余额不足", "余额", "欠费", "充值", "付费",
)
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504, 520, 522, 524}


class StopBatch(RuntimeError):
    pass


def load_env(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def speech_cues(zip_path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with ZipFile(zip_path) as archive:
        names = sorted(
            n for n in archive.namelist()
            if n.startswith("speechocean/gpt4omini/") and n.endswith(".json")
        )
        for name in names:
            payload = json.loads(archive.read(name))
            input_text = payload["input_content"]
            raw = input_text.split("Input:", 1)[1].strip()
            fields = ast.literal_eval(raw)
            wavname = str(payload["wavname"])
            records.append({
                "schema_version": 1,
                "id": wavname,
                "transcript": str(fields["Transcript"]),
                "phonemes_cmu": str(fields["Phonemes_CMU"]),
                "phonemes_ipa": str(fields["Phonemes_IPA"]),
            })
    return records


def read_records(path: Path, zip_path: Path | None) -> list[dict[str, Any]]:
    if zip_path is not None:
        return speech_cues(zip_path)
    records = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if line.strip():
                value = json.loads(line)
                TextCues.from_dict(value)
                records.append(value)
    return records


def read_anchors(path: Path | None) -> list[CalibrationAnchor]:
    if path is None:
        return []
    anchors: list[CalibrationAnchor] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                anchors.append(CalibrationAnchor.from_dict(json.loads(line)))
            except Exception as exc:
                raise ValueError(f"{path}:{line_number}: invalid anchor: {exc}") from exc
    if not anchors:
        raise ValueError(f"{path}: calibration anchor file is empty")
    anchor_ids = [anchor.cues.utterance_id for anchor in anchors]
    if len(anchor_ids) != len(set(anchor_ids)):
        raise ValueError(f"{path}: duplicate calibration anchor ID")
    return anchors


def exclude_anchors(
    records: list[dict[str, Any]], anchors: list[CalibrationAnchor]
) -> list[dict[str, Any]]:
    records_by_id = {str(record["id"]): record for record in records}
    if len(records_by_id) != len(records):
        raise ValueError("input contains duplicate record IDs")
    missing = [
        anchor.cues.utterance_id
        for anchor in anchors
        if anchor.cues.utterance_id not in records_by_id
    ]
    if missing:
        raise ValueError(
            f"calibration anchors are absent from input (missing={len(missing)})"
        )
    mismatched = [
        anchor.cues.utterance_id
        for anchor in anchors
        if cue_payload(anchor.cues)
        != cue_payload(TextCues.from_dict(records_by_id[anchor.cues.utterance_id]))
    ]
    if mismatched:
        raise ValueError(
            "calibration anchors do not match input cues "
            f"(mismatched={len(mismatched)})"
        )
    anchor_ids = {anchor.cues.utterance_id for anchor in anchors}
    remaining = [record for record in records if str(record["id"]) not in anchor_ids]
    if not remaining:
        raise ValueError("excluding calibration anchors left no records")
    return remaining


def is_billing(status: int, body: str) -> bool:
    low = body.lower()
    return status == 402 or any(word in low for word in BILLING_WORDS)


class RateGate:
    """Keep request starts below the documented free-tier executable RPM."""

    def __init__(self, min_interval: float = 3.25) -> None:
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next_allowed - now)
            self._next_allowed = max(now, self._next_allowed) + self.min_interval
        if delay:
            time.sleep(delay)

    def cooldown(self, seconds: float) -> None:
        with self._lock:
            self._next_allowed = max(
                self._next_allowed, time.monotonic() + seconds
            )


def call_one(cues: TextCues, *, endpoint: str, key: str, model: str,
             max_tokens: int, timeout: float, retries: int,
             request_extra: dict[str, Any], gate: RateGate,
             calibration_anchors: list[CalibrationAnchor],
             temperature: float | None) -> dict[str, Any]:
    request_body: dict[str, Any] = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": render_prompt(
                cues, calibration_anchors=calibration_anchors
            ),
        }],
        "max_tokens": max_tokens,
        **request_extra,
    }
    if temperature is not None:
        request_body["temperature"] = temperature
    body = json.dumps(request_body, ensure_ascii=False).encode("utf-8")
    last = ""
    for attempt in range(retries):
        gate.acquire()
        req = Request(endpoint, data=body, method="POST", headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with urlopen(req, timeout=timeout) as response:
                status = int(response.status)
                raw = response.read().decode("utf-8", "replace")
                response_headers = response.headers
            if status != 200:
                last = raw[:2000]
                if is_billing(status, raw):
                    raise StopBatch(f"billing/credit error HTTP {status}: {last}")
                if status in RETRYABLE_STATUSES and attempt + 1 < retries:
                    retry_after = response_headers.get("Retry-After")
                    try:
                        wait_for = float(retry_after) if retry_after else 0.0
                    except ValueError:
                        wait_for = 0.0
                    if status == 429:
                        wait_for = max(wait_for, 60.0)
                        gate.cooldown(wait_for)
                    else:
                        wait_for = max(wait_for, min(5.0 * (2 ** attempt), 90.0))
                    time.sleep(wait_for)
                    continue
                raise RuntimeError(f"HTTP {status}: {last}")
            response_payload = json.loads(raw)
            content = response_payload["choices"][0]["message"]["content"]
            assessment = parse_assessment(content)
            result: dict[str, Any] = {
                "assessment": assessment.to_dict(),
                "provider": "openai-compatible",
                "llm_model": model,
                "prompt_mode": (
                    "paper-with-calibration-anchors"
                    if calibration_anchors else "paper"
                ),
                "response_id": response_payload.get("id"),
                "response_created": response_payload.get("created"),
            }
            if "usage" in response_payload:
                result["usage"] = response_payload["usage"]
            return result
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            last = raw[:2000]
            if is_billing(exc.code, raw):
                raise StopBatch(f"billing/credit error HTTP {exc.code}: {last}") from exc
            if exc.code in RETRYABLE_STATUSES and attempt + 1 < retries:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    wait_for = float(retry_after) if retry_after else 0.0
                except ValueError:
                    wait_for = 0.0
                if exc.code == 429:
                    wait_for = max(wait_for, 60.0)
                    gate.cooldown(wait_for)
                else:
                    wait_for = max(wait_for, min(5.0 * (2 ** attempt), 90.0))
                time.sleep(wait_for)
                continue
            raise RuntimeError(f"HTTP {exc.code}: {last}") from exc
        except URLError as exc:
            last = str(exc)
            if attempt + 1 < retries:
                time.sleep(min(5.0 * (2 ** attempt), 90.0))
                continue
            raise RuntimeError(f"network error: {last}") from exc
        except StopBatch:
            raise
        except Exception as exc:
            last = str(exc)
            if attempt + 1 < retries:
                time.sleep(min(5.0 * (2 ** attempt), 90.0))
                continue
            raise RuntimeError(f"request/parse error: {last}") from exc
    raise RuntimeError(last or "request failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path)
    parser.add_argument("--speech-zip", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--env", type=Path, default=Path(".env.local"))
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--min-interval", type=float, default=3.25)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--max-tokens", type=int, default=65535)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--thinking", action="store_true")
    parser.add_argument("--temperature", type=float)
    parser.add_argument("--calibration-anchors", type=Path)
    parser.add_argument("--exclude-calibration-anchors", action="store_true")
    args = parser.parse_args()
    if (args.input is None) == (args.speech_zip is None):
        parser.error("choose exactly one of --input and --speech-zip")
    load_env(args.env)
    key = os.environ["TEXTPA_API_KEY"]
    base = os.environ.get("TEXTPA_BASE_URL", "https://apihub.agnes-ai.com/v1")
    endpoint = base.rstrip("/") + "/chat/completions"
    model = os.environ.get("TEXTPA_MODEL", "agnes-2.5-flash")
    records = read_records(args.input, args.speech_zip)
    anchors = read_anchors(args.calibration_anchors)
    if args.exclude_calibration_anchors and not anchors:
        parser.error("--exclude-calibration-anchors requires --calibration-anchors")
    if args.exclude_calibration_anchors:
        records = exclude_anchors(records, anchors)
    if args.overwrite or not args.output.exists():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text("", encoding="utf-8")
    done: dict[str, dict[str, Any]] = {}
    if args.output.exists() and not args.overwrite:
        with args.output.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    item = json.loads(line)
                    done[str(item["id"])] = item
    pending = [r for r in records if str(r["id"]) not in done]
    request_extra = {
        "chat_template_kwargs": {"enable_thinking": True}
    } if args.thinking else {}
    print(
        f"records={len(records)} completed={len(done)} pending={len(pending)} "
        f"concurrency={args.concurrency} min_interval={args.min_interval} "
        f"thinking={args.thinking} anchors={len(anchors)} "
        f"exclude_anchors={args.exclude_calibration_anchors}",
        flush=True,
    )
    gate = RateGate(args.min_interval)
    lock = threading.Lock()
    stop = threading.Event()
    output_handle = args.output.open("a", encoding="utf-8")

    def run(record: dict[str, Any]) -> dict[str, Any]:
        if stop.is_set():
            raise StopBatch("batch stopped")
        cues = TextCues.from_dict(record)
        result = call_one(cues, endpoint=endpoint, key=key, model=model,
                          max_tokens=args.max_tokens, timeout=args.timeout,
                          retries=args.retries, request_extra=request_extra,
                          gate=gate, calibration_anchors=anchors,
                          temperature=args.temperature)
        out = dict(record)
        out.update(result)
        out["request_config"] = {
            "endpoint": endpoint,
            "max_tokens": args.max_tokens,
            "thinking": request_extra,
            "temperature": args.temperature,
            "calibration_anchors": [
                anchor.manifest_dict() for anchor in anchors
            ],
            "exclude_calibration_anchors": args.exclude_calibration_anchors,
        }
        return out

    executor = ThreadPoolExecutor(max_workers=args.concurrency)
    futures = {executor.submit(run, r): r for r in pending}
    completed = len(done)
    try:
        while futures:
            finished, _ = wait(futures, return_when=FIRST_COMPLETED)
            for future in finished:
                record = futures.pop(future)
                try:
                    out = future.result()
                except StopBatch:
                    stop.set()
                    raise
                except Exception:
                    stop.set()
                    raise
                with lock:
                    output_handle.write(json.dumps(out, ensure_ascii=False) + "\n")
                    output_handle.flush()
                completed += 1
                if completed % 10 == 0 or completed == len(records):
                    print(f"completed={completed}/{len(records)}", flush=True)
    except BaseException:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
        output_handle.close()
        raise
    else:
        executor.shutdown(wait=True)
        output_handle.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
