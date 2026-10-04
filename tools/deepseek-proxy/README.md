# DeepSeek Key 本地中转（`deepseek_key_proxy.py`）

把只在你手里输入的 **DeepSeek API Key** 变成一个本机 OpenAI 兼容端点，让容器里的
agent、脚本或任何客户端在**看不到 Key** 的前提下正常调用 DeepSeek，同时把
**每一次请求与响应完整落盘**做审计、并统计 token 用量。

```
客户端（容器 / 脚本 / agent）
      │  base_url = http://host.docker.internal:8787/v1
      │  api_key  = 任意非空值（或 --client-token 设定的本地令牌）
      ▼
deepseek_key_proxy.py  ──►  https://api.deepseek.com
      │  注入 Authorization: Bearer <真实 Key>
      │  其余请求/响应原样转发（含非 2xx）
      ├─►  stdout / usage.jsonl ：逐请求 token 统计
      └─►  proxy-captures/      ：完整请求与响应审计数据
```

## 三条硬保证

1. **Key 只在内存**：交互输入（`getpass`，不回显），不写文件、不进日志、不进审计数据。
   注入上游的 `Authorization` 在所有落盘副本里都是 `Bearer [REDACTED]`。
   自测里有一条用例会遍历整个输出目录，确认 Key 与客户端令牌都不存在于任何文件。
2. **除鉴权外不改一个字节**：方法、路径、查询串、请求体、响应状态码、响应头
   （逐跳头除外）、响应体字节全部透传；`chunked` 按原始分块字节转发；
   `401/429/500` 等非 2xx 如实返回，不重试、不改写、不审查。
   唯一例外是可选的本机健康检查路径（`--health-path`，默认关闭）。
3. **统计与审计是旁路**：先把字节写给客户端，再拿同一份副本解析/落盘；
   解析失败或磁盘写失败只影响统计，不影响转发。

## 通过 yarn 脚本运行（跨平台）

仓库根目录已经加好五个脚本，Windows / Linux / macOS 都能直接用：

| 命令                           | 作用                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `yarn deepseek-proxy`          | 启动代理（交互输入 Key）；后续参数直接跟，例如 `yarn deepseek-proxy --lan --client-token s3cret` |
| `yarn deepseek-proxy:probe`    | 连通性探测，例如 `yarn deepseek-proxy:probe --probe-hosts host.docker.internal`                  |
| `yarn deepseek-proxy:diagnose` | 链路诊断：对比直连 DeepSeek 与走代理，并体检 Key、DNS、证书                                      |
| `yarn deepseek-proxy:usage`    | 按审计数据统计用量：全部时间 + 最近 24 小时                                                      |
| `yarn deepseek-proxy:test`     | 跑自测                                                                                           |

它们都经 `tools/deepseek-proxy/launch.mjs` 启动：Windows 依次尝试 `python` / `py -3`，
Linux/macOS 依次尝试 `python3` / `python`，并以 `-X utf8` 运行（避免 Windows 把输出
重定向到文件时用 cp936 编码中文与 `⚠`/`≈` 而报错）；标准输入输出与退出码原样透传，
所以交互式输入 Key 不受影响。

## 快速开始

### A. 在宿主机运行（推荐：Key 只在你的机器上输入）

```bash
python3 deepseek_key_proxy.py
# 提示输入 DeepSeek API Key（不回显），默认监听 127.0.0.1:8787
```

启动横幅会直接打印容器里该用哪个地址。本容器（Docker Desktop）实测
`host.docker.internal` 能打到宿主机的服务，所以：

```
客户端（容器内）:  base_url = http://host.docker.internal:8787/v1
                   api_key  = 任意非空值
```

不确定时，在**客户端所在环境**跑一次探测（会逐个候选地址试并把可用的 base_url 打出来）：

```bash
python3 deepseek_key_proxy.py --probe
```

### B. 在容器内运行

```bash
python3 deepseek_key_proxy.py --lan --client-token 随机串
# 容器内所有进程直接用 http://127.0.0.1:8787/v1 ，api_key 填那个随机串
```

`--lan` 等价于 `--host 0.0.0.0`；此时建议务必配 `--client-token`，否则同网段
任何人都能用这个端口消耗你的 Key。Linux 宿主让容器访问宿主机服务还需要
`docker run --add-host=host.docker.internal:host-gateway ...`。

### 客户端示例

```bash
curl http://host.docker.internal:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer anything' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://host.docker.internal:8787/v1", api_key="anything")
print(client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "你好"}],
).choices[0].message.content)
```

`textpa/` 那套复现脚本也可以直接指过来（Key 由代理注入，环境变量留空即可）：

