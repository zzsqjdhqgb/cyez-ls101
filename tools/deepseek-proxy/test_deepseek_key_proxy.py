#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""deepseek_key_proxy.py 的自测：假上游 + 真代理子进程，逐字节核对转发与统计。

运行：  python3 test_deepseek_key_proxy.py -v
不访问外网、不需要任何真实 API Key。
"""

from __future__ import annotations

import contextlib
import gzip
import hashlib
import http.client
import io
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import deepseek_key_proxy as dkp  # noqa: E402

REAL_KEY = "sk-test-real-key-0123456789abcdef"
CLIENT_KEY = "sk-client-dummy-value"
HEALTH_PATH = "/__proxy/health"

USAGE = {
    "prompt_tokens": 11,
    "completion_tokens": 5,
    "total_tokens": 16,
    "prompt_cache_hit_tokens": 4,
    "prompt_cache_miss_tokens": 7,
    "completion_tokens_details": {"reasoning_tokens": 2},
}


def json_payload(marker: str, usage: Optional[Dict[str, Any]] = None) -> bytes:
    body: Dict[str, Any] = {
        "id": f"chatcmpl-{marker}",
        "object": "chat.completion",
        "model": "deepseek-chat",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "你好 world"},
                "finish_reason": "stop",
            }
        ],
    }
    if usage is not None:
        body["usage"] = usage
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


def sse_stream(with_usage: bool, marker: str) -> bytes:
    events: List[bytes] = []
    for piece in ("Hel", "lo ", "世界"):
        chunk = {
            "id": f"chatcmpl-{marker}",
            "object": "chat.completion.chunk",
            "model": "deepseek-chat",
            "choices": [{"index": 0, "delta": {"content": piece}}],
        }
        events.append(b"data: " + json.dumps(chunk, ensure_ascii=False).encode("utf-8") + b"\n\n")
    if with_usage:
        chunk = {
            "id": f"chatcmpl-{marker}",
            "object": "chat.completion.chunk",
            "model": "deepseek-chat",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 21, "completion_tokens": 7, "total_tokens": 28},
        }
        events.append(b"data: " + json.dumps(chunk).encode("utf-8") + b"\n\n")
    events.append(b"data: [DONE]\n\n")
    return b"".join(events)


class FakeUpstream(BaseHTTPRequestHandler):
    """按 x-test-case 头返回不同形态的响应，并记录收到的原始请求。"""

    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _read_body(self) -> Tuple[bytes, bytes]:
        transfer_encoding = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in transfer_encoding:
            tracker = dkp.ChunkedStream()
            raw = bytearray()
            payload = bytearray()
            while not tracker.done:
                piece = self.rfile.read1(65536)
                if not piece:
                    break
                raw += piece
                payload += tracker.feed(piece)
            return bytes(raw), bytes(payload)
        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length) if length else b""
        return data, data

    def _record(self, raw: bytes, payload: bytes) -> None:
        self.server.records.append(  # type: ignore[attr-defined]
            {
                "method": self.command,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "header_pairs": [(k.lower(), v) for k, v in self.headers.items()],
                "raw_body": raw,
                "body": payload,
            }
        )

    def _write(self, status: int, body: bytes, headers: List[Tuple[str, str]]) -> None:
        self.send_response(status)
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)
            self.wfile.flush()

    def _write_chunk(self, piece: bytes) -> None:
        self.wfile.write(b"%x\r\n" % len(piece) + piece + b"\r\n")
        self.wfile.flush()

    def do_GET(self) -> None:
        raw, payload = self._read_body()
        self._record(raw, payload)
        body = json.dumps({"object": "list", "data": [{"id": "deepseek-chat"}]}).encode()
        self._write(200, body, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])

    def do_HEAD(self) -> None:
        raw, payload = self._read_body()
        self._record(raw, payload)
        self._write(200, b"", [("Content-Type", "application/json"), ("Content-Length", "42")])

    def do_POST(self) -> None:
        raw, payload = self._read_body()
        self._record(raw, payload)
        case = self.headers.get("x-test-case", "json")
        marker = case

        if case == "json":
            body = json_payload(marker, USAGE)
            self._write(200, body, [("Content-Type", "application/json"), ("Content-Length", str(len(body))), ("X-Upstream-Header", "kept")])
        elif case == "gzip":
            body = gzip.compress(json_payload(marker, USAGE))
            self._write(200, body, [("Content-Type", "application/json"), ("Content-Encoding", "gzip"), ("Content-Length", str(len(body)))])
        elif case == "chunked":
            body = json_payload(marker, USAGE)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for index in range(0, len(body), 7):
                self._write_chunk(body[index : index + 7])
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        elif case == "close":
            body = json_payload(marker, USAGE)
            self.protocol_version = "HTTP/1.0"
            self.close_connection = True
            self._write(200, body, [("Content-Type", "application/json")])
        elif case == "error429":
            body = json.dumps({"error": {"message": "Rate limit reached", "type": "rate_limit_error"}}).encode()
            self._write(429, body, [("Content-Type", "application/json"), ("Content-Length", str(len(body))), ("Retry-After", "3")])
        elif case == "error500":
            body = b"<html><body>boom</body></html>"
            self._write(500, body, [("Content-Type", "text/html"), ("Content-Length", str(len(body)))])
        elif case == "stream":
            body = sse_stream(True, marker)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for line in body.split(b"\n\n"):
                if not line:
                    continue
                self._write_chunk(line + b"\n\n")
                time.sleep(0.01)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        elif case == "stream_no_usage":
            body = sse_stream(False, marker)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
        elif case == "empty204":
            self.send_response(204)
            self.send_header("X-Empty", "1")
            self.end_headers()
        else:
            body = b'{"error":{"message":"unknown case"}}'
            self._write(400, body, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])


class ProxyProcess:
    def __init__(self, upstream_port: int, capture_dir: str, extra: Optional[List[str]] = None):
        self.capture_dir = capture_dir
        self.root = os.path.dirname(os.path.abspath(capture_dir))
        os.makedirs(self.root, exist_ok=True)
        self.log_path = os.path.join(self.root, "proxy.log")
        self.usage_path = os.path.join(self.root, "usage.jsonl")
        self.port = _free_port()
        args = [
            sys.executable,
            os.path.join(HERE, "deepseek_key_proxy.py"),
            "--port",
            str(self.port),
            "--upstream",
            f"http://127.0.0.1:{upstream_port}",
            "--key-stdin",
            "--capture-dir",
            capture_dir,
            "--health-path",
            HEALTH_PATH,
            "--log-file",
            self.usage_path,
        ]
        if extra:
            args.extend(extra)
        self.log_handle = open(self.log_path, "w", encoding="utf-8")
        self.process = subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert self.process.stdin is not None
        self.process.stdin.write(REAL_KEY + "\n")
        self.process.stdin.flush()
        self.process.stdin.close()
        _wait_for_port(self.port, self.process)

    def output(self) -> str:
        if not self.log_handle.closed:
            self.log_handle.flush()
        with open(self.log_path, "r", encoding="utf-8") as handle:
            return handle.read()

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGINT)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        self.log_handle.close()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_port(port: int, process: subprocess.Popen, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"代理提前退出，exit={process.returncode}")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.05)
    raise RuntimeError("等待代理端口超时")


def client_request(
    port: int,
    method: str = "POST",
    path: str = "/v1/chat/completions",
    body: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    chunked: bool = False,
) -> Tuple[int, Dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    request_headers = {"Authorization": f"Bearer {CLIENT_KEY}"}
    if headers:
        request_headers.update(headers)
    if chunked:
        connection.request(method, path, body=iter([body or b""]), headers=request_headers, encode_chunked=True)
    else:
        connection.request(method, path, body=body, headers=request_headers)
    response = connection.getresponse()
    data = response.read()
    result = (response.status, {k.lower(): v for k, v in response.getheaders()}, data)
    connection.close()
    return result


def find_capture(capture_dir: str, body: bytes, timeout: float = 10.0) -> Dict[str, Any]:
    """按请求体哈希在审计索引里找记录。

    代理是先回包再落盘，所以客户端拿到响应后索引可能还差几毫秒，这里轮询等待。
    """
    digest = hashlib.sha256(body).hexdigest()
    index_path = os.path.join(capture_dir, "index.jsonl")
    deadline = time.time() + timeout
    while True:
        if os.path.exists(index_path):
            with open(index_path, "r", encoding="utf-8") as handle:
                for line in handle:
                    record = json.loads(line)
                    if record.get("request_body_sha256") == digest:
                        return record
        if time.time() >= deadline:
            raise AssertionError(f"审计索引里找不到 body sha256={digest} 的记录")
        time.sleep(0.05)


class UnitTests(unittest.TestCase):
    def test_chunked_stream_survives_byte_by_byte_feeds(self) -> None:
        wire = b"5\r\nhello\r\n1;ext=1\r\n \r\n6\r\nworld!\r\n0\r\nX-Trailer: 1\r\n\r\n"
        for step in (1, 2, 3, 7, len(wire)):
            tracker = dkp.ChunkedStream()
            out = bytearray()
            for start in range(0, len(wire), step):
                out += tracker.feed(wire[start : start + step])
            self.assertEqual(bytes(out), b"hello world!", f"step={step}")
            self.assertTrue(tracker.done, f"step={step}")

    def test_usage_extraction_variants(self) -> None:
        deepseek = dkp.usage_from_payload(
            {"usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12,
                       "prompt_cache_hit_tokens": 3, "prompt_cache_miss_tokens": 7}}
        )
        assert deepseek is not None
        self.assertTrue(deepseek.reported)
        self.assertEqual((deepseek.prompt_tokens, deepseek.total_tokens), (10, 12))
        self.assertEqual((deepseek.cache_hit_tokens, deepseek.cache_miss_tokens), (3, 7))

        openai_style = dkp.usage_from_payload(
            {"usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12,
                       "prompt_tokens_details": {"cached_tokens": 4},
                       "completion_tokens_details": {"reasoning_tokens": 6}}}
        )
        assert openai_style is not None
        self.assertEqual((openai_style.cache_hit_tokens, openai_style.cache_miss_tokens), (4, 6))
        self.assertEqual(openai_style.reasoning_tokens, 6)
        self.assertIsNone(dkp.usage_from_payload({"choices": []}))

    def test_estimate_and_redaction(self) -> None:
        self.assertEqual(dkp.estimate_tokens(0, 0), 0)
        self.assertGreater(dkp.estimate_tokens(400, 0), 100)
        redacted = dkp.redact_headers([("Authorization", "Bearer sk-secret"), ("X-K", "v")])
        self.assertEqual(redacted[0][1], "Bearer [REDACTED]")
        self.assertEqual(redacted[1], ("X-K", "v"))

    def test_mask_api_key(self) -> None:
        key = "sk-abcdefghijklmnopqrstuvwxyz012345"
        masked = dkp.mask_api_key(key)
        self.assertEqual(masked[:4], "sk-a")
        self.assertEqual(masked[-4:], "2345")
        self.assertEqual(len(masked), len(key))
        self.assertNotIn(key[4:-4], masked)
        # 短 Key 不能把整把露出来：≤8 位全打星，>8 位保留前后各 4 位
        self.assertEqual(dkp.mask_api_key("sk-1234"), "*******")
        self.assertEqual(dkp.mask_api_key("sk-12345"), "*" * 8)
        self.assertEqual(dkp.mask_api_key("sk-123456"), "sk-1*3456")

    def test_illegal_characters_in_key_are_rejected(self) -> None:
        """控制字符会被原样写进 Authorization 头，DeepSeek 只会回空 body 的 400。"""
        self.assertEqual(dkp._validate_api_key("sk-abc123"), "sk-abc123")
        for bad in ("sk-ab\x0bcd", "sk-ab\x0ccd", "sk-ab\x01cd", "sk-ab\x7fcd", "sk-ab cd", "sk-ab中文"):
            with self.assertRaises(SystemExit, msg=repr(bad)):
                dkp._validate_api_key(bad)


class ProxyIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_root = tempfile.mkdtemp(prefix="dsproxy-test-")
        cls.capture_dir = os.path.join(cls.temp_root, "captures")
        os.makedirs(cls.capture_dir, exist_ok=True)
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        cls.upstream.records = []  # type: ignore[attr-defined]
        cls.upstream_thread = threading.Thread(target=cls.upstream.serve_forever, daemon=True)
        cls.upstream_thread.start()
        cls.proxy = ProxyProcess(cls.upstream.server_address[1], cls.capture_dir)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.proxy.stop()
        cls.upstream.shutdown()
        cls.upstream.server_close()
        shutil.rmtree(cls.temp_root, ignore_errors=True)

    # ---- 转发透明性 ---------------------------------------------------- #

    def test_json_passthrough_and_usage(self) -> None:
        body = b'{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
        markers = {"x-test-case": "json", "x-custom-trace": "abc123"}
        status, headers, data = client_request(self.proxy.port, body=body, headers=markers)
        self.assertEqual(status, 200)
        self.assertEqual(data, json_payload("json", USAGE))
        self.assertEqual(headers.get("x-upstream-header"), "kept")
        self.assertEqual(headers.get("content-type"), "application/json")

        record = find_capture(self.capture_dir, body)
        self.assertTrue(record["usage"]["reported"])
        self.assertEqual(record["usage"]["prompt_tokens"], 11)
        self.assertEqual(record["usage"]["completion_tokens"], 5)
        self.assertEqual(record["usage"]["total_tokens"], 16)
        self.assertEqual(record["usage"]["cache_hit_tokens"], 4)
        self.assertEqual(record["usage"]["cache_miss_tokens"], 7)
        self.assertEqual(record["usage"]["reasoning_tokens"], 2)
        self.assertEqual(record["model"], "deepseek-chat")
        self.assertEqual(record["status"], 200)
        # usage 已上报时不得再记估算值，否则审计数据自相矛盾
        self.assertEqual(record["estimated_completion_tokens"], 0)

        upstream_record = self.upstream.records[-1]  # type: ignore[attr-defined]
        self.assertEqual(upstream_record["body"], body)  # 请求体逐字节一致
        self.assertEqual(upstream_record["headers"]["authorization"], f"Bearer {REAL_KEY}")
        self.assertEqual(upstream_record["headers"]["x-custom-trace"], "abc123")
        self.assertNotIn(CLIENT_KEY, upstream_record["headers"]["authorization"])

    def test_gzip_passthrough_stays_compressed(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"gzip"}'
        status, headers, data = client_request(self.proxy.port, body=body, headers={"x-test-case": "gzip"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("content-encoding"), "gzip")
        self.assertEqual(gzip.decompress(data), json_payload("gzip", USAGE))  # 客户端拿到的仍是 gzip 字节
        record = find_capture(self.capture_dir, body)
        self.assertEqual(record["usage"]["total_tokens"], 16)
        # 审计目录里应有一份解压后的可读文本
        with open(os.path.join(self.capture_dir, record["capture_dir"], "response.txt"), encoding="utf-8") as handle:
            self.assertIn("你好 world", handle.read())

    def test_chunked_response_passthrough(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"chunked"}'
        status, headers, data = client_request(self.proxy.port, body=body, headers={"x-test-case": "chunked"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("transfer-encoding"), "chunked")
        self.assertEqual(data, json_payload("chunked", USAGE))
        record = find_capture(self.capture_dir, body)
        self.assertEqual(record["response_framing"], "chunked")
        self.assertEqual(record["usage"]["total_tokens"], 16)

    def test_close_delimited_response_passthrough(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"close"}'
        status, headers, data = client_request(self.proxy.port, body=body, headers={"x-test-case": "close"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("connection"), "close")
        self.assertEqual(data, json_payload("close", USAGE))
        record = find_capture(self.capture_dir, body)
        self.assertEqual(record["response_framing"], "close")

    def test_streaming_usage_and_verbatim_events(self) -> None:
        body = b'{"model":"deepseek-chat","stream":true,"marker":"stream"}'
        status, headers, data = client_request(self.proxy.port, body=body, headers={"x-test-case": "stream"})
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("content-type"), "text/event-stream")
        self.assertEqual(data, sse_stream(True, "stream"))
        record = find_capture(self.capture_dir, body)
        self.assertTrue(record["stream"])
        self.assertEqual(record["usage"]["total_tokens"], 28)
        self.assertEqual(record["finish_reason"], "stop")

    def test_streaming_without_usage_is_estimated(self) -> None:
        body = b'{"model":"deepseek-chat","stream":true,"marker":"nousage"}'
        status, _, data = client_request(self.proxy.port, body=body, headers={"x-test-case": "stream_no_usage"})
        self.assertEqual(status, 200)
        self.assertEqual(data, sse_stream(False, "stream_no_usage"))
        record = find_capture(self.capture_dir, body)
        self.assertFalse(record["usage"]["reported"])
        self.assertGreater(record["estimated_completion_tokens"], 0)

    def test_error_statuses_are_forwarded_verbatim(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"errors"}'
        status, headers, data = client_request(
            self.proxy.port, body=body, headers={"x-test-case": "error429", "x-keep": "yes"}
        )
        self.assertEqual(status, 429)
        self.assertEqual(data, json.dumps({"error": {"message": "Rate limit reached", "type": "rate_limit_error"}}).encode())
        self.assertEqual(headers.get("retry-after"), "3")
        upstream_record = self.upstream.records[-1]  # type: ignore[attr-defined]
        self.assertEqual(upstream_record["headers"].get("x-keep"), "yes")
        record = find_capture(self.capture_dir, body)
        self.assertEqual(record["status"], 429)
        self.assertFalse(record["usage"]["reported"])
        self.assertEqual(record["error"], "Rate limit reached")

        error_body = b'{"marker":"500"}'
        status, headers, data = client_request(
            self.proxy.port, body=error_body, headers={"x-test-case": "error500"}
        )
        self.assertEqual(status, 500)
        self.assertEqual(data, b"<html><body>boom</body></html>")
        self.assertEqual(headers.get("content-type"), "text/html")
        record = find_capture(self.capture_dir, error_body)
        self.assertEqual(record["status"], 500)

    def test_get_head_and_204(self) -> None:
        status, _, data = client_request(self.proxy.port, method="GET", path="/v1/models", body=None)
        self.assertEqual(status, 200)
        self.assertIn(b"deepseek-chat", data)

        status, headers, data = client_request(self.proxy.port, method="HEAD", path="/v1/models", body=None)
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("content-length"), "42")
        self.assertEqual(data, b"")

        status, headers, data = client_request(
            self.proxy.port, body=b'{"marker":"204"}', headers={"x-test-case": "empty204"}
        )
        self.assertEqual(status, 204)
        self.assertEqual(data, b"")
        self.assertEqual(headers.get("x-empty"), "1")

    def test_upstream_sees_single_correct_host_header(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"host-header"}'
        status, _, _ = client_request(
            self.proxy.port, body=body, headers={"x-test-case": "json"}
        )
        self.assertEqual(status, 200)
        upstream_record = self.upstream.records[-1]  # type: ignore[attr-defined]
        hosts = [value for name, value in upstream_record["header_pairs"] if name == "host"]
        self.assertEqual(len(hosts), 1, f"Host 头必须只有一个，实际 {hosts}")
        self.assertEqual(hosts[0], f"127.0.0.1:{self.upstream.server_address[1]}")

    def test_chunked_request_is_forwarded_as_chunked(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"chunked-request","messages":[]}'
        status, _, data = client_request(
            self.proxy.port, body=body, headers={"x-test-case": "json"}, chunked=True
        )
        self.assertEqual(status, 200)
        self.assertEqual(data, json_payload("json", USAGE))
        upstream_record = self.upstream.records[-1]  # type: ignore[attr-defined]
        self.assertEqual(upstream_record["body"], body)
        self.assertEqual(upstream_record["headers"]["transfer-encoding"], "chunked")
        self.assertTrue(upstream_record["raw_body"].endswith(b"0\r\n\r\n"))

    # ---- 审计与 Key 安全 ----------------------------------------------- #

    def test_capture_files_and_key_never_touches_disk(self) -> None:
        body = b'{"model":"deepseek-chat","marker":"audit"}'
        client_request(self.proxy.port, body=body, headers={"x-test-case": "json"})
        record = find_capture(self.capture_dir, body)
        directory = os.path.join(self.capture_dir, record["capture_dir"])
        for name in ("meta.json", "request.body", "response.body", "response.txt", "request.txt"):
            self.assertTrue(os.path.exists(os.path.join(directory, name)), name)
        with open(os.path.join(directory, "meta.json"), encoding="utf-8") as handle:
            meta = json.load(handle)
        self.assertEqual(meta["state"], "complete")
        self.assertEqual(meta["request_body_sha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(meta["response_body_sha256"], hashlib.sha256(json_payload("json", USAGE)).hexdigest())
        upstream_auth = [v for k, v in meta["upstream_headers"] if k.lower() == "authorization"]
        self.assertEqual(upstream_auth, ["Bearer [REDACTED]"])
        client_auth = [v for k, v in meta["client_headers"] if k.lower() == "authorization"]
        self.assertEqual(client_auth, ["Bearer [REDACTED]"])

        # 整个审计目录与日志里都不允许出现真实 Key
        for root, _dirs, files in os.walk(os.path.join(self.temp_root)):
            for name in files:
                path = os.path.join(root, name)
                with open(path, "rb") as handle:
                    blob = handle.read()
                self.assertNotIn(REAL_KEY.encode(), blob, f"{path} 泄漏了 API Key")
                self.assertNotIn(CLIENT_KEY.encode(), blob, f"{path} 落盘了客户端 Key")

    # ---- 统计与运行状态 ------------------------------------------------- #

    def test_health_endpoint_reports_live_stats(self) -> None:
        status, _, data = client_request(self.proxy.port, method="GET", path=HEALTH_PATH, body=None)
        self.assertEqual(status, 200)
        payload = json.loads(data)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["key_length"], len(REAL_KEY))
        self.assertTrue(payload["key_masked"].startswith(REAL_KEY[:4]))
        self.assertTrue(payload["key_masked"].endswith(REAL_KEY[-4:]))
        middle = REAL_KEY[4:-4]
        self.assertNotIn(middle, payload["key_masked"])
        self.assertNotIn(REAL_KEY, data.decode("utf-8"))
        self.assertGreater(payload["stats"]["requests"], 0)
        self.assertGreater(payload["stats"]["total_tokens"], 0)
        # 健康检查本身不应被计入上游流量
        self.assertNotIn(HEALTH_PATH, [r["path"] for r in self.upstream.records])  # type: ignore[attr-defined]

    def test_summary_and_probe(self) -> None:
        output = self.proxy.output()
        self.assertIn("DeepSeek 本地中转已启动", output)
        self.assertIn("usage=未上报 completion≈", output)

        probe = subprocess.run(
            [
                sys.executable,
                os.path.join(HERE, "deepseek_key_proxy.py"),
                "--probe",
                "--probe-hosts",
                "127.0.0.1",
                "--probe-port",
                str(self.proxy.port),
                "--probe-path",
                "/v1/models",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(probe.returncode, 0, probe.stdout + probe.stderr)
        self.assertIn("base_url = http://127.0.0.1", probe.stdout)


class ClientTokenTests(unittest.TestCase):
    def test_client_token_enforced(self) -> None:
        temp_root = tempfile.mkdtemp(prefix="dsproxy-token-")
        upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeUpstream)
        upstream.records = []  # type: ignore[attr-defined]
        threading.Thread(target=upstream.serve_forever, daemon=True).start()
        proxy = ProxyProcess(
            upstream.server_address[1],
            os.path.join(temp_root, "captures"),
            extra=["--client-token", "local-secret"],
        )
        try:
            os.makedirs(proxy.capture_dir, exist_ok=True)
            status, _, _ = client_request(proxy.port, body=b'{"marker":"denied"}', headers={"x-test-case": "json"})
            self.assertEqual(status, 401)
            status, _, data = client_request(
                proxy.port,
                body=b'{"marker":"allowed"}',
                headers={"x-test-case": "json", "Authorization": "Bearer local-secret"},
            )
            self.assertEqual(status, 200)
            self.assertEqual(data, json_payload("json", USAGE))
        finally:
            proxy.stop()
            upstream.shutdown()
            upstream.server_close()
            shutil.rmtree(temp_root, ignore_errors=True)


class UsageReportTests(unittest.TestCase):
    """用量统计：全部时间 / 最近 24 小时的切分、去重、估算与未完成记录。"""

    @classmethod
    def setUpClass(cls) -> None:
        sys.path.insert(0, HERE)
        import usage_report  # noqa: PLC0415

        cls.report = usage_report
        cls.root = tempfile.mkdtemp(prefix="dsproxy-usage-")
        tz = timezone(timedelta(hours=8))

        def stamp(hours_ago: float) -> str:
            moment = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
            return moment.astimezone(tz).strftime("%Y-%m-%dT%H:%M:%S%z")

        index_lines = []

        def add(name: str, hours_ago: float, meta: Dict[str, Any], body: bytes = b"") -> None:
            directory = os.path.join(cls.root, name)
            os.makedirs(directory, exist_ok=True)
            record = {"started_at": stamp(hours_ago), "capture_dir": name, **meta}
            with open(os.path.join(directory, "meta.json"), "w", encoding="utf-8") as handle:
                json.dump(record, handle, ensure_ascii=False)
            if body:
                with open(os.path.join(directory, "request.body"), "wb") as handle:
                    handle.write(body)
            index_lines.append(record)

        # 48 小时前：窗口外，服务端上报 usage
        add(
            "000001-old",
            48,
            {
                "status": 200,
                "model": "deepseek-chat",
                "state": "complete",
                "response_bytes": 500,
                "usage": {"reported": True, "prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
            },
            body=b'{"model":"deepseek-chat"}',
        )
        # 1 小时前：窗口内，上报 usage
        add(
            "000002-recent",
            1,
            {
                "status": 200,
                "model": "deepseek-flash",
                "state": "complete",
                "response_bytes": 400,
                "usage": {"reported": True, "prompt_tokens": 9, "completion_tokens": 1, "total_tokens": 10},
                # 老版本可能同时写上报 usage 与估算值：统计时不得把它算成"未上报"
                "estimated_completion_tokens": 7,
            },
            body=b'{"model":"deepseek-flash"}',
        )
        # 30 分钟前：窗口内，429 无 usage
        add(
            "000003-error",
            0.5,
            {"status": 429, "model": None, "state": "complete", "error": "Rate limit reached"},
        )
        # 20 分钟前：窗口内，流式无 usage -> 估算
        add(
            "000004-stream",
            0.33,
            {
                "status": 200,
                "model": "deepseek-flash",
                "state": "complete",
                "usage": {"reported": False, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "estimated_completion_tokens": 42,
            },
        )
        # 索引里没有、只有 meta.json 的 in-flight 记录
        add("000005-inflight", 0.2, {"status": None, "state": "in-flight", "model": None})

        with open(os.path.join(cls.root, "index.jsonl"), "w", encoding="utf-8") as handle:
            for record in index_lines:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_timestamp_parsing_variants(self) -> None:
        parse = self.report.parse_timestamp
        self.assertIsNotNone(parse("2026-09-28T21:56:10+0800"))
        self.assertIsNotNone(parse("2026-09-28T13:56:10Z"))
        self.assertIsNotNone(parse("2026-09-28T13:56:10+00:00"))
        self.assertIsNotNone(parse("2026-09-28T13:56:10"))
        self.assertIsNone(parse(""))
        self.assertIsNone(parse(None))
        self.assertIsNone(parse("not-a-time"))
        # +0800 与 Z 的同一时刻应一致
        self.assertEqual(
            parse("2026-09-28T21:56:10+0800"),
            parse("2026-09-28T13:56:10Z"),
        )

    def test_total_and_window_split_with_dedup(self) -> None:
        records, sources = self.report.load_records([self.root])
        self.assertTrue(sources and sources[0].endswith("index.jsonl"))
        # 5 个请求；索引与 meta.json 内容一致，必须去重而不是算两遍
        self.assertEqual(len(records), 5)

        report = self.report.build_report(records, sources, hours=24)
        total = report["total"]
        window = report["window"]

        self.assertEqual(total["requests"], 5)
        self.assertEqual(total["total_tokens"], 160)  # 150（窗口外）+ 10（窗口内）
        self.assertEqual(total["prompt_tokens"], 109)
        self.assertEqual(total["completion_tokens"], 51)
        self.assertEqual(total["request_bytes"], len('{"model":"deepseek-chat"}') + len('{"model":"deepseek-flash"}'))
        self.assertEqual(total["unfinished"], 1)
        self.assertEqual(total["failed"], 1)

        self.assertEqual(window["requests"], 4)  # 48 小时前那条不在窗口内
        self.assertEqual(window["total_tokens"], 10)
        self.assertEqual(window["estimated_responses"], 1)
        self.assertEqual(window["estimated_completion_tokens"], 42)
        self.assertEqual(window["unfinished"], 1)
        self.assertIn("deepseek-chat", total["by_model"])
        self.assertIn("deepseek-flash", total["by_model"])
        self.assertEqual(total["by_model"]["deepseek-chat"]["total"], 150)
        self.assertNotIn("deepseek-chat", window["by_model"])
        self.assertIn("最近 24", report["text"])
        self.assertIn("按小时", report["text"])
        # 输入 / 输出必须分开呈现，而不是只给合计
        self.assertIn("输入 token : 109", report["text"])
        self.assertIn("输出 token : 51", report["text"])
        self.assertIn("合计 token : 160", report["text"])
        chat_line = next(
            line for line in report["text"].splitlines() if line.strip().startswith("deepseek-chat")
        )
        for expected in ("100", "50", "150"):
            self.assertIn(expected, chat_line, chat_line)

    def test_cli_json_output(self) -> None:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = self.report.main([self.root, "--hours", "24", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["record_count"], 5)
        self.assertEqual(payload["window_hours"], 24)
        self.assertEqual(payload["total"]["total_tokens"], 160)

    def test_missing_path_reports_failure(self) -> None:
        buffer = io.StringIO()
        with contextlib.redirect_stderr(buffer):
            code = self.report.main([os.path.join(self.root, "nope")])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
