<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 冻结提示词：`gop-llm-word-context-v3`

本目录下的 `PROMPT-gop-llm-word-context-v3.txt` 是 v3 版发音纠错提示词的逐字原文，
由 `benchmark-data/diagnostic-smoke/` 与 `RESEARCH_PAUSE.md` 记录的那次纯文字诊断冒烟
（`gpt-5.6-sol`、Responses API、reasoning effort `medium`）使用。

## 状态：已被 v4 取代，仅作对照

生产链路当前使用 `gop-llm-word-context-v4` 纯文本协议，定义见
[`../features/ai-grading.md`](../features/ai-grading.md) 与 `PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md`。
两版的关键差异：

| | v3（本文件） | v4（当前） |
| --- | --- | --- |
| 输出格式 | 单个 JSON 对象（`scope_note_zh` / `supported_errors` / `uncertain_items`） | 不超过两段的中文纯文本 |
| 证据校验 | 逐条校验引用片段与 `evidence_id` | 只剥离代码围栏并要求非空 |
| 单次输出上限 | 由调用方设定 | 固定 `maxOutputTokens=65535`、`temperature=0` |

保留它的原因：v3→v4 的措辞与评分差异需要可回溯的对照物，而不是只留结论。

## 文件来源

原文件名 `Temp.txt`（临时命名，容易被误当作垃圾清理）。内容自加入仓库以来未改动，
改名时保持字节一致；`diagnostic-smoke/gpt-5.6-sol-medium.json` 中的 16 处 CMU/IPA
引用仍是相对这段原文校验的。