```bash
export TEXTPA_BASE_URL='http://host.docker.internal:8787/v1'
export TEXTPA_API_KEY='anything'
```

## Token 统计

- **服务端上报**（首选）：从响应 JSON 或 SSE 最后一个 `usage` 块里读
  `prompt_tokens` / `completion_tokens` / `total_tokens` /
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` /
  `completion_tokens_details.reasoning_tokens`（DeepSeek 与 OpenAI 两种命名都兼容）。
- **估算**（仅当没上报时）：按 `英文字符×0.3 + 非英文字符×0.6` 粗估 completion，
  日志里标注为 `（估算）`，与上报值分开累计。
  DeepSeek 的 `stream: true` 默认不返回 usage，而本代理**不会**替你加
  `stream_options.include_usage`（那属于修改请求），因此流式请求通常走估算；
  需要精确值时请在你自己的请求里显式打开该选项。

每行输出形如：

```
12:00:59  200  stream  model=deepseek-chat  3.41s  prompt=1024 completion=256 total=1280 cache_hit=512 cache_miss=512 reasoning=0
12:01:03  429          model=-              0.12s  usage=-  error=Rate limit reached
```

`Ctrl-C` 退出时打印累计汇总（按模型分组）。可选 `--log-file usage.jsonl` 额外落一份
逐请求 JSONL。

## 审计数据（`--capture-dir`，默认 `./proxy-captures`）

```
proxy-captures/
├── index.jsonl                       # 每行一个请求的完整元数据
└── 000001-20260928T115939Z-3c805c/
    ├── meta.json                     # 头（已打码）、状态、耗时、framing、哈希、usage、错误
    ├── request.body / request.txt    # 请求体原始字节 + UTF-8 可读副本
    └── response.body / response.txt  # 响应体原始字节（chunked 已去帧）+ 解压后的可读副本
```

- `meta.json` 先写 `"state": "in-flight"`，请求结束后改写为 `"complete"`；
  进程被强杀时残留的 `in-flight` 目录也是有效证据。
- 响应体是边转发边落盘的，长流式回答不会等到结束才写。
- 单请求上限 `--max-capture-bytes`（默认 64 MiB，超出截断并在 meta 里标
  `*_truncated: true`）；可读副本上限 `--max-capture-text-bytes`（默认 32 MiB）。
- `index.jsonl` 里含 `request_body_sha256` / `response_body_sha256`，可直接做完整性核对。
- 只想统计不想落数据：`--no-capture`。

## 用量统计（`usage_report.py`）

按审计数据算出**全部时间**与**最近 N 小时**（默认 24）的用量，只读、不联网：

```bash
yarn deepseek-proxy:usage                       # 默认读 ./proxy-captures
yarn deepseek-proxy:usage proxy-captures --hours 6
yarn deepseek-proxy:usage --json | jq .window   # 给脚本消费
```

输出包含：请求数（成功 / 失败 / 未完成）、prompt / completion / total、缓存命中与命中率、
reasoning、未上报 usage 的估算部分、请求与响应字节、按模型分组（全部 / 窗口内），
以及最近 N 小时的小时级分布：

```
──────── 全部时间 ────────
  请求      : 22（成功 8，失败/非 2xx 14，未完成 0）
  输入 token : 9（prompt）
  输出 token : 1（completion，其中 reasoning 0 是子集）
  合计 token : 10
  输入侧缓存 : hit 0 | miss 9 | 命中率 0.0%
  字节      : 请求 350 B | 响应 5.5 KiB

──────── 按模型（全部 / 窗口内）────────
  模型                       请求        输入        输出          合计   │  窗口请求    窗口输入    窗口输出      窗口合计
  deepseek-flash                1           9           1            10   │         1           9           1            10
