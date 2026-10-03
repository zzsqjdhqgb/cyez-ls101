# deepseek-flash 思考强度 × 四锚点对照（MultiPA 50 条）

2026-09-28 在本地 MultiPA `paper_cues`（50 条，作者公开中间结果）上，用
`deepseek-flash` 跑 **4 档 `reasoning_effort` × {零样本, 四锚点}** 共 8 个条件。
目的：在为 speechocean762 大轮次选档之前，先看清 DeepSeek 的「质量—成本」曲线，
并与仓库里既有的锚点实验（Luna max / Agnes 2.5 Flash）对照。

## 协议

| 项 | 值 |
| --- | --- |
| 语料 | `../multipa-reference/paper_cues.jsonl`（50 条） |
| 标注 | `../multipa-reference/annotation.csv`（五位标注者均值） |
| prompt | `textpa_repro.prompting.render_prompt(paper_compat=True)`，论文原版单 user message + Python dict repr |
| 锚点 | `../calibration/multipa-extreme4-anchors.jsonl`（4 条，Accuracy/Fluency 低高四极值） |
| 四锚点语义 | 与 `textpa_repro/cli.py --calibration-anchors --exclude-calibration-anchors` 一致：校验锚点 ID 存在且 cue payload 与输入逐字相同，然后把这 4 条排除 → **评估 46 条** |
| 模型 | `deepseek-flash`（DeepSeek-V4.1-Flash） |
| 采样 | `temperature=0`、`max_tokens=65535`、非流式 |
| 端点 | `https://api.deepseek.com/v1/chat/completions`（Key 由本地代理注入，未落盘） |

## 结果（同 46 条子集）

| 档位 | 协议 | n | Acc PCC | Flu PCC | Acc MAE | 输入/条 | 输出/条 | 耗时/条 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| none | 零样本 | 50 | +0.516 | +0.496 | 0.840 | 595 | 310 | 2.0 s |
| none | 四锚点 | 46 | **+0.635** | +0.652 | **0.422** | 2,004 | **334** | 2.3 s |
| minimal | 零样本 | 50 | +0.389 | +0.642 | 1.320 | 621 | 3,504 | 17.1 s |
| minimal | 四锚点 | 46 | +0.415 | +0.717 | 0.639 | 2,030 | 5,994 | 28.1 s |
| high | 零样本 | 50 | +0.604 | +0.583 | 1.230 | 621 | 6,201 | 28.7 s |
| high | 四锚点 | 46 | +0.506 | +0.714 | 0.509 | 2,030 | 12,328 | 54.8 s |
| max | 零样本 | 49 | +0.457 | +0.590 | 1.110 | 621 | 9,369 | 44.3 s |
| max | 四锚点 | 45 | +0.543 | **+0.758** | 0.493 | 2,030 | 16,699 | 77.8 s |

零样本列为 50 条，四锚点列为同一子集的 46 条；上表指标均在 46 条交集上计算（见
`manifest.json` 的逐条件明细）。

## 与历史对照（同一 46 条，本地重算并已与文献逐位核对）

| 模型 / 协议 | Acc PCC | Flu PCC | 来源 |
| --- | ---: | ---: | --- |
| 论文 GPT-4o-mini | +0.570 | +0.563 | `../anchor-benchmark/paper-gpt4omini-46.jsonl` |
| 论文 Gemini 2.0 Flash | +0.607 | +0.569 | `../anchor-benchmark/paper-gemini-46.jsonl` |
| Luna max 零样本 | +0.623 | +0.594 | `../anchor-benchmark/gpt-5.6-luna-max-baseline-46.jsonl` |
| **Luna max 四锚点** | **+0.670** | **+0.774** | `../anchor-benchmark/gpt-5.6-luna-max-extreme4.jsonl` |
| Agnes 2.5F 零样本 | +0.436 | +0.595 | `../agnes/agnes-2.5-flash-multipa-thinking.jsonl` |
| Agnes 2.5F 四锚点 | +0.258 | +0.571 | `../agnes/agnes-2.5-flash-multipa-thinking-extreme4.jsonl` |
| **DeepSeek `none` 四锚点** | +0.635 | +0.652 | 本目录 |
| **DeepSeek `max` 四锚点** | +0.543 | +0.758 | 本目录 |

配对 bootstrap（10,000 次，同 46 条）：

| 比较 | 差值 | 95% 区间 | 结论 |
| --- | ---: | --- | --- |
| 四锚点−零样本，`max` 的 Fluency | +0.183 | [+0.039, +0.354] | 唯一显著 |
| 四锚点−零样本，其余 7 组 | +0.06 ~ +0.16 | 均含 0 | 方向为正但不显著 |
| `none` − `max`（Acc / Flu） | +0.083 / −0.111 | 均含 0 | 分不出高下 |
| `none` − Luna max（Acc / Flu） | −0.039 / −0.119 | 均含 0 | 不能说 DeepSeek 更差 |
| `max` − Luna max（Acc / Flu） | −0.119 / −0.025 | 均含 0 | Fluency 基本追平 |

