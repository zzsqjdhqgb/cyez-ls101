#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把一个只存在于你脑子里的 DeepSeek API Key，变成一个本地 OpenAI 兼容端点。

设计约束（按需求逐条实现）：

1. 每次运行由使用者交互式输入 Key；Key 只存在于本进程内存里。
   ── 绝不写磁盘：日志、审计捕获、出错信息里都不会出现 Key（控制台只显示前后各 4 位）；
      注入上游的 Authorization 头在落盘前统一替换为 [REDACTED]。
2. 除"注入身份验证"外，转发不做任何修改：
   - 请求：方法、路径、查询串、请求体字节、请求头（除鉴权头与逐跳头）原样转发，
     请求体是 chunked 时按原始分块字节转发；
   - 响应：状态码、原因短语、响应头（除逐跳头）、响应体字节原样转发，
     非 2xx 一律如实透传，不拦截、不改写、不重试、不审查。
   - 唯一的例外是可选的本机健康检查路径（--health-path，默认关闭）。
3. Token 统计与审计捕获都是"旁路"的：先把字节写给客户端，再拿同一份字节的
   副本做只读解析/落盘。解析或写盘失败只影响统计，绝不影响转发。

只用 Python 标准库。

────────────────────────────────────────────────────────────────────────────
从 Docker 容器里访问（本机 agent 场景）

  A. 代理跑在【宿主机】(推荐，Key 只在你的机器上输入)
     Docker Desktop（Windows/macOS）：容器内用 host.docker.internal 即可，
     实测该名字能打到宿主机的已发布端口，因此默认的 127.0.0.1 绑定通常够用：

         python3 deepseek_key_proxy.py                 # 宿主机
         # 容器内：base_url = http://host.docker.internal:8787/v1

     Linux 宿主（含 WSL2 自建 docker）：宿主机回环地址在容器里不可达，需要
         python3 deepseek_key_proxy.py --lan --client-token <随机串>
         docker run --add-host=host.docker.internal:host-gateway ...
     然后容器内用 http://host.docker.internal:8787/v1。

  B. 代理跑在【容器内】：容器内所有进程用 http://127.0.0.1:8787/v1。

  不确定走哪条路时，在客户端所在环境运行连通性探测（会逐个候选地址试）：

         python3 deepseek_key_proxy.py --probe
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import http.client
import json
import os
import secrets
import signal
import socket
import ssl
import sys
import threading
import time
import zlib
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

__version__ = "1.1.0"

DEFAULT_UPSTREAM = "https://api.deepseek.com"
DEFAULT_PORT = 8787
DEFAULT_CAPTURE_DIR = "proxy-captures"

RELAY_CHUNK_SIZE = 64 * 1024
MAX_JSON_SNIFF_BYTES = 8 * 1024 * 1024
MAX_SSE_LINE_BYTES = 4 * 1024 * 1024
MAX_REQUEST_BODY_BYTES = 256 * 1024 * 1024

# 逐跳头：只对单条连接有意义，不能原样往上游/下游搬。
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "te",
    "trailer",
    "upgrade",
    "expect",
}
# 鉴权头：由本代理接管；客户端送来的同类头一律丢弃，审计落盘时统一打码。
AUTH_HEADERS = {"authorization", "x-api-key", "api-key", "proxy-authorization"}
# Host 由本代理按上游地址重写（HTTP/1.1 只允许一个 Host）。
REWRITTEN_HEADERS = {"host"}
NO_BODY_STATUS = {204, 304}

REDACTED = "[REDACTED]"


class _ProxyError(Exception):
    """请求侧错误（读取请求体失败等），会返回 400 给客户端。"""


# --------------------------------------------------------------------------- #
# chunked 传输编码：只解析，不改写
# --------------------------------------------------------------------------- #


class ChunkedStream:
    """增量解析 HTTP/1.1 chunked 编码，返回解码后的数据并判断流是否结束。

    仅用于统计/落盘/判断边界；转发出去的是原始分块字节，由调用方负责。
    """

    def __init__(self) -> None:
        self._buffer = bytearray()
        self._state = "SIZE"
        self._remaining = 0
        self._done = False

    @property
    def done(self) -> bool:
        return self._done

    def feed(self, data: bytes) -> bytes:
        self._buffer += data
        out = bytearray()
        while not self._done:
            if self._state == "SIZE":
                index = self._buffer.find(b"\r\n")
                if index < 0:
                    if len(self._buffer) > 1024:  # 分块长度行不可能这么长
                        self._done = True
                    break
                line = bytes(self._buffer[:index])
                del self._buffer[: index + 2]
                text = line.split(b";", 1)[0].strip().decode("ascii", "ignore")
                try:
                    size = int(text or "0", 16)
                except ValueError:
                    self._done = True
                    break
                if size == 0:
                    self._state = "TRAILER"
                else:
                    self._remaining = size
                    self._state = "DATA"
            elif self._state == "DATA":
                take = min(self._remaining, len(self._buffer))
                if take:
                    out += self._buffer[:take]
                    del self._buffer[:take]
                    self._remaining -= take
                if self._remaining == 0:
                    self._state = "DATA_CRLF"
                else:
                    break
            elif self._state == "DATA_CRLF":
                if len(self._buffer) < 2:
                    break
                del self._buffer[:2]
                self._state = "SIZE"
            else:  # TRAILER：一直读到空行
                index = self._buffer.find(b"\r\n")
                if index < 0:
                    break
                line = bytes(self._buffer[:index])
                del self._buffer[: index + 2]
                if line == b"":
                    self._done = True
        return bytes(out)


# --------------------------------------------------------------------------- #
# 内容解码与 token 解析（全部只读）
# --------------------------------------------------------------------------- #


class BodyDecoder:
    """按 Content-Encoding 增量解压一份副本；解不开就安静地放弃统计。"""

    def __init__(self, encoding: str) -> None:
        self.encoding = (encoding or "").strip().lower()
        self.broken = False
        self._obj: Optional[Any] = None
        self._raw_deflate = False
        self._first_chunk: Optional[bytes] = None
        self._brotli: Optional[Any] = None
        if self.encoding in ("", "identity"):
            return
        if self.encoding in ("gzip", "x-gzip"):
            self._obj = zlib.decompressobj(16 + zlib.MAX_WBITS)
        elif self.encoding == "deflate":
            self._obj = zlib.decompressobj()  # 规范写法是 zlib 包装
            self._first_chunk = b""
        elif self.encoding == "br":
            try:
                import brotli  # type: ignore

                self._brotli = brotli.Decompressor()
            except Exception:
                self.broken = True
        else:
            self.broken = True

    def decompress(self, data: bytes) -> bytes:
        if self.broken or not data:
            return b""
        if self._brotli is not None:
            try:
                return self._brotli.process(data)
            except Exception:
                self.broken = True
                return b""
        if self._obj is None:
            return data
        if self._first_chunk is not None:  # deflate：兼容裸 deflate 实现
            self._first_chunk += data
            if len(self._first_chunk) < 2:
                return b""
            data = self._first_chunk
            self._first_chunk = None
        try:
            return self._obj.decompress(data)
        except zlib.error:
            if self.encoding == "deflate" and not self._raw_deflate:
                self._raw_deflate = True
                self._obj = zlib.decompressobj(-zlib.MAX_WBITS)
                try:
                    return self._obj.decompress(data)
                except zlib.error:
                    pass
            self.broken = True
            return b""


