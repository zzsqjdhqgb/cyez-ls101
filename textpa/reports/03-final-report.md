# 语音评测方案：演进记录与最终采用方案

- 版本：2026-10-29 整理
- 基线：`dev@e54ff72e`（`refactor/test/textpa` / PR #37 已合入）
- 范围：Electron 应用 AI 批改中的**发音诊断链路**（`@ls101/grading-engine`）；TextPA 论文式句级评分仅保留在研究/benchmark 侧。
- 配套文档：[01-existing-solutions.md](01-existing-solutions.md)

本文分两部分：第一部分记录方案从 A 到 E 的演进，回答"为什么是现在这套"；第二部分给出最终采用方案的架构、流程、边界和后续工作。

## 一、方案演进记录

### 1. 演进概览

| 阶段 | 时间 | 方案要点 | 暴露的问题 | 处理结果 |
| --- | --- | --- | --- | --- |
| A | 2026-08-16~22 | CMUdict→手工 IPA 映射 + 多语言 eSpeak 声学模型 + 严格 JSON 诊断 | 音标表示不一致导致误报；教师录音被打到 81/100、8 个「重点复听」 | 转向 CMUdict + CTC-GOP |
| B | 2026-08-23 | CMUdict ARPAbet + 39 音素 Wav2Vec2 CTC + CTC Viterbi GOP | 误报收敛；长段自由表达仍受声学模型适配影响 | 保留 GOP 证据链 |
| C | 2026-08-29~30 | LLM 诊断从严格 JSON 改为保守纯文本 | JSON 措辞把「疑似」说成「确诊」，把评分带偏 | 同一条教师录音 0.5/1 → 1/1 |
| D | 2026-09-30 | 换 charsiu 英文 CMU 声学模型 + 缺词降级 | 长段清晰率低；一个词典缺词就让整题失败 | 长段 46.2%→95.5%；缺词不再崩溃 |
| E | 2026-10-20 | 空 ASR 转写、CMUdict `#` 注释修复 | 静音/空转写、词典注释导致异常 | 真实边界补齐 |

### 2. 各阶段变化与原因

**阶段 A：TextPA 式完整链路。** 早期按 TextPA 的思路搭了一条完整链路：ASR 转写 → CMUdict 转 IPA → 多语言 eSpeak 声学模型 → LLM 生成严格 JSON 诊断 → LLM 按评分标准打分。实际跑真实录音时，问题很快暴露：eSpeak 的音标切分和复合 token 表示与模型词表不一致，系统把连读、弱读、正常口音当成发音错误；一位英语老师近乎满分的朗读被打到 81/100，还列出 8 个「重点复听」项。这说明参考表示不统一，后面的证据和评分都会被带偏。

**阶段 B：换成 CMUdict + CTC-GOP。** 参考音素改用 CMUdict 的 ARPAbet，声学模型换成 39 个英文音素的 Wav2Vec2 CTC，用 CTC Viterbi 在整句上做强制对齐，再逐音素算 GOP。相比字符串比较，这条路线能把「实际发了什么音」变成可追溯的声学证据。误报明显收敛：60 秒自由表达只报出 1 条弱证据。但它只解决了「表示一致」的问题，长段自由表达上的模型适配问题仍在，而且当时还没有人工标注真值。

**阶段 C：LLM 诊断从 JSON 改为保守纯文本。** 原来的 LLM 诊断要求输出严格 JSON，逐条列 `evidence_id`，并区分 `likely_issue` 和 `needs_listening`。真实使用中发现，这种措辞会把「疑似」写成「确诊」：同一条教师近满分朗读，只因为诊断文字断言了「较明显的发音偏差」，最终评分就被压到 0.5/1。把输出改成不超过两段的保守纯文本、只描述观察和建议、不下结论后，同一条录音回到 1/1。这说明 LLM 可以参与表述，但不能让它替声学证据下判断。

**阶段 D：换英文专用声学模型，并处理缺词。** 长段自由表达上，多语言 eSpeak 模型会把英语判成带声调的中文音，39 个英文音素只分到约 7% 概率质量，导致同一段 60 秒观点题研究侧清晰率 96.7%、应用侧只有 46.2%。换成英文 CMU 音素模型 `charsiu/en_w2v2_ctc_libris_and_cv` 后，这段升到 95.5%，12 段整体升到 90%–100%。同时处理词典缺词：先做屈折后缀还原，仍缺则从对齐参考中剔除并记入 `uncovered_words`；全部缺词或空转写时跳过诊断，并按 0 分政策处理，不再让整题崩溃。