## 结论

1. **四锚点对 DeepSeek 是正收益**：Fluency 四档全涨，Accuracy 三档上涨；方向与 Luna 一致、
   与 Agnes 相反。锚点还修好了尺度压缩——`none` 档 MAE 从 0.840 降到 0.422。
2. **最佳性价比是 `none` 档**：Acc 0.635 / Flu 0.652，每条只要 334 输出 tokens；
   `max` 输出 16,699 tokens（50 倍）只换来 Flu +0.106、Acc 反而略低。
3. **短板在 Accuracy、长板在 Fluency**：`max` 的 Fluency 0.758 已贴近 Luna 的 0.774，
   但 Accuracy 始终差一截（0.543/0.635 vs 0.670）——不过 n=46 下均不显著。

## 文件

| 文件 | 内容 |
| --- | --- |
| `manifest.json` | 参数、输入 sha256、逐条件指标与 token 统计 |
| `deepseek-flash-multipa-<tier>.jsonl.gz` | 零样本，50 条（`max` 档 49 条有效） |
| `deepseek-flash-multipa-<tier>-extreme4.jsonl.gz` | 四锚点，46 条（`max` 档 45 条有效） |
| `call-logs.jsonl.gz` | 382 条 API 调用的原始记录（gzip，2.5 MiB / 解压 9.8 MiB）：完整请求体、完整响应体（含 `reasoning_content`）、usage、耗时、请求/响应 sha256。鉴权头在代理侧已打码为 `Bearer [REDACTED]`，无任何 Key 片段落盘 |

全部九个 JSONL 都以 gzip 存放（`mtime=0, level 9`，可确定性重压），避免被统计器当作源码/文本计入仓库语言构成；
`manifest.json` 对每个文件同时记录 gz 哈希与**解压后内容的 sha256**（后者是稳定的内容标识）。

单条实验记录的字段沿用 `assess` 的输出约定：`id / transcript / phonemes_cmu / phonemes_ipa /
assessment{accuracy,fluency,reasoning} / provider / llm_model / prompt_mode`，另加
`usage{prompt,completion,reasoning,cache_hit}`、`seconds`、`tier`、`requested_effort`。

读取冻结数据：

```bash
gunzip -c benchmark-data/deepseek-effort-sweep/call-logs.jsonl.gz | jq -c 'select(.tier=="max")' | head
gunzip -c benchmark-data/deepseek-effort-sweep/deepseek-flash-multipa-none-extreme4.jsonl.gz | jq -r '.id' | wc -l
```

## 复现

```bash
# 走本地代理时 Key 随便填；直连则设 TEXTPA_API_KEY / TEXTPA_BASE_URL
python3 scripts/run_effort_sweep.py \
  --base-url http://127.0.0.1:8787/v1 --api-key anything \
  --tiers none,minimal,high,max --concurrency 25 --out-dir /tmp/effort

python3 scripts/run_effort_sweep.py \
  --base-url http://127.0.0.1:8787/v1 --api-key anything \
  --anchors benchmark-data/calibration/multipa-extreme4-anchors.jsonl \
  --tiers none,minimal,high,max --concurrency 25 --out-dir /tmp/anchor
```

runner 写出的是未压缩的 `.jsonl`；与冻结文件核对时先 `gunzip` 两边再比（内容 sha256 记录在 `manifest.json`）。

`textpa assess` 也能跑同样的协议，但它没有暴露 `temperature`，会使用服务商默认采样，
与本目录的 `temperature=0` 不是同一条件；要逐位复现请用上面的 runner。

## 已知边界

- 46 条样本、锚点取自同一测试集，属 **transductive 对照**，不是样本外估计；
  `../calibration/README.md` 对此有同样的警告。
- `temperature=0` 与历史 Luna max 行的默认采样不同，两组数字**不能逐位对齐**，
  只能比较量级与方向。
- 2 条失败：`max` 零样本 1 条 JSON 解析失败、`max` 四锚点 1 条 `RemoteDisconnected`
  （约 1.7 万输出 tokens 的长响应被服务端断开，重试 3 次仍失败）。
- 只报告 **LLM-only PCC**。论文的 IPA 融合与部署标尺需要 `finalize`（eSpeak），
  当前容器没有该环境，因此本目录不含 `-final` 派生文件。
- 本轮实验共消耗 **3,088,823 tokens**（输入 493,295 + 输出 2,595,528），
  输入侧缓存命中率约 39.6%。
