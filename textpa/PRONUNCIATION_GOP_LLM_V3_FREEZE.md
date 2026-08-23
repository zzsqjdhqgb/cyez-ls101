# 发音 GOP + LLM 上下文版冻结协议

状态：**暂时冻结，作为后续 AI 批改引擎重写的行为基准**

冻结版本：`gop-llm-word-context-v3`

记录日期：2026-08-23

这份文档描述当前已经实际运行并人工检查过的版本。后续实现可以替换模块、语言或
服务调用方式，但在没有明确宣布新版本之前，不能改变本文件规定的输入选择、上下文
组织、证据含义和输出合同。

## 1. 基准产物

当前参考实现和样本产物如下：

| 项目 | 路径或值 |
| --- | --- |
| 基础 GOP 入口 | `textpa/scripts/run_pronunciation_gop_demo.py` |
| LLM 后处理入口 | `textpa/scripts/run_pronunciation_gop_llm_demo.py` |
| 参考输入 | `.gop-research/exam/stable-gop-demo/result.json` |
| 参考 LLM 产物 | `.gop-research/exam/stable-gop-demo-llm-v3/` |
| 参考报告 | `.gop-research/exam/stable-gop-demo-llm-v3/report.md` |
| 参考 prompt | `.gop-research/exam/stable-gop-demo-llm-v3/prompt.txt` |
| 参考证据包 | `.gop-research/exam/stable-gop-demo-llm-v3/evidence.json` |
| 参考模型 | `agnes-2.5-flash` |
| GOP 阈值 | `gop_log_ratio <= -0.35` |
| 单词上下文半径 | 前后各最多 `2` 个 ASR 单词 |
| 数据 schema | `2` |

参考基线的完整哈希记录在 `stable-gop-demo-llm-v3/manifest.json` 和
`response.json` 中：

```text
input_sha256:  8a45d99d30395cbec63936b92682bdc55f7264279807c2f7326202249ddd6321
script_sha256: ad82ae099dac4d0294c1788c36cf4a04edd2cb70d58c06f24e638d2ba9be1257
prompt_sha256: a8b4a7d91e9edbaad88cb7b126219db1edc9bd4608f38638ff3077db9930aa98
request_sha256: aa50f93e745303476a0d2891a323dfba7201ac7204dbb2998001108510ec4ec7
```

这几个哈希用于判断“重写后的实现是否仍在复现冻结样本”，不是运行时业务 ID。

## 2. 目标和边界

这个版本是**发音证据整理器**，不是考试评分器。它的职责是：

1. 从本地 CMU-phone CTC-GOP 结果中找出值得交给 LLM 的低 GOP 原始行；
2. 为每个问题单词补充局部 ASR 上下文和完整音素序列；
3. 让 LLM 把证据整理成保守的中文发音反馈、待复听项或暂缓项；
4. 保留每条原始证据的可追溯 ID。

它明确不做以下事情：

- 不把音频发送给 LLM，也不让 LLM 独立听音；
- 不做语法、内容、措辞、停顿、流利度、音高、重音、语调、音量或情绪分析；
- 不从 ASR 文本推断正确答案，不做语义纠错；
- 不输出考试分数或 1--5 级评分；
- 不把低 GOP 或 `confidence` 当作校准后的错误概率；
- 不把 `observed_phones` 当作人工确认的用户发音。

## 3. 冻结的处理流程

```text
基础 result.json
  -> 选取全部 gop_log_ratio <= -0.35 的 phone rows
  -> 按 word_index 分组
  -> 每个问题词附加前后最多两个 ASR 单词
  -> 读取该词完整 CMU/IPA 参考序列
  -> 拼接该词全部对齐窗口的 acoustic_winner 序列
  -> 附加该词内每条低 GOP 详细证据
  -> 发送局部 word_contexts 给 LLM
  -> 校验 JSON、evidence ID 覆盖和原始音素字段
  -> 输出报告和可审计产物
```

### 3.1 低 GOP 选择

选择规则是唯一的阈值规则：

```text
selected = every phone row whose gop_log_ratio <= -0.35
```

必须包含所有满足条件的行，不得再按辅音、元音、词首、词尾、词位、声学赢家或人工
手写模式过滤。排序只影响 JSON 展示顺序，不影响选择：扁平行按 GOP、时间和索引排序；
单词内部按 `phone_index`、时间和索引恢复音素顺序。

### 3.2 问题词和上下文

一个单词只要含有至少一条选中的低 GOP 行，就生成一个 `word_context`。上下文窗口按
转写词序截取：目标词本身加前两个和后两个词；句首、句尾不足时自然缩短。相邻词只用于
局部语境，不作为发音事实。

每个上下文包含：

- `word_index`、`word`：目标词及其原始词序位置；
- `context_text`：窗口词以空格拼接的 ASR 文本；
- `context_words`：窗口中每个词的 `relative_position`、`word_index`、`word` 和可用时间戳；
- `reference_phones`：目标词完整的参考 CMU/ARPAbet 和 IPA 序列；
- `observed_phones`：目标词每个参考音素的强制对齐窗口中，模型声学赢家的完整序列；
- `gop_evidence`：目标词内全部选中行的详细原始证据。