**阶段 E：补齐真实边界。** 空 ASR 转写（静音或 VAD 未检出语音）和 CMUdict 条目末尾的 `#` 用法注释，都会让旧实现抛错。现在空转写走统一降级路径，`#` 注释在生成参考音素前剔除，整条链路在真实作答包上可以稳定跑完。

### 3. 演进结论

- **参考表示要统一**：使用 CMUdict ARPAbet，不再用多套音标字符串互相比对。
- **证据要可核验**：CTC Viterbi 对齐 + GOP 给出逐音素的时间、声学赢家和把握分，供人工复听。
- **LLM 只做表述和评分**：诊断文字必须保守，不能把低 GOP 断言成发音错误；评分与证据分开。
- **真实边界要有确定性兜底**：缺词、空转写、长录音、无效模型输出都不能让整题卡死。
- **仍需补的功课**：阈值还是旧模型标定的，且没有人工音素审计集，误报率未知。

## 二、最终采用方案

### 4. 目标、非目标与评分挡位

**目标**

- 对朗读与自由表达录音给出逐词/逐音素的保守发音证据，并生成可读的中文纠错说明。
- 把发音证据作为文本评分的一个输入，最终输出 `{ score, comment }`。
- 评分按题目自带的评分挡位进行，避免 LLM 自由打分造成的分数分布过窄。
- 全链路可追溯：每条证据能追溯到参考音素、声学赢家、GOP、时间区间和原始响应。

**非目标**

- 不替代真人评分，不做正式考试定级；句级分数只做练习级排序。
- 不评语法、内容、措辞、停顿、流利度、音高、重音、语调、音量、情绪。
- 不输出「已确认发音错误」的断言；GOP/`confidence` 不是校准概率。

**评分挡位（当前需求的特点）**：题目本身带明确的评分挡位（rubric），每个挡位对应可观察的评分标准；评分时可以"先定挡、再在挡位内给分"，而不是让 LLM 在一条连续分数轴上自由发挥。这从机制上避免了 LLM 方案常见的分数挤在少数几档、区分度不足的问题，也便于老师复核。

### 5. 总体架构

```text
录音
 ├─ AIRouter ASR（Qwen3-ASR 0.6B int8 + Silero VAD，独立 worker）
 │        └─ 转写 ─────────────────────────────┐
 │                                            ↓
 │                              CMUdict 参考音素（+屈折回退，多读音候选 ≤32）
 │                                            │
 └─ ffmpeg 16k/mono/f32 ─→ ONNX worker（charsiu CTC，CPU）─→ 逐帧 logits
                                              │
                   候选变体选择 → 整句 CTC Viterbi 对齐（blank=[PAD]）
                                              ↓
                                   GOP / confidence
                                              ↓
        筛 gop_log_ratio ≤ -0.35 的音素行，按问题词 ±2 个 ASR 词组织证据
                                              ↓
                    LLM①：不超过两段的保守中文纠错说明
                                              ↓
        LLM②：题目 + 评分标准 + 转写 + 纠错说明 → 严格 { "score", "comment" }
```

### 6. 流程规格

| 阶段 | 实现 | 关键参数 / 行为 |
| --- | --- | --- |
| ASR | AIRouter 内置 `qwen3-asr-0.6b-int8`（Qwen3 0.6B int8 + Silero VAD） | 评分单元顺序执行；空转写进入降级路径 |
| 参考音素 | `cmu-pronouncing-dictionary`，只取英文词 | 多读音组合上限 32；缺词先按 `-y/-'s/-s/-es/-ed/-ing` 回退 |
| 音频解码 | ffmpeg-static | 16 kHz、单声道、float32、归一化 |
| 声学推理 | charsiu `en_w2v2_ctc_libris_and_cv`（wav2vec2-base） | 39 个无重音 CMU/ARPAbet 音素 + `[SIL]/[UNK]/[PAD]`；ONNX Runtime CPU；worker 以 fork+IPC 隔离 |
| 对齐 | greedy CTC 观测 → 词典变体 + 音素编辑距离选候选（前 8）→ CTC Viterbi 整句对齐 | `[PAD]` 为 blank；保留逐帧时间戳 |
| GOP | 对齐窗内 39 音素平均 log posterior 期望 − 其余音素 log-sum-exp | `confidence = min(1, abs(gop) / 4)` |
| 证据筛选 | 全部 `gop_log_ratio ≤ -0.35` 的音素行，无额外语义筛选 | 问题词前后各最多 2 个 ASR 词；稳定 `evidence_id`（`GOP-0000`） |
| LLM① | 根据低 GOP 证据生成保守中文纠错说明 | ≤2 段中文纯文本；没有低 GOP 证据时跳过 |
| LLM② | 按题目要求、评分挡位、转写和纠错说明组织评分请求 | 严格 `{ "score", "comment" }`；分数 0..maxScore、最多三位小数；失败即整题失败可重试 |