```

**输入与输出是分开统计的**，四个层级都能看到拆分：总体（全部时间 / 最近 N 小时）、
按模型、按小时、以及 `--json` 里的 `prompt_tokens` / `completion_tokens` / `total_tokens`。
`reasoning_tokens` 计入输出（它是 completion 的子集，不额外相加）；缓存 hit/miss 属于输入侧。

几点实现细节：

- 数据源优先读 `index.jsonl`，再扫每个请求目录的 `meta.json` 补齐索引缺失的记录
  （进程被强杀留下的 `in-flight` 记录也会算进来，单独计为「未完成」）；两者内容一致时自动去重。
- 也接受 `--log-file` 生成的 JSONL（两种字段布局都识别）。
- 时间按记录里最常见的时区显示（代理常跑在 `+08:00`，容器可能是 UTC）。
- `total` 只统计服务端上报的 usage；流式响应默认不带 usage，这部分按字符估算并单列，
  **不计入 total**，避免把估算当成账单数据。
- `proxy-captures/` 与 `proxy-usage.jsonl` 已加入仓库 `.gitignore`。

## ⚠ 数据落盘范围（请自己确认）

审计目录会**明文**保存完整的对话内容（prompt、模型回答、可能的个人信息）。
按你的说明这些数据不怕泄露、且需要可审计，所以默认开启；但它确实会越积越多，
建议定期归档或清理。唯一永不落盘的是 **API Key 与鉴权头**。

## 常用参数

| 参数                                              | 说明                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `--host` / `--lan`                                | 监听地址；`--lan` = `0.0.0.0`                                |
| `--port`                                          | 监听端口，默认 `8787`                                        |
| `--upstream`                                      | 上游 base URL，默认 `https://api.deepseek.com`，路径原样拼接 |
| `--key-env VAR` / `--key-stdin`                   | 非交互取 Key（自动化用；仍然不落盘）                         |
| `--client-token TOKEN`                            | 要求本地客户端也带 `Bearer TOKEN`（默认不校验）              |
| `--capture-dir DIR` / `--no-capture`              | 审计目录 / 关闭审计                                          |
| `--log-file PATH`                                 | 额外写逐请求统计 JSONL                                       |
| `--health-path PATH`                              | 打开本机健康检查（返回版本、Key 掩码、实时统计）             |
| `--quiet` / `--summary-every N`                   | 输出节奏                                                     |
| `--timeout`                                       | 上游读写超时秒数，默认 600（长回答请留足）                   |
| `--probe [--probe-hosts ...] [--probe-token ...]` | 连通性探测模式                                               |

## 排障：为什么 DeepSeek 回「空 body 的 400」

如果客户端收到 `HTTP 400 Bad Request` 且 **body 为空**（但响应头里仍有 `x-ds-trace-id`、
`eo-log-uuid`、`strict-transport-security` 这些真实边缘标记），基本不是网络问题，而是
**Authorization 头里带了 HTTP 非法字符**：

- `http.client` 只拒绝 `\n` 和 `\r`，其余控制字符（`\x0b`、`\x0c`、`\x01`、`\x7f` …）
  会被**原样写进请求头**，DeepSeek 边缘节点直接回 400 空 body；
- 从网页或聊天窗口复制 Key 时很容易带进这类不可见字符；
- 对照实验（同一位置替换字符）：`\x0b` / `\x0c` / `\x01` / `\x7f` → **400 空 body**；
  空格 / 制表符 / 超长 / 带引号 / 缺 Bearer → 一律 **401 + JSON 错误体**。
  也就是说，空 body 的 400 基本只有非法字符能造出来。

代理现在会在启动时校验 Key，并直接指出第几个字符、码点是多少：

```
API Key 含非法字符：第 7 个字符 U+000C（控制字符）。
这类字符会被原样塞进 HTTP 头，DeepSeek 只会回一个空 body 的 400，看起来像网络故障。
请重新复制 Key（建议用 API 控制台的复制按钮，或手工输入），再启动本代理。
```

`yarn deepseek-proxy:diagnose` 会做一次完整对照：Key 字符级体检（长度 / 是否纯 ASCII /
非法字符码点）、环境代理变量、TUN fake-IP 网卡、DNS 解析、TLS 证书颁发者（识别中间人）、
手写 TLS 请求（绕过 `http.client`），以及「直连 DeepSeek」与「走本地代理」两条路径的
状态码与响应头对比。

## 已知边界

- 逐跳头（`Connection`、`Keep-Alive`、`TE`、`Trailer`、`Upgrade`、`Expect`）按 RFC
  不转发；`Host` 按上游地址重写（HTTP/1.1 只允许一个 `Host`）；`Authorization`
  被替换。其余头原样转发。
- 每条客户端请求使用一条独立的上游连接（`Connection: close`），不做上游连接复用。
- 上游既没有 `Content-Length` 也没有 `Transfer-Encoding` 时，响应只能靠关闭连接定界，
  此时会如实回 `Connection: close`。
- 不支持 `brotli` 响应体的统计（未安装 `brotli` 模块时）——转发照常，只是读不到 usage。
- 不做限流、不做并发上限、不做缓存；超时/断连如实记录为错误。

## 自测

假上游 + 真代理子进程，逐字节核对透传、审计与统计，不联网、不需要真实 Key：

```bash
yarn deepseek-proxy:test          # 或 python3 test_deepseek_key_proxy.py -v
```

覆盖：JSON/gzip/chunked/close 定界、SSE 流式（有/无 usage）、`429`/`500` 非 2xx 透传、
chunked 请求体、`HEAD`/`204`、重复 `Host` 防护、客户端令牌校验、健康检查、
审计文件与哈希、**Key 不出现在任何落盘文件**、探测模式。
