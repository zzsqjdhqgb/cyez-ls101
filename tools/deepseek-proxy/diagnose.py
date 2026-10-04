#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DeepSeek 链路诊断：在**运行代理的那台机器**上跑，分清 400/401 到底出在哪一环。

它做三件事，全程不把 Key 完整打印出来（只显示长度、是否纯 ASCII、掩码形式）：

  A. 绕过本地代理，直连 https://api.deepseek.com —— 测「Key + 这台机器的出网链路」；
  B. 走本地代理 http://127.0.0.1:<port> —— 测「代理本身」；
  C. 若 A 成功，再直连发一次最小 chat/completions，确认 Key 真能出 token。

并会检查两个最常见的本机干扰源：
  * 系统/环境变量里的 HTTP(S)_PROXY、ALL_PROXY（curl 会走、http.client 不走）；
  * Clash/Mihomo 之类 TUN 模式的 fake-IP 网卡（198.18.0.0/15、fdfe:dcba:9876::/…）。

用法：
    python3 tools/deepseek-proxy/diagnose.py                 # 交互输入 Key
    python3 tools/deepseek-proxy/diagnose.py --client-token s3cret
"""

from __future__ import annotations

import argparse
import getpass
import http.client
import json
import os
import socket
import ssl
import sys
from typing import Any, Dict, List, Optional, Tuple

UPSTREAM_HOST = "api.deepseek.com"

# 真实 DeepSeek 边缘（EdgeOne + openresty）会带的头；缺这些基本可以断定
# 响应不是 API 本体给的。
DEEPSEEK_EDGE_MARKERS = ("eo-log-uuid", "eo-cache-status", "strict-transport-security", "date")


def _load_key(args: argparse.Namespace) -> str:
    if args.key_env:
        key = (os.environ.get(args.key_env) or "").strip()
        if key:
            return key
        raise SystemExit(f"环境变量 {args.key_env} 为空")
    if args.key_stdin:
        key = sys.stdin.readline().strip()
        if key:
            return key
        raise SystemExit("标准输入没有读到 Key")
    if sys.stdin.isatty():
        key = getpass.getpass("请输入 DeepSeek API Key（不回显，仅用于本次诊断）: ").strip()
        if key:
            return key
        raise SystemExit("API Key 不能为空")
    raise SystemExit("标准输入不是终端：请用 --key-stdin 或 --key-env")


def _describe_key(key: str) -> str:
    """Key 字符级体检：只显示前后各 4 位，中间打星（与代理横幅口径一致）。"""
    if len(key) <= 8:
        masked = "*" * len(key) + f"（长度 {len(key)}）"
    else:
        masked = f"{key[:4]}{'*' * (len(key) - 8)}{key[-4:]}（长度 {len(key)}）"
    ascii_only = all(ord(char) < 128 for char in key)
    quotes = key[:1] in ("'", '"') or key[-1:] in ("'", '"')
    # 控制字符是最阴的坑：http.client 只拦 \n 和 \r，其余会被原样写进 Authorization 头，
    # DeepSeek 边缘只会回一个空 body 的 400，看起来完全像网络故障。
    offenders = [
        f"第{i + 1}个=U+{ord(char):04X}"
        for i, char in enumerate(key)
        if not (0x21 <= ord(char) <= 0x7E)
    ]
    lines = [f"{masked}  纯ASCII={ascii_only}  带引号={quotes}"]
    if offenders:
        lines.append("  非法字符 : " + "、".join(offenders[:8]))
        lines.append(
            "  ⚠ 这些不可见字符会被原样塞进 HTTP 头，DeepSeek 会回空 body 的 400。"
            "请重新复制 Key。"
        )
    return "\n  ".join(lines)


def _masked_headers(headers: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    out = []
    for name, value in headers:
        if name.lower() in ("authorization", "x-api-key", "api-key", "proxy-authorization"):
            out.append((name, "Bearer [REDACTED]"))
        else:
            out.append((name, value))
    return out


def _request(
    scheme: str,
    host: str,
    port: int,
    method: str,
    path: str,
    headers: Dict[str, str],
    body: Optional[bytes] = None,
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """最小化的一次请求，返回状态、响应头、body 或错误，绝不抛出。"""
    result: Dict[str, Any] = {"ok": False, "request_headers": _masked_headers(list(headers.items()))}
    connection: Any = None
    try:
        if scheme == "https":
            connection = http.client.HTTPSConnection(
                host, port, timeout=timeout, context=ssl.create_default_context()
            )
        else:
            connection = http.client.HTTPConnection(host, port, timeout=timeout)
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read(65536)
        result.update(
            {
                "ok": True,
                "status": response.status,
                "reason": response.reason,
                "headers": [(k, v) for k, v in response.getheaders()],
                "body": data,
            }
        )
    except Exception as exc:  # noqa: BLE001 - 诊断工具就是要报告任何失败
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            if connection is not None:
                connection.close()
        except Exception:
            pass
    return result


def _print_result(title: str, result: Dict[str, Any]) -> None:
    print(f"\n=== {title} ===")
    print("  请求头:", json.dumps(result["request_headers"], ensure_ascii=False))
    if not result.get("ok"):
        print("  结果  : 连接/请求失败 ->", result.get("error"))
        return
    print(f"  结果  : HTTP {result['status']} {result['reason']}")
    print("  响应头:")
    for name, value in result["headers"]:
        print(f"    {name}: {value}")
    body = result["body"]
    preview = body[:400].decode("utf-8", "replace")
    print(f"  Body  : {preview!r}")
    if result["status"] >= 400:
        names = {name.lower() for name, _ in result["headers"]}
        missing = [marker for marker in DEEPSEEK_EDGE_MARKERS if marker not in names]
        if missing:
            print("  ⚠ 缺少真实 DeepSeek 边缘必带的响应头:", ", ".join(missing))
            print("    → 这个响应很可能不是 api.deepseek.com 本体发出的，而是中途的代理软件/网关伪造的。")
        else:
            print("  → 响应头看起来确实来自 DeepSeek 边缘，说明是 Key 或账号侧的问题。")


def _tls_diagnostics(key: str, timeout: float) -> None:
    """绕过 http.client，手写一条 HTTP/1.1 请求，并检查 DNS/证书/出口地址。

    这一段能区分三种情况：
      * DNS 解析到 198.18.x（TUN fake-IP）→ 本机代理软件在 IP 层接管流量；
      * 证书颁发者是本地/企业 CA → 存在 TLS 中间人；
      * 手写请求成功但 http.client 失败（或反之）→ 问题出在请求内容而非链路。
    """
    print("\n=== D. DNS / 证书 / 手写 TLS 请求（绕过 http.client） ===")
    try:
        infos = socket.getaddrinfo(UPSTREAM_HOST, 443, proto=socket.IPPROTO_TCP)
        ips = sorted({info[4][0] for info in infos})
        print("  DNS 解析  :", ", ".join(ips))
        fake = [ip for ip in ips if _looks_like_tun(ip)]
        if fake:
            print(f"  ⚠ 解析到 fake-IP 段 {', '.join(fake)}：Clash/Mihomo 等 TUN 模式正在接管出网流量。")
    except Exception as exc:  # noqa: BLE001
        print("  DNS 解析  : 失败 ->", f"{type(exc).__name__}: {exc}")

    context = ssl.create_default_context()
    tls: Any = None
    try:
        plain = socket.create_connection((UPSTREAM_HOST, 443), timeout=timeout)
        print(f"  出口地址  : {plain.getsockname()[0]}:{plain.getsockname()[1]} → {plain.getpeername()[0]}:443")
        tls = context.wrap_socket(plain, server_hostname=UPSTREAM_HOST)
        cert = tls.getpeercert() or {}
        issuer = dict(item[0] for item in cert.get("issuer", ()))
        subject = dict(item[0] for item in cert.get("subject", ()))
        print("  证书颁发者:", json.dumps(issuer, ensure_ascii=False))
        print("  证书主体  :", json.dumps(subject, ensure_ascii=False), "有效期至", cert.get("notAfter"))
        org = (issuer.get("organizationName") or "").lower()
        if any(word in org for word in ("clash", "surge", "mitm", "proxy", "local", "test")):
            print("  ⚠ 证书颁发者像本地/代理 CA：TLS 被中间人解开了，请求内容可能已被改写。")

        request = (
            f"GET /v1/models HTTP/1.1\r\n"
            f"Host: {UPSTREAM_HOST}\r\n"
            f"Authorization: Bearer {key}\r\n"
            f"Connection: close\r\n\r\n"
        ).encode("utf-8")
        tls.sendall(request)
        received = bytearray()
        while len(received) < 65536:
            piece = tls.recv(4096)
            if not piece:
                break
            received += piece
        head, _, body = bytes(received).partition(b"\r\n\r\n")
        lines = head.decode("latin-1", "replace").split("\r\n")
        print("  状态行    :", lines[0] if lines else "（无响应）")
        for line in lines[1:]:
            print("   ", line)
        print("  Body      :", body[:300])
    except Exception as exc:  # noqa: BLE001
        print("  手写请求  : 失败 ->", f"{type(exc).__name__}: {exc}")
    finally:
        try:
            if tls is not None:
                tls.close()
        except Exception:
            pass


def _env_proxies() -> List[str]:
    names = [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
        "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    ]
    return [f"{name}={os.environ[name]}" for name in names if os.environ.get(name)]


def _local_ipv4() -> List[str]:
    addresses: List[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            address = info[4][0]
            if address not in addresses:
                addresses.append(address)
    except Exception:
        pass
    return addresses


def _looks_like_tun(address: str) -> bool:
    return address.startswith("198.18.") or address.startswith("198.19.")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DeepSeek 链路诊断（Key 只在本进程内存里）")
    parser.add_argument("--proxy", default="http://127.0.0.1:8787", help="本地代理地址（默认 http://127.0.0.1:8787）")
    parser.add_argument("--client-token", help="本地代理要求的 --client-token")
    parser.add_argument("--key-env", metavar="VAR", help="从环境变量读 Key")
    parser.add_argument("--key-stdin", action="store_true", help="从标准输入读一行 Key")
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    key = _load_key(args)
    print("DeepSeek 链路诊断")
    print("  Key 特征 :", _describe_key(key))

    proxies = _env_proxies()
    print("  环境代理 :", ", ".join(proxies) if proxies else "（无）")
    addresses = _local_ipv4()
    tun = [address for address in addresses if _looks_like_tun(address)]
    print("  本机 IPv4:", ", ".join(addresses) if addresses else "（未取到）")
    if tun:
        print(f"  ⚠ 检测到 TUN/fake-IP 网卡地址 {', '.join(tun)}：")
        print("     Clash/Mihomo 等 TUN 模式会在 IP 层接管出网流量，")
        print("     即使代码直连也可能被改写或拦截。请先临时关闭它再复测。")

    direct_headers = {"Authorization": f"Bearer {key}", "Connection": "close"}
    direct = _request("https", UPSTREAM_HOST, 443, "GET", "/v1/models", direct_headers, timeout=args.timeout)
    _print_result(f"A. 直连 https://{UPSTREAM_HOST}/v1/models（绕过本地代理）", direct)

    parsed = args.proxy
    if "://" in parsed:
        scheme, _, rest = parsed.partition("://")
    else:
        scheme, rest = "http", parsed
    hostport, _, _ = rest.partition("/")
    proxy_host, _, proxy_port_text = hostport.partition(":")
    proxy_port = int(proxy_port_text or ("443" if scheme == "https" else 80))
    proxy_headers = {"Connection": "close"}
    if args.client_token:
        proxy_headers["Authorization"] = f"Bearer {args.client_token}"
    via_proxy = _request(
        scheme, proxy_host, proxy_port, "GET", "/v1/models", proxy_headers, timeout=args.timeout
    )
    _print_result(f"B. 走本地代理 {args.proxy}/v1/models", via_proxy)

    _tls_diagnostics(key, args.timeout)

    chat_ok = False
    if direct.get("ok") and direct.get("status") == 200:
        payload = json.dumps(
            {"model": "deepseek-chat", "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
        ).encode()
        chat = _request(
            "https",
            UPSTREAM_HOST,
            443,
            "POST",
            "/v1/chat/completions",
            {**direct_headers, "Content-Type": "application/json"},
            body=payload,
            timeout=args.timeout,
        )
        _print_result(f"C. 直连 https://{UPSTREAM_HOST}/v1/chat/completions（max_tokens=1）", chat)
        if chat.get("ok") and chat.get("status") == 200:
            chat_ok = True
            try:
                usage = json.loads(chat["body"]).get("usage")
                print("  Token :", json.dumps(usage, ensure_ascii=False) if usage else "（响应里没有 usage）")
            except Exception:
                pass

    print("\n=== 结论 ===")
    direct_ok = bool(direct.get("ok")) and direct.get("status") == 200
    proxy_ok = bool(via_proxy.get("ok")) and via_proxy.get("status") == 200
    if direct_ok and proxy_ok:
        print("Key、出网链路、本地代理全部正常。")
        if chat_ok:
            print("直连 chat/completions 也成功，Key 可用且能出 token。")
        return 0
    if direct_ok and not proxy_ok:
        print("直连正常、走代理异常 → 问题在本地代理这一环。")
        print("把上面 B 段的响应头和 body 发我，我照着改。")
        return 1
    if not direct_ok:
        print("直连 api.deepseek.com 就不正常 → 与本代理无关，问题在 Key 或这台机器的出网链路。")
        print("排查顺序：")
        print("  1) 临时关闭 Clash/Mihomo/Surge 等 TUN 或系统代理，重跑本脚本；")
        print("  2) 换一台机器或手机热点直连，确认 Key 在其它网络下是否正常；")
        print("  3) 若响应头里有上面列出的缺失项，基本可判定响应被中途改写，而不是 DeepSeek 返回的。")
        return 1
    print("直连与代理都不正常。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