`observed_phones` 的准确含义是：

```text
for each reference phone segment:
    take acoustic_winner from that forced-alignment segment
concatenate in phone order
```

它不是独立的词级 CTC 解码，也不是人工听音标注。这个限定必须在任何重写实现中保留。

### 3.3 完整 ASR 文本的边界

基础 `result.json` 的 `source_result.transcript` 会写入本地 `evidence.json`，用于审计和
复现；**完整文本不随 LLM 请求发送**。LLM 请求中只出现 `context_words` 和
`context_text` 的局部窗口。这样既提供了目标词的语境，又避免让模型绕过证据包重新解释
整段 ASR。

## 4. 输入字段合同

重写者至少要能从基础 GOP 结果恢复以下字段。

### 4.1 扁平 `phones[]`

每个 phone row 的必需语义如下：

| 字段 | 含义 |
| --- | --- |
| `index` | 全句唯一的扁平音素索引 |
| `word_index` | 所属词索引 |
| `phone_index` | 词内音素索引 |
| `word` | ASR/对齐使用的词面 |
| `expected` / `expected_ipa` | 该对齐位置的参考 CMU 音素和 IPA |
| `acoustic_winner` / `acoustic_winner_ipa` | 该对齐窗口的最高声学赢家及 IPA |
| `best_alternative` / `best_alternative_ipa` | 排除目标音素后的最强替代项 |
| `gop_log_ratio` | GOP 证据值，必须是有限数值 |
| `confidence` | 当前实现的相对证据强度，必须是有限数值 |
| `start_ms` / `end_ms` | 对齐时间范围 |

`expected_log_p` 和 `alternative_log_p` 在基础结果存在时一并复制；它们是可选字段，不能
被重写者擅自改名或重新解释。

### 4.2 `words[]`

为了构造完整词序列，优先使用基础结果的 `words[]`：

```json
{
  "word_index": 23,
  "text": "books",
  "expected_arpabet": ["B", "UH", "K", "S"],
  "expected_ipa": ["b", "ʊ", "k", "s"],
  "phones": ["该词全部对齐 phone rows"]
}
```

目标词的参考序列必须来自该词完整 `words[]` 记录，而不能只拼接低 GOP 行。观测序列也
必须覆盖该词全部对齐 phone rows，而不能只列出有问题的音素。

## 5. 冻结的 LLM 请求

### 5.1 system message

当前 system message 是：

```text
You are an evidence-constrained English pronunciation feedback editor.
You cannot hear the audio. You may only organize and cautiously explain the supplied
CMU-phone CTC-GOP word-context evidence. Never invent acoustic, prosodic, grammatical,
semantic, or audio observations. Return the requested JSON contract exactly.
```

### 5.2 user message 的固定要求

user message 必须明确说明：

1. LLM 看不到音频；低 GOP 是模型证据，不是错误概率；`expected` 和
   `acoustic_winner` 不同不自动等于发音错误；
2. 请求只含局部 ASR 窗口，ASR 可能有错词；
3. `reference_phones` 是标准参考序列，`observed_phones` 是对齐窗口赢家拼接，
   不是独立词级识别；
4. 允许参考相邻证据和重复模式，但必须承认模型混淆、连读、弱读、合法变体和边界偏移；
5. `likely_issue` 只用于重复或相对清晰模式，`needs_listening` 用于值得复听但不能确定
   的模式，其余进入 `withheld_differences`；
6. 每个 `evidence_id` 必须且只能归档一次；
7. 原始音素字段必须逐字复制，不得创造输入中没有的整词 IPA、重音或方言转写；
8. 不讨论语法、内容、措辞、停顿、流利度或韵律特征。

准确的中文措辞和 JSON 示例以冻结的
[`prompt.txt`](../.gop-research/exam/stable-gop-demo-llm-v3/prompt.txt) 及
[`run_pronunciation_gop_llm_demo.py`](scripts/run_pronunciation_gop_llm_demo.py)
为准。重写时不要只保留“意思相近”的提示词而丢掉这些边界。

### 5.3 请求参数

参考样本使用 OpenAI-compatible Chat Completions：

```text
endpoint:  https://apihub.agnes-ai.com/v1/chat/completions
model:     agnes-2.5-flash
temperature: 0.0
thinking:  true (chat_template_kwargs.enable_thinking)
max_tokens: 65535
```

endpoint、模型和 key 是部署配置，不是业务合同；但 `temperature=0`、阈值和 prompt
内容属于本冻结样本的复现参数。

## 6. LLM 输出合同

LLM 必须返回 JSON，顶层只能有以下四个字段：

```json
{
  "summary_zh": "一句保守总结",
  "feedback_items": [],
  "withheld_differences": [],
  "limitations_zh": []
}
```

`feedback_items` 的每一项必须包含：

