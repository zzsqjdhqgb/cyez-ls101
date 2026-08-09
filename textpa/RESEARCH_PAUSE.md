# TextPA 研究暂停点

记录日期：2026-08-09。

当前研究暂缓，后续继续时以本文作为恢复入口。研究目标是面向上海英语高考听说
练习的低风险自动反馈，不替代正式考试真人评分。

## 已完成

- 复现并工程化了 TextPA 的主要声学链路：Whisper、IPA、CMU/ARPAbet 和停顿串。
- 在同一批 50 条 MultiPA acoustic cues 上完成 GPT、Sol、Luna、DeepSeek 的模型
  对照，完整数字见 [`BENCHMARK.md`](BENCHMARK.md)。
- 完成四极值锚点的 Luna max 探索实验；原始 46 条输出和 manifest 已在
  `benchmark-data/llm-benchmark/` 追踪。
- 整理了通用输入协议、Schema 和题型示例：见
  [`SCORING_INPUT_FORMAT.md`](SCORING_INPUT_FORMAT.md)。
- 核查了后续论文和部署启示：见 [`RELATED_WORK.md`](RELATED_WORK.md)。

## 当前判断

### 句级评分

当前零样本链路可以做练习用途的粗粒度 Accuracy/Fluency 排序，但不应当作正式
考试定级。50 条数据上的最佳结果不能外推到跨题型、跨口音和自由回答场景；句级
PCC 也不代表逐词、逐音素反馈正确。

### 诊断与评分应分层

建议把系统拆成两个逻辑模块：

1. 口语诊断模块只输出有证据约束的事实，不给分数。
2. 评分模块读取题目、rubric、文本和诊断列表，再由 LLM 按评分挡位给出分项分、
   总分和反馈。

诊断模块的最小外部结果可以是二元组列表：

```json
[
  ["P-0001", "school 的词尾 /l/ 未清楚发出。"],
  ["F-0001", "在 I am 后发生停顿和自我修正。"]
]
```

诊断 ID 必须由系统预先生成并绑定内部证据；LLM 只能引用有效 ID。`P-` 表示发音，
`F-` 表示流利度，`U-` 表示证据冲突或无法确定。评分模块保留 ID，界面可以只展示
合成后的评价文本。

`surface_transcript`、`committed_transcript` 和自我修正事件需要分开保存。被放弃
的错误开头通常不应直接算最终语法错误，但可以作为流利度的 repair 证据；所有
维度不得对同一个 repair 事件重复扣分。

## 已知边界

- 当前送给 TextPA LLM 的仍只有 transcript、CMU 和 IPA；绝对时间 alignment、
  Whisper word timestamps、置信度和题目 reference 尚未进入提示词。
- 当前 CMU 对齐可以保留内部停顿区间，但边缘静音会裁剪，且没有填充词、重复、
  重启的独立检测器。
- 当前 `assess` 输出模型仍强制要求 Accuracy、Fluency 和 Reasoning；纯诊断输出
  需要单独的结果协议。
- 仅凭 ASR transcript 无法总是区分 ASR 错误、发音导致的词语混淆和真实语法错误。
  `where/were` 等情况应允许输出不确定项。
- 朗读题可以使用 `target_text` 做确定性比较；Free Talk 没有固定目标文本，需
  降低词级诊断置信度。

## 最近诊断冒烟

样本及原始结果保存在 [`benchmark-data/diagnostic-smoke/`](benchmark-data/diagnostic-smoke/)。
使用同一条 16.745 秒 MultiPA 音频和当前本地 transcript/CMU/IPA，提示词见
`Temp.txt`，调用 `gpt-5.6-sol`、Responses API、reasoning effort `medium`。

- Sol medium 返回 5 个有证据支持的错音、3 个不确定项。
- 16 个 CMU/IPA 引用片段均能在输入中逐字找到；这只验证了引用未伪造，未验证
  词级诊断真值。
- Luna max 第一次请求约 15 分钟后由源站返回 HTTP 500；第二次在切换到 Sol 前
  中止，没有可用输出。

## 恢复时优先事项

1. 保留 Whisper 的 word timestamps、n-best/置信度和原始不清洗转写。
2. 用 Viterbi、CTC posterior 或专用 forced aligner 生成逐词/逐音素证据。
3. 生成带稳定 ID 的 pronunciation、fluency、uncertain diagnostic records。
4. 让 LLM 只改写已验证证据；评分模块单独消费诊断列表和 rubric。
5. 为自我修正、填充词、重复和 `where/were` 类歧义建立带人工审计的测试集。
6. 细粒度诊断使用 MDD F1、误报/漏报率和反馈事实正确率评估，不能沿用句级 PCC。

## 数据保存边界

`benchmark-data/` 现在保存了可复核研究状态所需的小体积数据：原始 LLM 输出和
manifest、finalize 结果、四锚点实验、smoke/诊断输入与输出、单样本推理复测，以及
MultiPA 与 SpeechOcean 的公开参考快照。模型权重、`.venv`、Python 缓存和上游
源码 checkout 仍由 `.gitignore` 排除，可按固定 requirements、revision、下载 URL
和 SHA-256 重建；不应把 API key 或 `.env.local` 提交到 Git。