def decompress_bytes(data: bytes, encoding: str) -> bytes:
    """一次性解压（用于审计落盘时的可读副本）。"""
    decoder = BodyDecoder(encoding)
    out = decoder.decompress(data)
    obj = getattr(decoder, "_obj", None)
    if obj is not None:
        try:
            out += obj.flush()
        except Exception:
            pass
    return out


@dataclass
class Usage:
    """一次响应里由服务端上报的用量；没上报就保持 reported=False。"""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cache_hit_tokens: int = 0
    cache_miss_tokens: int = 0
    reasoning_tokens: int = 0
    reported: bool = False

    def merge(self, other: "Usage") -> None:
        self.prompt_tokens = max(self.prompt_tokens, other.prompt_tokens)
        self.completion_tokens = max(self.completion_tokens, other.completion_tokens)
        self.total_tokens = max(self.total_tokens, other.total_tokens)
        self.cache_hit_tokens = max(self.cache_hit_tokens, other.cache_hit_tokens)
        self.cache_miss_tokens = max(self.cache_miss_tokens, other.cache_miss_tokens)
        self.reasoning_tokens = max(self.reasoning_tokens, other.reasoning_tokens)
        self.reported = self.reported or other.reported

    @property
    def effective_total(self) -> int:
        return self.total_tokens or (self.prompt_tokens + self.completion_tokens)


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    return 0


def usage_from_payload(payload: Any) -> Optional[Usage]:
    """从任意 JSON 载荷里抽取 usage；兼容 DeepSeek 与 OpenAI 两种字段命名。"""
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None
    prompt_details = usage.get("prompt_tokens_details")
    completion_details = usage.get("completion_tokens_details")
    hit = _as_int(usage.get("prompt_cache_hit_tokens"))
    miss = _as_int(usage.get("prompt_cache_miss_tokens"))
    if not hit and not miss and isinstance(prompt_details, dict):
        cached = _as_int(prompt_details.get("cached_tokens"))
        prompt_total = _as_int(usage.get("prompt_tokens"))
        if cached:
            hit = cached
            miss = max(0, prompt_total - cached)
    reasoning = _as_int(usage.get("reasoning_tokens"))
    if not reasoning and isinstance(completion_details, dict):
        reasoning = _as_int(completion_details.get("reasoning_tokens"))
    return Usage(
        prompt_tokens=_as_int(usage.get("prompt_tokens")),
        completion_tokens=_as_int(usage.get("completion_tokens")),
        total_tokens=_as_int(usage.get("total_tokens")),
        cache_hit_tokens=hit,
        cache_miss_tokens=miss,
        reasoning_tokens=reasoning,
        reported=True,
    )


def estimate_tokens(ascii_chars: int, non_ascii_chars: int) -> int:
    """粗略估算 token 数（DeepSeek 经验值：1 英文字符≈0.3，1 中文字符≈0.6）。

    只在服务端没有上报 usage 时使用，日志里始终标为估算值。
    """
    return int(round(max(0, ascii_chars) * 0.3 + max(0, non_ascii_chars) * 0.6))


def used_estimate_tokens(status: Optional[int], analyzer: Optional["ResponseAnalyzer"]) -> int:
    """估算值只有在「2xx 且服务端没有上报 usage」时才是被采用的口径。

    审计记录与逐请求日志共用这一条规则，避免出现「既上报了 usage 又记了估算」
    这种自相矛盾的数据。
    """
    if analyzer is None or status != 200 or analyzer.usage.reported:
        return 0
    return analyzer.estimated_completion_tokens