### 7. 模型与资产

- 声学模型：`charsiu/en_w2v2_ctc_libris_and_cv`，固定 revision `70f5061…`；tokenizer 为 `charsiu/tokenizer_en_cmu`。
- 上游没有可直接下载的 ONNX：[`scripts/export-pronunciation-model.py`](../../scripts/export-pronunciation-model.py) 导出 fp32（opset 17、动态时间轴）后只对 MatMul 做 INT8，产物约 122 MB。
- 4 个运行时资产（config / vocab / preprocessor_config / `onnx/model_quantized.onnx`）固定到 Release `pronunciation-model-v1.0.0`，清单记录 size 与 SHA-256（[`scripts/pronunciation-model-assets.json`](../../scripts/pronunciation-model-assets.json)）。
- 安装与 CI 只运行 [`scripts/download-pronunciation-model.js`](../../scripts/download-pronunciation-model.js) 下载并校验，已一致则跳过；重新导出用 `--export`，发布用 [`scripts/publish-pronunciation-model.mjs`](../../scripts/publish-pronunciation-model.mjs) + `gh release create`。
- CI：[`.github/workflows/pronunciation-model.yml`](../../.github/workflows/pronunciation-model.yml) 手动触发，`verify` 只导出核对，`publish` 额外发布新 Release。
- 打包：worker 与 onnxruntime/ffmpeg 原生文件从 asar 解包（`electron-builder.yml` 的 `asarUnpack`）。

### 8. 数据契约

**发音评测结果（schema 2）**关键字段：

- 元信息：`schema_version`、`acoustic_model`、`inventory`、`dictionary_source`、`reference_text`、`uncovered_words`、`alignment_path_score`。
- `recognized_phones` / `recognized_phones_ipa`：greedy 观测音素流。
- `phones[]`：扁平音素行，含 expected / observed / acoustic_winner、两类 log posterior 均值、GOP、`confidence`、起止时间与对齐信息。
- `words[]`：词级记录，含 expected ARPAbet/IPA、时间区间、嵌套音素行。

**证据包**：在音素行上增加 `evidence_id` 与 selection/context 说明（阈值、词窗、观测来源、解释边界），完整 ASR 转写随请求发送。

**LLM 输出**：

- ①：不超过两段的中文纯文本纠错说明。
- ②：仅 `{ "score": number, "comment": string }`。

### 9. 失败与降级

| 场景 | 行为 |
| --- | --- |
| 没有音素越过 `-0.35` | 不调用 LLM①，生成确定性的保守说明 |
| 词典缺词 | 屈折回退 → 仍缺则剔出对齐，记入 `uncovered_words`；① 仅在缺词时附「不要猜测这些词」 |
| 全部词缺词 / 空 ASR 转写 | 抛 `NO_DICTIONARY_COVERAGE:`；跳过 GOP 与①；② 附加「必须 0 分 + 说明原因 + 仅按内容参考分」政策；解析后程序强制归零 |
| 多段录音中任一段全缺词/无有效语音 | 整题 0 分 |
| ASR 或声学步骤失败 | 该评分单元 failed，不产分；整场继续，重试成功后才能完成/审查 |
| LLM② 返回无效 JSON | 该单元 failed，要求重试；不自动修复模型 JSON |

### 10. 已知局限与风险