```json
{
  "evidence_ids": ["GOP-0001"],
  "decision": "likely_issue",
  "observations": [
    {
      "evidence_id": "GOP-0001",
      "expected": "B",
      "expected_ipa": "b",
      "acoustic_winner": "P",
      "acoustic_winner_ipa": "p"
    }
  ],
  "finding_zh": "证据支持的发音观察",
  "rationale_zh": "为什么值得反馈或复听",
  "practice_zh": "具体而保守的练习建议"
}
```

`decision` 只能是 `likely_issue` 或 `needs_listening`。

`withheld_differences` 的每一项必须包含：

```json
{
  "evidence_ids": ["GOP-0002"],
  "observations": [
    {
      "evidence_id": "GOP-0002",
      "expected": "B",
      "expected_ipa": "b",
      "acoustic_winner": "P",
      "acoustic_winner_ipa": "p"
    }
  ],
  "reason_zh": "为什么不能直接向学习者报错"
}
```

程序必须拒绝以下响应：

- 缺少或增加顶层字段；
- 引用未知 `evidence_id`；
- 一个 ID 重复出现或未出现；
- `observations` 数量或顺序与 `evidence_ids` 不一致；
- `expected`、`expected_ipa`、`acoustic_winner`、`acoustic_winner_ipa` 与输入不完全相同；
- 空的中文说明字段或非法 `decision`。

程序校验的是结构和事实引用，不可能自动证明中文理由、练习建议或 `likely_issue` 判断
在语言学上正确；这些内容仍是人工复听前的草稿。

## 7. 输出文件

一次成功运行应产生：

| 文件 | 用途 |
| --- | --- |
| `evidence.json` | 完整本地证据包；含完整 ASR transcript 和 `word_contexts` |
| `prompt.txt` | 实际发送的 user message；不含完整 ASR transcript |
| `response.json` | 原始 API 响应、请求哈希和校验后的 `feedback` |
| `result.json` | 面向下游读取的 schema 2 结果 |
| `report.md` | 人工复听用的中文报告 |
| `manifest.json` | 输入、脚本、模型、阈值和输出计数的 provenance |

下游重写至少应保留 `evidence_id`、时间区间、参考/赢家音素和完整上下文，以便从报告
跳回原音频核对。

## 8. 参考样本结果

在 `recording-11.webm` 上，冻结版得到：

- 59.94 秒录音，130 个词，449 个基础对齐音素；
- 15 条 `gop_log_ratio <= -0.35` 的原始行；
- 9 个问题词上下文；
- 7 个 `likely_issue`/`needs_listening` 项；
- 5 个暂缓项；
- 15/15 条 `evidence_id` 完整覆盖并通过字段校验；
- 输入 token 9483，输出 token 3910（该数字仅记录本次调用，不是合同）。

典型上下文如下：

```text
目标词：books
上下文：that e books overweigh paper
参考：B UH K S / b ʊ k s
观测：P UH K S / p ʊ k s
证据：GOP-0012，B/b -> P/p，GOP -2.277763
```

完整参考输出见：

- [`evidence.json`](../.gop-research/exam/stable-gop-demo-llm-v3/evidence.json)
- [`report.md`](../.gop-research/exam/stable-gop-demo-llm-v3/report.md)
- [`result.json`](../.gop-research/exam/stable-gop-demo-llm-v3/result.json)

## 9. 重写兼容性清单

后续实现完成后，应逐项确认：

- [ ] 低 GOP 选择仍是全部 `gop_log_ratio <= -0.35`，没有隐藏语义筛选；
- [ ] 每个问题词仍有前后最多两个 ASR 词，边界正确裁剪；
- [ ] 参考序列覆盖整个目标词，而不是只有异常音素；
- [ ] 观测序列覆盖整个目标词，并明确标为对齐窗口赢家；
- [ ] 完整 ASR transcript 不进入 LLM 请求；
- [ ] 每条低 GOP 行都有稳定 `evidence_id` 和时间戳；
- [ ] LLM 输出能做到 ID 恰好一次覆盖；
- [ ] 原始四个音素字段逐字校验；
- [ ] 没有把发音反馈扩展成语法、内容、停顿或分数评价；
- [ ] 结构/证据校验失败时拒绝输出 learner-facing 报告；
- [ ] 参考样本的上下文、序列和 ID 覆盖与 v3 产物一致。

任何改变阈值、上下文半径、prompt 约束、`observed_phones` 定义或输出合同的实现，都应
另起版本号，例如 `gop-llm-word-context-v4`，不要覆盖 v3 的解释。

## 10. 当前已知限制

这版仍然是研究 demo：

- GOP 不是校准概率，低值可能来自模型混淆或 CTC 边界偏移；
- ASR 错词会影响强制对齐目标，局部上下文不能修复它；
- 连读、弱读、合法变体和词间边界需要人工复听；
- 没有人工标注测试集上的 precision/recall 或 MDD F1；
- 当前模型和完整推理链路以 CPU、本地资产和当前 CMUdict 版本为基准；
- LLM 不能听音频，输出的自然语言诊断必须由人审核。

这些限制是冻结协议的一部分，不应在重写时通过更强措辞掩盖。