class ResponseAnalyzer:
    """只读地看一份响应副本：抓 usage / model / 错误信息，顺带估算 token。"""

    def __init__(self, status: int, content_type: str, content_encoding: str) -> None:
        self.status = status
        self.content_type = content_type or ""
        self.stream = "text/event-stream" in self.content_type.lower()
        self._decoder = BodyDecoder(content_encoding)
        self._line_buffer = bytearray()
        self._json_body = bytearray()
        self._json_overflow = False
        self._finished = False
        self.usage = Usage()
        self.model: Optional[str] = None
        self.request_id: Optional[str] = None
        self.error_message: Optional[str] = None
        self.finish_reason: Optional[str] = None
        self.choices = 0
        self.ascii_chars = 0
        self.non_ascii_chars = 0

    # ---- 输入 ---------------------------------------------------------- #

    def feed(self, data: bytes) -> None:
        if self._finished or not data:
            return
        try:
            payload = self._decoder.decompress(data)
        except Exception:
            self._finished = True
            return
        if not payload:
            return
        try:
            if self.stream:
                self._feed_sse(payload)
            else:
                self._feed_json(payload)
        except Exception:
            self._finished = True  # 统计永远不能让转发失败

    def finish(self) -> None:
        if self._finished:
            return
        self._finished = True
        if self.stream or self._json_overflow or not self._json_body:
            return
        try:
            payload = json.loads(bytes(self._json_body).decode("utf-8", "replace"))
        except Exception:
            return
        try:
            self._absorb(payload)
        except Exception:
            pass

    # ---- 内部 ---------------------------------------------------------- #

    def _feed_json(self, payload: bytes) -> None:
        if self._json_overflow:
            return
        self._json_body += payload
        if len(self._json_body) > MAX_JSON_SNIFF_BYTES:
            self._json_overflow = True
            del self._json_body[:]

    def _feed_sse(self, payload: bytes) -> None:
        self._line_buffer += payload
        while True:
            index = self._line_buffer.find(b"\n")
            if index < 0:
                if len(self._line_buffer) > MAX_SSE_LINE_BYTES:
                    del self._line_buffer[: -MAX_SSE_LINE_BYTES // 2]
                return
            line = bytes(self._line_buffer[:index])
            del self._line_buffer[: index + 1]
            line = line.rstrip(b"\r")
            if not line or line.startswith(b":"):
                continue
            if not line.startswith(b"data:"):
                continue
            chunk = line[5:].strip()
            if not chunk or chunk == b"[DONE]":
                continue
            try:
                obj = json.loads(chunk.decode("utf-8", "replace"))
            except Exception:
                continue
            self._absorb(obj)

    def _absorb(self, payload: Any) -> None:
        if not isinstance(payload, dict):
            return
        model = payload.get("model")
        if isinstance(model, str) and model:
            self.model = model
        request_id = payload.get("id")
        if isinstance(request_id, str) and request_id:
            self.request_id = request_id
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message") or error.get("type") or error.get("code")
            if isinstance(message, str) and message:
                self.error_message = message[:400]
        elif isinstance(error, str) and error:
            self.error_message = error[:400]

        usage = usage_from_payload(payload)
        if usage is not None:
            self.usage.merge(usage)

        choices = payload.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                self.choices += 1
                reason = choice.get("finish_reason")
                if isinstance(reason, str) and reason:
                    self.finish_reason = reason
                for key in ("delta", "message"):
                    source = choice.get(key)
                    if not isinstance(source, dict):
                        continue
                    for field_name in ("content", "reasoning_content"):
                        text = source.get(field_name)
                        if isinstance(text, str) and text:
                            self._count_text(text)

    def _count_text(self, text: str) -> None:
        ascii_count = 0
        for char in text:
            if ord(char) < 128:
                ascii_count += 1
        self.ascii_chars += ascii_count
        self.non_ascii_chars += len(text) - ascii_count

    @property
    def estimated_completion_tokens(self) -> int:
        return estimate_tokens(self.ascii_chars, self.non_ascii_chars)


# --------------------------------------------------------------------------- #
# 上游配置
# --------------------------------------------------------------------------- #


@dataclass
class UpstreamConfig:
    scheme: str
    host: str
    port: int
    prefix: str
    timeout: float

    @classmethod
    def parse(cls, url: str, timeout: float) -> "UpstreamConfig":
        parts = urlsplit(url if "://" in url else "https://" + url)
        if parts.scheme not in ("http", "https"):
            raise SystemExit(f"不支持的 upstream 协议：{parts.scheme}")
        if not parts.hostname:
            raise SystemExit(f"无法解析 upstream：{url}")
        port = parts.port or (443 if parts.scheme == "https" else 80)
        prefix = parts.path.rstrip("/")
        return cls(parts.scheme, parts.hostname, port, prefix, timeout)

    @property
    def host_header(self) -> str:
        default_port = 443 if self.scheme == "https" else 80
        return self.host if self.port == default_port else f"{self.host}:{self.port}"

    @property
    def display(self) -> str:
        default_port = 443 if self.scheme == "https" else 80
        suffix = "" if self.port == default_port else f":{self.port}"
        return f"{self.scheme}://{self.host}{suffix}{self.prefix}"

    def connect(self) -> http.client.HTTPConnection:
        if self.scheme == "https":
            return http.client.HTTPSConnection(
                self.host, self.port, timeout=self.timeout, context=ssl.create_default_context()
            )
        return http.client.HTTPConnection(self.host, self.port, timeout=self.timeout)

    def build_target(self, raw_path: str) -> str:
        """把客户端请求行里的 target 拼到 upstream 前缀后面，尽量保持原样。"""
        target = f"{self.prefix}{raw_path}" if raw_path.startswith("/") else raw_path
        if not target.startswith("/"):
            target = "/" + target
        if any(ord(char) > 127 for char in target):
            # http.client 只接受 ASCII 请求行；对非 ASCII 路径做百分号编码，
            # 避免直接把转发打断。
            target = "".join(
                char
                if ord(char) < 128
                else "".join(f"%{byte:02X}" for byte in char.encode("utf-8"))
                for char in target
            )
        return target


# --------------------------------------------------------------------------- #
# 审计捕获：把每个请求与响应原样落盘（Key 永远打码）
# --------------------------------------------------------------------------- #


def redact_headers(headers: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    """审计用：鉴权头一律替换为 [REDACTED]，Key 不会以任何形式落盘。"""
    out: List[Tuple[str, str]] = []
    for name, value in headers:
        if name.lower() in AUTH_HEADERS:
            scheme = value.split(" ", 1)[0] if " " in value else ""
            out.append((name, f"{scheme} {REDACTED}".strip() if scheme else REDACTED))
        else:
            out.append((name, value))
    return out


class CaptureSession:
    """单个请求的审计目录，响应体边转发边落盘。"""

    def __init__(self, directory: str, index_path: str, max_capture_bytes: int, max_text_bytes: int):
        self.directory = directory
        self.index_path = index_path
        self.max_capture_bytes = max_capture_bytes
        self.max_text_bytes = max_text_bytes
        self.request_truncated = False
        self.response_truncated = False
        self.response_bytes = 0
        self._response_file = None
        self._meta: Dict[str, Any] = {}
        self._lock = threading.Lock()

    # ---- 生命周期 ------------------------------------------------------ #

    def open(self, meta: Dict[str, Any]) -> None:
        os.makedirs(self.directory, exist_ok=True)
        self._meta = dict(meta)
        self._meta["state"] = "in-flight"
        self._write_meta()

    def write_request_body(self, body: bytes, path: str = "request.body") -> None:
        if not body:
            return
        data = body
        if len(data) > self.max_capture_bytes:
            data = data[: self.max_capture_bytes]
            self.request_truncated = True
        with open(os.path.join(self.directory, path), "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())

    def open_response_stream(self, path: str = "response.body") -> None:
        self._response_file = open(os.path.join(self.directory, path), "wb")

    def write_response_chunk(self, data: bytes) -> None:
        self.response_bytes += len(data)
        handle = self._response_file
        if handle is None:
            return
        if self.response_bytes > self.max_capture_bytes:
            allowed = len(data) - (self.response_bytes - self.max_capture_bytes)
            if allowed > 0:
                handle.write(data[:allowed])
            if not self.response_truncated:
                self.response_truncated = True
            handle.flush()
            return
        handle.write(data)
        handle.flush()

    def close(self, meta: Dict[str, Any]) -> None:
        if self._response_file is not None:
            try:
                self._response_file.flush()
                os.fsync(self._response_file.fileno())
            except Exception:
                pass
            finally:
                try:
                    self._response_file.close()
                except Exception:
                    pass
                self._response_file = None
        self._meta.update(meta)
        self._meta["state"] = "complete"
        self._meta["request_body_truncated"] = self.request_truncated
        self._meta["response_body_truncated"] = self.response_truncated
        self._write_meta()
        self._write_text_copies()
        self._append_index()

    # ---- 内部 ---------------------------------------------------------- #

    def _write_meta(self) -> None:
        path = os.path.join(self.directory, "meta.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(self._meta, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)

    def _write_text_copies(self) -> None:
        """额外写一份可读文本副本（解压 + UTF-8），便于人工与脚本审计。"""
        encoding = str(self._meta.get("response_content_encoding") or "")
        self._write_text_copy(
            os.path.join(self.directory, "request.body"),
            os.path.join(self.directory, "request.txt"),
            "",
            self._meta.get("request_content_encoding") or "",
        )
        self._write_text_copy(
            os.path.join(self.directory, "response.body"),
            os.path.join(self.directory, "response.txt"),
            encoding,
            "",
        )

    def _write_text_copy(self, source: str, target: str, encoding: str, fallback_encoding: str) -> None:
        if not os.path.exists(source):
            return
        try:
            with open(source, "rb") as handle:
                raw = handle.read(self.max_text_bytes + 1)
        except OSError:
            return
        if not raw:
            return
        truncated = len(raw) > self.max_text_bytes
        if truncated:
            raw = raw[: self.max_text_bytes]
        data = raw
        used_encoding = encoding or fallback_encoding
        if used_encoding:
            try:
                data = decompress_bytes(raw, used_encoding)
            except Exception:
                data = raw
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            return
        try:
            with open(target, "w", encoding="utf-8") as handle:
                handle.write(text)
                if truncated:
                    handle.write("\n…[捕获文本按 --max-capture-text-bytes 截断]\n")
        except OSError:
            return

    def _append_index(self) -> None:
        line = dict(self._meta)
        line["capture_dir"] = os.path.basename(self.directory)
        try:
            with open(self.index_path, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(line, ensure_ascii=False) + "\n")
                handle.flush()
        except OSError:
            return


class CaptureWriter:
    """分配审计目录；关闭时不影响主流程。"""

    def __init__(self, root: str, max_capture_bytes: int, max_text_bytes: int) -> None:
        self.root = os.path.abspath(root)
        self.max_capture_bytes = max_capture_bytes
        self.max_text_bytes = max_text_bytes
        self.index_path = os.path.join(self.root, "index.jsonl")
        self._lock = threading.Lock()
        self._sequence = 0

    def start(self, meta: Dict[str, Any]) -> CaptureSession:
        with self._lock:
            self._sequence += 1
            sequence = self._sequence
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        name = f"{sequence:06d}-{stamp}-{secrets.token_hex(3)}"
        session = CaptureSession(
            os.path.join(self.root, name),
            self.index_path,
            self.max_capture_bytes,
            self.max_text_bytes,
        )
        session.open(meta)
        return session


# --------------------------------------------------------------------------- #
# 统计
# --------------------------------------------------------------------------- #


@dataclass
class _RequestState:
    method: str
    path: str
    status: Optional[int] = None
    stream: bool = False
    model: Optional[str] = None
    request_id: Optional[str] = None
    error: Optional[str] = None
    client_disconnected: bool = False
    response_bytes: int = 0
    capture_dir: Optional[str] = None


class Stats:
    """累计统计 + 逐请求日志；写操作都在锁内，不参与转发决策。"""

    def __init__(
        self,
        log_file: Optional[str],
        quiet: bool,
        summary_every: int,
        capture_dir: Optional[str],
    ) -> None:
        self._lock = threading.Lock()
        self.requests = 0
        self.ok = 0
        self.failures = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.cache_hit_tokens = 0
        self.cache_miss_tokens = 0
        self.reasoning_tokens = 0
        self.reported_responses = 0
        self.estimated_responses = 0
        self.estimated_completion_tokens = 0
        self.request_body_bytes = 0
        self.response_body_bytes = 0
        self.by_model: Dict[str, Dict[str, int]] = {}
        self._quiet = quiet
        self._summary_every = summary_every
        self.capture_dir = capture_dir
        self._handle = None
        if log_file:
            self._handle = open(log_file, "a", encoding="utf-8")

    def close(self) -> None:
        with self._lock:
            if self._handle is not None:
                try:
                    self._handle.flush()
                    self._handle.close()
                finally:
                    self._handle = None

    # ---- 记录 ---------------------------------------------------------- #

    def record(
        self,
        state: _RequestState,
        started: float,
        analyzer: Optional[ResponseAnalyzer],
        request_body_bytes: int = 0,
    ) -> None:
        duration = time.monotonic() - started
        usage = analyzer.usage if analyzer is not None else Usage()
        model = state.model
        request_id = state.request_id
        if analyzer is not None:
            model = model or analyzer.model
            request_id = request_id or analyzer.request_id
        if (
            state.error is None
            and state.status is not None
            and state.status >= 400
            and analyzer is not None
        ):
            state.error = analyzer.error_message or state.error
        estimated = used_estimate_tokens(state.status, analyzer)

        with self._lock:
            self.requests += 1
            if state.error is None and state.status is not None and state.status < 400:
                self.ok += 1
            else:
                self.failures += 1
            if usage.reported:
                self.reported_responses += 1
                self.prompt_tokens += usage.prompt_tokens
                self.completion_tokens += usage.completion_tokens
                self.total_tokens += usage.effective_total
                self.cache_hit_tokens += usage.cache_hit_tokens
                self.cache_miss_tokens += usage.cache_miss_tokens
                self.reasoning_tokens += usage.reasoning_tokens
            if estimated:
                self.estimated_responses += 1
                self.estimated_completion_tokens += estimated
            self.request_body_bytes += request_body_bytes
            self.response_body_bytes += state.response_bytes
            bucket = self.by_model.setdefault(
                model or "(unknown)",
                {"requests": 0, "prompt": 0, "completion": 0, "total": 0, "estimated": 0},
            )
            bucket["requests"] += 1
            bucket["prompt"] += usage.prompt_tokens
            bucket["completion"] += usage.completion_tokens
            bucket["total"] += usage.effective_total
            bucket["estimated"] += estimated

            record = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "method": state.method,
                "path": state.path,
                "status": state.status,
                "duration_ms": round(duration * 1000, 1),
                "stream": state.stream,
                "model": model,
                "request_id": request_id,
                "request_bytes": request_body_bytes,
                "response_bytes": state.response_bytes,
                "usage_reported": usage.reported,
                "prompt_tokens": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "total_tokens": usage.effective_total,
                "cache_hit_tokens": usage.cache_hit_tokens,
                "cache_miss_tokens": usage.cache_miss_tokens,
                "reasoning_tokens": usage.reasoning_tokens,
                "estimated_completion_tokens": estimated,
                "client_disconnected": state.client_disconnected,
                "error": state.error,
                "capture_dir": state.capture_dir,
            }
            if self._handle is not None:
                self._handle.write(json.dumps(record, ensure_ascii=False) + "\n")
                self._handle.flush()
            if not self._quiet:
                print(self._format_line(record), flush=True)
            if self._summary_every and self.requests % self._summary_every == 0:
                print(self.summary(), flush=True)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "requests": self.requests,
                "ok": self.ok,
                "failures": self.failures,
                "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens,
                "total_tokens": self.total_tokens,
                "cache_hit_tokens": self.cache_hit_tokens,
                "cache_miss_tokens": self.cache_miss_tokens,
                "reasoning_tokens": self.reasoning_tokens,
                "usage_reported_responses": self.reported_responses,
                "estimated_responses": self.estimated_responses,
                "estimated_completion_tokens": self.estimated_completion_tokens,
                "request_body_bytes": self.request_body_bytes,
                "response_body_bytes": self.response_body_bytes,
                "by_model": {k: dict(v) for k, v in self.by_model.items()},
            }

    # ---- 展示 ---------------------------------------------------------- #

    @staticmethod
    def _format_line(record: Dict[str, Any]) -> str:
        status = record["status"] if record["status"] is not None else "-"
        parts = [
            time.strftime("%H:%M:%S"),
            f"{status:>3}",
            "stream" if record["stream"] else "      ",
            f"model={record['model'] or '-'}",
            f"{record['duration_ms'] / 1000:.2f}s",
        ]
        if record["usage_reported"]:
            parts.append(
                "prompt={prompt_tokens} completion={completion_tokens} total={total_tokens}"
                " cache_hit={cache_hit_tokens} cache_miss={cache_miss_tokens}"
                " reasoning={reasoning_tokens}".format(**record)
            )
        elif record["estimated_completion_tokens"]:
            parts.append(f"usage=未上报 completion≈{record['estimated_completion_tokens']}（估算）")
        else:
            parts.append("usage=-")
        if record["error"]:
            parts.append(f"error={record['error']}")
        if record["client_disconnected"]:
            parts.append("client_disconnected=1")
        return "  ".join(parts)

    def summary(self) -> str:
        with self._lock:
            lines = [
                "",
                "================ DeepSeek 代理累计统计 ================",
                f"请求：{self.requests}（成功 {self.ok}，失败/非 2xx {self.failures}）",
                f"Token（服务端上报）：prompt {self.prompt_tokens:,} | "
                f"completion {self.completion_tokens:,} | total {self.total_tokens:,}",
                f"缓存：hit {self.cache_hit_tokens:,} | miss {self.cache_miss_tokens:,}"
                f"   推理：reasoning {self.reasoning_tokens:,}",
                f"字节：请求 {self.request_body_bytes:,} | 响应 {self.response_body_bytes:,}",
                f"上报 usage 的响应：{self.reported_responses} 条；"
                f"仅估算的响应：{self.estimated_responses} 条"
                f"（估算 completion ≈ {self.estimated_completion_tokens:,}）",
            ]
            if self.by_model:
                lines.append("按模型：")
                for model, bucket in sorted(self.by_model.items()):
                    lines.append(
                        f"  {model}: {bucket['requests']} 次 | prompt {bucket['prompt']:,} | "
                        f"completion {bucket['completion']:,} | total {bucket['total']:,}"
                        f" | 估算 {bucket['estimated']:,}"
                    )
            if self.capture_dir:
                lines.append(f"审计数据：{self.capture_dir}")
            lines.append("======================================================")
            return "\n".join(lines)


# --------------------------------------------------------------------------- #
# HTTP 代理
# --------------------------------------------------------------------------- #


class ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: Tuple[str, int],
        handler: type,
        config: UpstreamConfig,
        stats: Stats,
        api_key: str,
        client_token: Optional[str],
        capture: Optional[CaptureWriter],
        health_path: Optional[str],
        started_at: float,
    ) -> None:
        super().__init__(address, handler)
        self.config = config
        self.stats = stats
        self.api_key = api_key
        self.client_token = client_token
        self.capture = capture
        self.health_path = health_path
        self.started_at = started_at
        self.key_mask = mask_api_key(api_key)
        self.key_length = len(api_key)


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"DeepSeekKeyProxy/{__version__}"
    sys_version = ""
    timeout = 300  # 客户端连接单次读写超时；上游超时另见 --timeout

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def log_error(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:
        self._proxy()

    def do_POST(self) -> None:
        self._proxy()

    def do_PUT(self) -> None:
        self._proxy()

    def do_PATCH(self) -> None:
        self._proxy()

    def do_DELETE(self) -> None:
        self._proxy()

    def do_OPTIONS(self) -> None:
        self._proxy()

    def do_HEAD(self) -> None:
        self._proxy()

    # ---- 主体 ---------------------------------------------------------- #

    def _proxy(self) -> None:
        server: ProxyServer = self.server  # type: ignore[assignment]
        stats = server.stats

        if self._is_health_request(server):
            self._send_health(server)
            return

        started = time.monotonic()
        state = _RequestState(method=self.command, path=self.path)

        try:
            body, request_framing = self._read_request_body()
        except _ProxyError as exc:
            state.error = str(exc)
            self.close_connection = True
            self._send_local_error(400, str(exc))
            stats.record(state, started, None)
            return

        if server.client_token is not None and not self._client_token_ok(server.client_token):
            state.error = "本地客户端令牌无效"
            self.close_connection = True
            self._send_local_error(401, "invalid local client token")
            stats.record(state, started, None, len(body))
            return

        target = server.config.build_target(self.path)
        client_headers = list(self.headers.items())
        upstream_headers = self._build_request_headers(request_framing)

        capture = self._start_capture(server, state, target, client_headers, upstream_headers, body, request_framing)

        try:
            connection = server.config.connect()
        except Exception as exc:
            state.error = f"连接上游失败：{exc}"
            self.close_connection = True
            self._send_local_error(502, f"upstream connect failed: {exc}")
            self._finish_capture(capture, state, None, 0, None, 0, request_framing, {})
            stats.record(state, started, None, len(body))
            return

        try:
            connection.putrequest(
                self.command, target, skip_host=True, skip_accept_encoding=True
            )
            for name, value in upstream_headers:
                connection.putheader(name, value)
            connection.endheaders()
            if body:
                connection.send(body)
            response = connection.getresponse()
        except Exception as exc:
            state.error = f"上游请求失败：{exc}"
            self.close_connection = True
            try:
                connection.close()
            except Exception:
                pass
            self._send_local_error(502, f"upstream request failed: {exc}")
            self._finish_capture(capture, state, None, 0, None, 0, request_framing, {})
            stats.record(state, started, None, len(body))
            return

        state.status = response.status
        response_headers = response.getheaders()
        content_type = response.getheader("Content-Type") or ""
        content_encoding = response.getheader("Content-Encoding") or ""
        state.stream = "text/event-stream" in content_type.lower()
        state.request_id = None

        body_expected = (
            self.command != "HEAD"
            and response.status not in NO_BODY_STATUS
            and response.status >= 200
        )
        content_length = 0
        framing = "none"
        if body_expected:
            transfer_encoding = (response.getheader("Transfer-Encoding") or "").lower()
            raw_length = response.getheader("Content-Length")
            if "chunked" in transfer_encoding:
                framing = "chunked"
            elif raw_length is not None:
                try:
                    content_length = max(0, int(raw_length))
                    framing = "length"
                except ValueError:
                    framing = "close"
            else:
                framing = "close"

        keep_alive = framing != "close"
        analyzer: Optional[ResponseAnalyzer] = None
        if body_expected:
            analyzer = ResponseAnalyzer(response.status, content_type, content_encoding)

        if capture is not None and framing != "none":
            try:
                capture.open_response_stream()
            except OSError as exc:
                state.error = f"审计落盘失败：{exc}"

        try:
            self._send_response_head(response, framing, keep_alive)
        except (BrokenPipeError, ConnectionResetError):
            state.client_disconnected = True
            self._resolve_error(state, analyzer)
            self._close_upstream(connection, response)
            self._finish_capture(capture, state, analyzer, content_length, framing, 0, request_framing, {"content_type": content_type, "content_encoding": content_encoding})
            stats.record(state, started, analyzer, len(body))
            return

        chunked = ChunkedStream() if framing == "chunked" else None
        relayed = 0
        try:
            while True:
                data = response.fp.read1(RELAY_CHUNK_SIZE) if response.fp else b""
                if not data:
                    break
                if framing == "length" and relayed + len(data) > content_length:
                    data = data[: content_length - relayed]
                    if not data:
                        break
                self.wfile.write(data)
                self.wfile.flush()
                relayed += len(data)
                payload = chunked.feed(data) if chunked is not None else data
                if analyzer is not None and payload:
                    analyzer.feed(payload)
                if capture is not None and payload:
                    try:
                        capture.write_response_chunk(payload)
                    except OSError as exc:
                        state.error = f"审计落盘失败：{exc}"
                if framing == "length" and relayed >= content_length:
                    break
                if chunked is not None and chunked.done:
                    break
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            state.client_disconnected = True
        except socket.timeout:
            state.error = "上游读取超时"
        except Exception as exc:
            state.error = f"转发中断：{exc}"

        state.response_bytes = relayed
        if analyzer is not None:
            analyzer.finish()
        self._resolve_error(state, analyzer)
        self._close_upstream(connection, response)
        if not keep_alive or self.close_connection:
            self.close_connection = True
        self._finish_capture(
            capture,
            state,
            analyzer,
            content_length,
            framing,
            relayed,
            request_framing,
            {
                "content_type": content_type,
                "content_encoding": content_encoding,
                "response_headers": response_headers,
            },
        )
        stats.record(state, started, analyzer, len(body))

    # ---- 审计 ---------------------------------------------------------- #

    @staticmethod
    def _resolve_error(
        state: "_RequestState", analyzer: Optional[ResponseAnalyzer]
    ) -> None:
        """把上游返回体里的错误信息补进 state，供审计与日志使用。"""
        if state.error is not None or analyzer is None or state.status is None:
            return
        if state.status >= 400 and analyzer.error_message:
            state.error = analyzer.error_message

    def _start_capture(
        self,
        server: ProxyServer,
        state: _RequestState,
        target: str,
        client_headers: List[Tuple[str, str]],
        upstream_headers: List[Tuple[str, str]],
        body: bytes,
        request_framing: str,
    ) -> Optional[CaptureSession]:
        if server.capture is None:
            return None
        try:
            session = server.capture.start(
                {
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "client": self.client_address[0] if self.client_address else None,
                    "method": self.command,
                    "path": self.path,
                    "upstream_target": target,
                    "upstream": server.config.display,
                    "request_http_version": self.request_version,
                    "request_transfer_encoding": request_framing,
                    "request_content_encoding": self.headers.get("Content-Encoding"),
                    "client_headers": redact_headers(client_headers),
                    "upstream_headers": redact_headers(upstream_headers),
                    "request_body_sha256": hashlib.sha256(body).hexdigest() if body else None,
                }
            )
            session.write_request_body(body)
            state.capture_dir = os.path.basename(session.directory)
            return session
        except OSError as exc:
            state.error = f"审计落盘失败：{exc}"
            return None

    def _finish_capture(
        self,
        capture: Optional[CaptureSession],
        state: _RequestState,
        analyzer: Optional[ResponseAnalyzer],
        content_length: int,
        framing: str,
        relayed: int,
        request_framing: str,
        extra: Dict[str, Any],
    ) -> None:
        if capture is None:
            return
        usage = analyzer.usage if analyzer is not None else Usage()
        response_body_path = os.path.join(capture.directory, "response.body")
        digest = None
        if os.path.exists(response_body_path):
            hasher = hashlib.sha256()
            try:
                with open(response_body_path, "rb") as handle:
                    for piece in iter(lambda: handle.read(RELAY_CHUNK_SIZE), b""):
                        hasher.update(piece)
                digest = hasher.hexdigest()
            except OSError:
                digest = None
        try:
            capture.close(
                {
                    "finished_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                    "status": state.status,
                    "stream": state.stream,
                    "response_framing": framing,
                    "response_content_length": content_length or None,
                    "response_bytes": relayed,
                    "response_body_sha256": digest,
                    "response_headers": extra.get("response_headers"),
                    "response_content_type": extra.get("content_type"),
                    "response_content_encoding": extra.get("content_encoding"),
                    "model": (analyzer.model if analyzer else None),
                    "request_id": (analyzer.request_id if analyzer else None),
                    "finish_reason": (analyzer.finish_reason if analyzer else None),
                    "usage": {
                        "reported": usage.reported,
                        "prompt_tokens": usage.prompt_tokens,
                        "completion_tokens": usage.completion_tokens,
                        "total_tokens": usage.effective_total,
                        "cache_hit_tokens": usage.cache_hit_tokens,
                        "cache_miss_tokens": usage.cache_miss_tokens,
                        "reasoning_tokens": usage.reasoning_tokens,
                    },
                    "estimated_completion_tokens": used_estimate_tokens(
                        state.status, analyzer
                    ),
                    "error": state.error,
                    "client_disconnected": state.client_disconnected,
                }
            )
        except OSError as exc:
            state.error = state.error or f"审计落盘失败：{exc}"

    # ---- 请求侧 -------------------------------------------------------- #

    def _read_request_body(self) -> Tuple[bytes, str]:
        transfer_encoding = (self.headers.get("Transfer-Encoding") or "").lower()
        if "chunked" in transfer_encoding:
            tracker = ChunkedStream()
            raw = bytearray()
            while not tracker.done:
                piece = self.rfile.read1(RELAY_CHUNK_SIZE)
                if not piece:
                    break
                raw += piece
                tracker.feed(bytes(piece))
                if len(raw) > MAX_REQUEST_BODY_BYTES:
                    raise _ProxyError("请求体超过上限")
            return bytes(raw), "chunked"
        raw_length = self.headers.get("Content-Length")
        if raw_length is not None:
            try:
                length = int(raw_length)
            except ValueError:
                raise _ProxyError("Content-Length 无效")
            if length < 0:
                raise _ProxyError("Content-Length 无效")
            if length > MAX_REQUEST_BODY_BYTES:
                raise _ProxyError("请求体超过上限")
            body = bytearray()
            while len(body) < length:
                piece = self.rfile.read(length - len(body))
                if not piece:
                    break
                body += piece
            return bytes(body), "length"
        return b"", "none"

    def _build_request_headers(self, framing: str) -> List[Tuple[str, str]]:
        server: ProxyServer = self.server  # type: ignore[assignment]
        headers: List[Tuple[str, str]] = []
        for name, value in self.headers.items():
            lower = name.lower()
            if lower in AUTH_HEADERS:
                continue  # 真实 Key 由本代理注入
            if lower in REWRITTEN_HEADERS:
                continue  # Host 由本代理按上游地址重写
            if lower in HOP_BY_HOP_HEADERS:
                continue  # Expect/Connection 等只在单条连接内有意义
            headers.append((name, value))
        if framing == "none":
            headers = [
                (n, v)
                for n, v in headers
                if n.lower() not in ("content-length", "transfer-encoding")
            ]
        headers.append(("Host", server.config.host_header))
        headers.append(("Authorization", f"Bearer {server.api_key}"))
        headers.append(("Connection", "close"))  # 上游一请求一连接
        return headers

    def _client_token_ok(self, expected: str) -> bool:
        supplied = self.headers.get("Authorization") or ""
        if supplied.lower().startswith("bearer "):
            supplied = supplied[7:].strip()
        if not supplied:
            supplied = (self.headers.get("x-api-key") or "").strip()
        return supplied == expected

    # ---- 响应侧 -------------------------------------------------------- #

    def _send_response_head(
        self, response: http.client.HTTPResponse, framing: str, keep_alive: bool
    ) -> None:
        self.send_response_only(response.status, response.reason)
        for name, value in response.getheaders():
            lower = name.lower()
            if lower in HOP_BY_HOP_HEADERS:
                continue
            if lower == "content-length" and framing in ("chunked", "close"):
                continue
            if lower == "transfer-encoding" and framing != "chunked":
                continue
            self.send_header(name, value)
        if not keep_alive or self.close_connection:
            # 客户端要求关闭（HTTP/1.0 或 Connection: close），或上游没有可界定的长度：
            # 如实告诉客户端这条连接会关闭。
            self.close_connection = True
            self.send_header("Connection", "close")
        else:
            self.send_header("Connection", "keep-alive")
        self.end_headers()

    def _send_local_error(self, status: int, message: str) -> None:
        payload = json.dumps(
            {"error": {"message": message, "type": "proxy_error"}}, ensure_ascii=False
        ).encode("utf-8")
        try:
            self.send_response_only(status, "Proxy Error")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    @staticmethod
    def _close_upstream(
        connection: http.client.HTTPConnection, response: http.client.HTTPResponse
    ) -> None:
        try:
            response.close()
        except Exception:
            pass
        try:
            connection.close()
        except Exception:
            pass

    # ---- 健康检查（唯一的本地路径，默认关闭） --------------------------- #

    def _is_health_request(self, server: ProxyServer) -> bool:
        if not server.health_path:
            return False
        if self.command not in ("GET", "HEAD"):
            return False
        return self.path.split("?", 1)[0] == server.health_path

    def _send_health(self, server: ProxyServer) -> None:
        payload = json.dumps(
            {
                "status": "ok",
                "version": __version__,
                "uptime_seconds": round(time.monotonic() - server.started_at, 1),
                "upstream": server.config.display,
                "key_masked": server.key_mask,
                "key_length": server.key_length,
                "capture_dir": server.capture.root if server.capture else None,
                "stats": server.stats.snapshot(),
            },
            ensure_ascii=False,
            indent=2,
        ).encode("utf-8")
        try:
            self.send_response_only(200, "OK")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        self.close_connection = True


# --------------------------------------------------------------------------- #
# 连通性探测（在客户端所在环境运行）
# --------------------------------------------------------------------------- #


def _default_gateway() -> Optional[str]:
    """Linux 容器里读 /proc/net/route 得到默认网关（docker 桥接地址）。"""
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as handle:
            next(handle)
            for line in handle:
                fields = line.split()
                if len(fields) >= 3 and fields[1] == "00000000":
                    value = int(fields[2], 16)
                    return ".".join(
                        str((value >> shift) & 0xFF) for shift in (0, 8, 16, 24)
                    )
    except Exception:
        return None
    return None


def _candidate_probe_hosts(explicit: Optional[List[str]]) -> List[str]:
    if explicit:
        return explicit
    candidates = ["127.0.0.1", "localhost", "host.docker.internal"]
    gateway = _default_gateway()
    if gateway and gateway not in candidates:
        candidates.append(gateway)
    for name in ("docker.for.mac.host.internal", "gateway.docker.internal"):
        if name not in candidates:
            candidates.append(name)
    return candidates


def _probe_one(
    host: str, port: int, path: str, token: Optional[str], timeout: float
) -> Tuple[Optional[int], str, Dict[str, str], bytes]:
    """对某个候选地址发一次真实 HTTP 请求；连接失败时 status 为 None。"""
    headers = {"Connection": "close"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        body = response.read(4096)
        return response.status, response.reason, {k.lower(): v for k, v in response.getheaders()}, body
    finally:
        connection.close()


def run_probe(args: argparse.Namespace) -> int:
    hosts = _candidate_probe_hosts(args.probe_hosts)
    port = args.probe_port or args.port
    probe_path = args.probe_path
    token = args.probe_token or args.client_token
    needs_token = False
    print(f"探测本地 DeepSeek 代理：端口 {port}，候选地址 {len(hosts)} 个")
    reachable: List[str] = []
    for host in hosts:
        label = f"{host}:{port}"
        try:
            status, reason, _headers, body = _probe_one(host, port, probe_path, token, args.probe_timeout)
        except OSError as exc:
            print(f"  ✗ {label:<34} {type(exc).__name__}: {exc}")
            continue
        preview = body[:160].decode("utf-8", "replace").replace("\n", " ")
        print(f"  ✓ {label:<34} HTTP/1.1 {status} {reason}")
        if preview:
            print(f"      {preview}")
        if "invalid local client token" in preview:
            needs_token = True
        reachable.append(host)

    print()
    if reachable:
        best = "host.docker.internal" if "host.docker.internal" in reachable else reachable[0]
        print("可用配置：")
        for host in reachable:
            print(f"  base_url = http://{host}:{port}/v1")
        print(f"建议（容器内）：base_url = http://{best}:{port}/v1 ，api_key 填任意非空值。")
        if needs_token:
            print("注意：代理启用了 --client-token，上面的 api_key 要填同一个令牌；")
            print("      探测时用 --probe-token <令牌>（或直接复用 --client-token）再确认一次。")
        else:
            print("若返回 401 且 body 里是 DeepSeek 的 authentication_error，说明链路已通、Key 无效。")
        return 0
    print("全部候选地址都不可达。排查顺序：")
    print("  1) 代理是否正在运行（宿主机上应打印出启动横幅）；")
    print("  2) 若代理跑在宿主机：Windows/macOS 用 host.docker.internal；")
    print("     Linux 需要 --lan 让代理绑定 0.0.0.0，并给容器加")
    print("     --add-host=host.docker.internal:host-gateway；")
    print("  3) 宿主机防火墙是否放行了该端口；")
    print("  4) 端口是否被其它程序占用（看代理横幅里的实际监听地址）。")
    return 1


# --------------------------------------------------------------------------- #
# 启动
# --------------------------------------------------------------------------- #


def _configure_output() -> None:
    """控制台输出兜底：非交互输出统一按 UTF-8，且任何情况下都不因编码报错。

    Windows 上把输出重定向到文件时默认是 cp936，横幅里的 ⚠ / ≈ 会触发
    UnicodeEncodeError；这里既换编码也把错误降级为替换字符。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            if not stream.isatty():
                stream.reconfigure(encoding="utf-8")
            stream.reconfigure(errors="replace")
        except Exception:
            pass


def _parse_args(argv: Optional[List[str]]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="deepseek_key_proxy.py",
        description=(
            "本地 DeepSeek API 中转：注入真实 Key，原样转发请求与响应，"
            "只读统计 token，并把每个请求/响应完整落盘做审计。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例：\n"
            "  python3 deepseek_key_proxy.py                     # 交互输入 Key，默认 127.0.0.1:8787\n"
            "  python3 deepseek_key_proxy.py --lan --client-token s3cret   # 供容器/局域网访问\n"
            "  python3 deepseek_key_proxy.py --health-path /__proxy/health\n"
            "  python3 deepseek_key_proxy.py --probe             # 在客户端环境探测连通性\n"
            "\n客户端：base_url=http://<host>:8787/v1 ，api_key 填任意非空值。\n"
        ),
    )
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument(
        "--lan",
        action="store_true",
        help="等价于 --host 0.0.0.0（供 Docker 容器/局域网访问，建议同时设 --client-token）",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}）")
    parser.add_argument(
        "--upstream",
        default=DEFAULT_UPSTREAM,
        help=f"上游 base URL（默认 {DEFAULT_UPSTREAM}；路径原样拼在后面）",
    )
    parser.add_argument("--key-env", metavar="VAR", help="从该环境变量读取 Key（用于自动化）")
    parser.add_argument("--key-stdin", action="store_true", help="从标准输入读一行作为 Key")
    parser.add_argument(
        "--client-token",
        metavar="TOKEN",
        help="可选：要求本地客户端也带 Bearer TOKEN（--lan 时强烈建议设置）",
    )
    parser.add_argument("--timeout", type=float, default=600.0, help="上游读写超时秒数（默认 600）")
    parser.add_argument(
        "--capture-dir",
        default=DEFAULT_CAPTURE_DIR,
        metavar="DIR",
        help=f"审计数据目录（默认 ./{DEFAULT_CAPTURE_DIR}）",
    )
    parser.add_argument("--no-capture", action="store_true", help="关闭审计捕获（只统计 token）")
    parser.add_argument(
        "--max-capture-bytes",
        type=int,
        default=64 * 1024 * 1024,
        metavar="N",
        help="单个请求/响应最多落盘多少字节（默认 64 MiB，超出截断并标记）",
    )
    parser.add_argument(
        "--max-capture-text-bytes",
        type=int,
        default=32 * 1024 * 1024,
        metavar="N",
        help="可读文本副本（response.txt/request.txt）的上限（默认 32 MiB）",
    )
    parser.add_argument("--log-file", metavar="PATH", help="额外把逐请求统计以 JSONL 追写到该文件")
    parser.add_argument("--quiet", action="store_true", help="只打印启动信息和退出汇总")
    parser.add_argument(
        "--summary-every",
        type=int,
        default=0,
        metavar="N",
        help="每 N 个请求追加打印一次累计汇总（默认 0=只在退出时打印）",
    )
    parser.add_argument(
        "--health-path",
        metavar="PATH",
        help="可选：在这个本地路径上返回运行状态与实时统计（默认关闭，该路径不转发上游）",
    )
    parser.add_argument("--probe", action="store_true", help="只做连通性探测，不启动代理")
    parser.add_argument(
        "--probe-hosts",
        nargs="*",
        metavar="HOST",
        help="探测用的候选主机（默认 127.0.0.1 / localhost / host.docker.internal / 默认网关）",
    )
    parser.add_argument("--probe-port", type=int, help="探测端口（默认与 --port 相同）")
    parser.add_argument("--probe-path", default="/v1/models", help="探测用路径（默认 /v1/models）")
    parser.add_argument(
        "--probe-token",
        metavar="TOKEN",
        help="探测时携带的本地客户端令牌（默认复用 --client-token）",
    )
    parser.add_argument("--probe-timeout", type=float, default=4.0, help="探测超时秒数（默认 4）")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser.parse_args(argv)


def mask_api_key(key: str, keep: int = 4) -> str:
    """展示用掩码：前 4 位 + 中间打星 + 后 4 位（长度保持真实，便于发现粘贴错位）。

    只用于控制台横幅与健康检查展示。任何落盘内容（日志、审计捕获）里，
    鉴权头一律是 [REDACTED]，不受本函数影响。
    """
    if len(key) <= keep * 2:
        return "*" * len(key)
    return f"{key[:keep]}{'*' * (len(key) - keep * 2)}{key[-keep:]}"


def _validate_api_key(key: str) -> str:
    """Key 必须是可打印 ASCII。

    这不是洁癖：`http.client` 只拒绝 `\\n` 和 `\\r`，其余控制字符（实测 \\x0b、\\x0c、
    \\x01、\\x7f）会被原样写进 Authorization 头，DeepSeek 边缘节点只会回一个
    **空 body 的 400 Bad Request** —— 看起来像网络问题，极难排查。
    从网页或聊天窗口复制 Key 时非常容易带进这类不可见字符。
    """
    offenders = [
        (index, char) for index, char in enumerate(key) if not (0x21 <= ord(char) <= 0x7E)
    ]
    if offenders:
        detail = "、".join(
            f"第 {index + 1} 个字符 U+{ord(char):04X}"
            + ("（控制字符）" if ord(char) < 0x20 or ord(char) == 0x7F else "（非 ASCII）")
            for index, char in offenders[:5]
        )
        more = "" if len(offenders) <= 5 else f"，另有 {len(offenders) - 5} 个"
        raise SystemExit(
            f"API Key 含非法字符：{detail}{more}。\n"
            "这类字符会被原样塞进 HTTP 头，DeepSeek 只会回一个空 body 的 400，"
            "看起来像网络故障。\n"
            "请重新复制 Key（建议用 API 控制台的复制按钮，或手工输入），再启动本代理。"
        )
    return key


def _load_api_key(args: argparse.Namespace) -> str:
    if args.key_env:
        key = (os.environ.get(args.key_env) or "").strip()
        if not key:
            raise SystemExit(f"环境变量 {args.key_env} 为空")
        return _validate_api_key(key)
    if args.key_stdin:
        key = sys.stdin.readline().strip()
        if not key:
            raise SystemExit("标准输入没有读到 API Key")
        return _validate_api_key(key)
    if sys.stdin.isatty():
        try:
            key = getpass.getpass("请输入 DeepSeek API Key（不回显，仅保存在本进程内存）: ").strip()
        except (EOFError, KeyboardInterrupt):
            raise SystemExit("\n已取消")
        if not key:
            raise SystemExit("API Key 不能为空")
        return _validate_api_key(key)
    raise SystemExit(
        "标准输入不是终端：请用 --key-stdin 通过管道传入，或用 --key-env 指定环境变量名"
    )


def _local_addresses() -> List[str]:
    """本机非回环 IPv4 地址（用于打印可供其它主机/容器使用的地址）。"""
    addresses: List[str] = []
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for info in infos:
            address = info[4][0]
            if address not in addresses and not address.startswith("127."):
                addresses.append(address)
    except Exception:
        pass
    return addresses


def _prepare_capture(args: argparse.Namespace) -> Optional[CaptureWriter]:
    if args.no_capture:
        return None
    root = os.path.abspath(args.capture_dir)
    try:
        os.makedirs(root, exist_ok=True)
    except OSError as exc:
        if args.capture_dir != DEFAULT_CAPTURE_DIR:
            raise SystemExit(f"无法创建审计目录 {root}：{exc}")
        print(f"⚠ 无法创建审计目录 {root}（{exc}），本次不捕获请求/响应数据。")
        return None
    return CaptureWriter(root, args.max_capture_bytes, args.max_capture_text_bytes)


def main(argv: Optional[List[str]] = None) -> int:
    _configure_output()
    args = _parse_args(argv)
    if args.probe:
        return run_probe(args)

    api_key = _load_api_key(args)
    config = UpstreamConfig.parse(args.upstream, args.timeout)
    if args.summary_every < 0:
        raise SystemExit("--summary-every 不能为负数")
    if args.max_capture_bytes <= 0 or args.max_capture_text_bytes <= 0:
        raise SystemExit("捕获上限必须为正数")
    if args.lan:
        args.host = "0.0.0.0"

    capture = _prepare_capture(args)
    stats = Stats(args.log_file, args.quiet, args.summary_every, capture.root if capture else None)
    started_at = time.monotonic()
    try:
        server = ProxyServer(
            (args.host, args.port),
            ProxyHandler,
            config=config,
            stats=stats,
            api_key=api_key,
            client_token=args.client_token,
            capture=capture,
            health_path=args.health_path,
            started_at=started_at,
        )
    except OSError as exc:
        raise SystemExit(f"无法监听 {args.host}:{args.port} — {exc}")

    host, port = server.server_address[0], server.server_address[1]
    loopback = host in ("127.0.0.1", "::1", "localhost")
    print("DeepSeek 本地中转已启动")
    print(f"  上游         : {config.display}")
    print(
        f"  Key           : {server.key_mask}"
        f"（长度 {server.key_length}，前 4 后 4 位；完整 Key 只在内存，绝不写盘）"
    )
    print(f"  审计数据      : {capture.root if capture else '已关闭（--no-capture）'}")
    if capture:
        print(f"  审计索引      : {capture.index_path}")
    if args.log_file:
        print(f"  统计日志      : {args.log_file}")
    if args.health_path:
        print(f"  健康检查      : GET http://127.0.0.1:{port}{args.health_path}（不转发上游）")
    print("  客户端配置     : base_url = http://<下面任一地址>:%d/v1 ，api_key = %s" % (
        port,
        args.client_token if args.client_token else "任意非空值",
    ))
    print(f"    · 本机/容器内 : http://127.0.0.1:{port}/v1")
    print(f"    · Docker 容器 : http://host.docker.internal:{port}/v1")
    if loopback:
        print("                    （Docker Desktop 可直接用；Linux 宿主需改用 --lan）")
    else:
        for address in _local_addresses():
            print(f"    · 其它主机    : http://{address}:{port}/v1")
        gateway = _default_gateway()
        if gateway:
            print(f"    · Docker 网关 : http://{gateway}:{port}/v1（Linux 容器里可试这个）")
        print("  ⚠ 已绑定非回环地址：任何能访问该端口的人都能消耗你的 Key。")
        if not args.client_token:
            print("     建议加 --client-token <随机串>，容器侧用同一个串做 api_key。")
    probe_hint = f"--probe --probe-token {args.client_token}" if args.client_token else "--probe"
    print(f"  连通性探测     : python3 deepseek_key_proxy.py {probe_hint}  （在客户端所在环境运行）")
    print("  按 Ctrl-C 退出并打印累计统计。")
    print()
    sys.stdout.flush()  # stdout 被重定向到文件时也要立刻可见

    stopping = threading.Event()

    def _request_stop(signum: int, frame: Any) -> None:
        if stopping.is_set():
            return
        stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    previous_int = signal.signal(signal.SIGINT, _request_stop)
    previous_term = signal.signal(signal.SIGTERM, _request_stop)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGINT, previous_int)
        signal.signal(signal.SIGTERM, previous_term)
        server.server_close()
        print(stats.summary())
        stats.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