1. **阈值未重标**：`-0.35` 与 `confidence` 是旧 eSpeak 模型标定的，换 charsiu 后 GOP 分布整体上移，阈值现在偏宽松。
2. **无人工审计集**：没有带音素标签的中国学生语料，无法给出 precision/recall/MDD F1；误报率未知。
3. **GOP 不是错误概率**：低值可能来自模型混淆、对齐边界、连读/弱读、合法变体；结果必须人工复听。
4. **ASR 错词污染参考**：自由表达用 ASR 转写当参考，错词会改变对齐目标，甚至进入②的评语。
5. **只评发音**：不评语法/内容/流利度/语调；自由表达的词级结论强度应低于朗读。
6. **v4 放弃逐条审计**：不再逐 ID/逐音素校验，审计依赖 trace 中的完整证据与原始响应。
7. **长录音算力**：exact GOP 不可行，自动回退 Viterbi；仅 CPU 推理。
8. **工程/许可遗留**：eSpeak GPL 残留（sherpa-onnx 预编译库）、上游模型 license 未决、FFmpeg 对应源码未闭合、worker 提前退出不 reject `state.ready`、扩展包不校验固定 manifest（详见 [licensing-audit.md](../../docs/engineering/licensing-audit.md)）。

### 11. 运行与验证

- 环境检查：`textpa doctor --cache-dir models`（研究侧）；模型资产下载：`node scripts/download-pronunciation-model.js`。
- 端到端发音证据：`node scripts/test-pronunciation.js`。
- 单元测试：`pronunciation.test.ts` 13 例、`speech-correction.test.ts` 7 例、`engine.test.ts` 6 例，覆盖 Viterbi 原始字段、冻结样本 15 条证据/9 个词窗、完整证据随请求发送、纯文本透传、无低 GOP 跳过模型、缺词剔除、全缺词强制 0 分、严格 JSON 等。
- 运行时回归：`xvfb-run -a yarn test:smoke`；跨模块改动跑完整 Electron 集成测试。

### 12. 后续工作

| 优先级 | 工作 | 验收标准 |
| --- | --- | --- |
| P0 | 建 20–50 条人工音素审计集（正确/疑似/错误/无法判断） | 给出当前规则的误报率、漏报率 |
| P0 | 用中国学生语料重标 `-0.35` 与 `confidence` | 误报率-召回率曲线，阈值有数据依据 |
| P0 | 当前方案在完整作答包上重跑端到端 | 可对照的新结果 |
| P1 | worker 退出路径、扩展包 manifest 校验 | 对应 follow-up 关闭 |
| P1 | eSpeak 残留、上游模型 license、FFmpeg 源码 | 许可审计关闭 |
| P2 | 词边界/对齐质量（MFA/WhisperX/ctc-segmentation 评估） | 在审计集上比较 |
| P2 | 诊断/评分分层：P-/F-/U- 稳定 ID 记录 | 诊断与评分解耦，支持复核与拒答 |
| P2 | 流利度/韵律特征（F0、时长、强度、停顿） | 独立于发音维度的可核验证据 |

### 13. 参考文件

- 研究总览：[textpa/README.md](../README.md)
- 基准与模型对照：[textpa/BENCHMARK.md](../BENCHMARK.md)
- v4 表述与模型切换：[textpa/PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md](../PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md)
- v3 冻结协议：[textpa/PRONUNCIATION_GOP_LLM_V3_FREEZE.md](../PRONUNCIATION_GOP_LLM_V3_FREEZE.md)
- 诊断线进展与限制：[textpa/PRONUNCIATION_GOP_PROGRESS.md](../PRONUNCIATION_GOP_PROGRESS.md)
- 研究暂停点与分层建议：[textpa/RESEARCH_PAUSE.md](../RESEARCH_PAUSE.md)
- 后续论文与部署启示：[textpa/RELATED_WORK.md](../RELATED_WORK.md)
- 真实作答包评估：[pronunciation-report-666666.md](../../pronunciation-report-666666.md)、[ai-pronunciation-feedback-666666.md](../../ai-pronunciation-feedback-666666.md)、[ai-grading-report-666666.md](../../ai-grading-report-666666.md)
- v3/v4 对照实验：[HANDOFF-plain-text-correction.md](../../HANDOFF-plain-text-correction.md)
- 产品功能说明：[features/ai-grading.md](../../features/ai-grading.md)
- 实现入口：[pronunciation.ts](../../packages/grading-engine/src/pronunciation.ts)、[speech-correction.ts](../../packages/grading-engine/src/speech-correction.ts)、[index.ts](../../packages/grading-engine/src/index.ts)
- 许可审计：[docs/engineering/licensing-audit.md](../../docs/engineering/licensing-audit.md)
