# 最终采用的技术报告：语音评测（发音诊断）方案

- 版本：2026-10-29 整理
- 基线：`dev@e54ff72e`（`refactor/test/textpa` / PR #37 已合入）
- 范围：Electron 应用 AI 批改中的**发音诊断链路**（`@ls101/grading-engine`）；TextPA 论文式句级评分仅保留在研究/benchmark 侧。
- 配套文档：[01-existing-solutions.md](01-existing-solutions.md)、[02-technical-survey.md](02-technical-survey.md)

## 1. 摘要

1. 当前方案不是「把音频交给大模型打分」，而是：**本地 ASR → CMUdict 参考音素 → 英文 CMU-phone CTC 强制对齐与 GOP → 阈值筛选 → LLM① 保守中文纠错说明 → LLM② 按 rubric 评分**。
2. 核心设计原则：声学模块只产出可核验证据，LLM 只表述和评分，不重新猜音素；低 GOP 不等于发音错误，结果定位为练习级反馈 + 人工复听辅助。
3. 已落地：v4 纯文本合同、charsiu 英文声学模型、缺词/空转写降级与 0 分政策、模型 Release 化与免 Python 安装；当前主要缺口是**阈值重标定**和**人工标注审计集**。

## 2. 目标与非目标

**目标**

- 对朗读与自由表达录音给出逐词/逐音素的保守发音证据，并生成可读的中文纠错说明。
- 把发音证据作为文本评分的一个输入，最终输出 `{ score, comment }`。
- 全链路可追溯：每条证据能追溯到参考音素、声学赢家、GOP、时间区间和原始响应。

**非目标**

- 不替代真人评分，不做正式考试定级；句级分数只做练习级排序。
- 不评语法、内容、措辞、停顿、流利度、音高、重音、语调、音量、情绪。
- 不输出「已确认发音错误」的断言；GOP/`confidence` 不是校准概率。

## 3. 总体架构

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
                    LLM① v4：≤2 段保守中文纯文本
                                              ↓
        LLM②：题目 + rubric + 转写 + 纠错说明 → 严格 { "score", "comment" }
```

## 4. 流程规格

| 阶段 | 实现 | 关键参数 / 行为 |
| --- | --- | --- |
| ASR | AIRouter 内置 `qwen3-asr-0.6b-int8`（Qwen3 0.6B int8 + Silero VAD） | 评分单元顺序执行；空转写进入降级路径 |
| 参考音素 | `cmu-pronouncing-dictionary`，只取英文词 | 多读音组合上限 32；缺词先按 `-y/-'s/-s/-es/-ed/-ing` 回退 |
| 音频解码 | ffmpeg-static | 16 kHz、单声道、float32、归一化 |
| 声学推理 | charsiu `en_w2v2_ctc_libris_and_cv`（wav2vec2-base） | 39 个无重音 CMU/ARPAbet 音素 + `[SIL]/[UNK]/[PAD]`；ONNX Runtime CPU；worker 以 fork+IPC 隔离 |
| 对齐 | greedy CTC 观测 → 词典变体 + 音素编辑距离选候选（前 8）→ CTC Viterbi 整句对齐 | `[PAD]` 为 blank；保留逐帧时间戳 |
| GOP | 对齐窗内 39 音素平均 log posterior 期望 − 其余音素 log-sum-exp | `confidence = min(1, abs(gop) / 4)` |
| 证据筛选 | 全部 `gop_log_ratio ≤ -0.35` 的音素行，无额外语义筛选 | 问题词前后各最多 2 个 ASR 词；稳定 `evidence_id`（`GOP-0000`） |
| LLM① | `gop-llm-word-context-v4` 固定 system message | `temperature=0`、单次 `maxOutputTokens=65535`、≤2 段中文纯文本；只剥代码围栏 + 非空检查 |
| LLM② | 组装 Schema 类型/满分/静态输入/rubric/额外提示词/转写/correction | 严格 `{ "score", "comment" }`；分数 0..maxScore、最多三位小数；失败即整题失败可重试 |

## 5. 模型与资产

- 声学模型：`charsiu/en_w2v2_ctc_libris_and_cv`，固定 revision `70f5061…`；tokenizer 为 `charsiu/tokenizer_en_cmu`。
- 上游没有可直接下载的 ONNX：[`scripts/export-pronunciation-model.py`](../../scripts/export-pronunciation-model.py) 导出 fp32（opset 17、动态时间轴）后只对 MatMul 做 INT8，产物约 122 MB。
- 4 个运行时资产（config / vocab / preprocessor_config / `onnx/model_quantized.onnx`）固定到 Release `pronunciation-model-v1.0.0`，清单记录 size 与 SHA-256（[`scripts/pronunciation-model-assets.json`](../../scripts/pronunciation-model-assets.json)）。
- 安装与 CI 只运行 [`scripts/download-pronunciation-model.js`](../../scripts/download-pronunciation-model.js) 下载并校验，已一致则跳过；重新导出用 `--export`，发布用 [`scripts/publish-pronunciation-model.mjs`](../../scripts/publish-pronunciation-model.mjs) + `gh release create`。
- CI：[`.github/workflows/pronunciation-model.yml`](../../.github/workflows/pronunciation-model.yml) 手动触发，`verify` 只导出核对，`publish` 额外发布新 Release。
- 打包：worker 与 onnxruntime/ffmpeg 原生文件从 asar 解包（`electron-builder.yml` 的 `asarUnpack`）。

## 6. 数据契约

**发音评测结果（schema 2）**关键字段：

- 元信息：`schema_version`、`acoustic_model`、`inventory`、`dictionary_source`、`reference_text`、`uncovered_words`、`alignment_path_score`。
- `recognized_phones` / `recognized_phones_ipa`：greedy 观测音素流。
- `phones[]`：扁平音素行，含 expected / observed / acoustic_winner、两类 log posterior 均值、GOP、`confidence`、起止时间与对齐信息。
- `words[]`：词级记录，含 expected ARPAbet/IPA、时间区间、嵌套音素行。

**证据包**：在音素行上增加 `evidence_id` 与 selection/context 说明（阈值、词窗、观测来源、解释边界），完整 ASR 转写随请求发送。

**LLM 输出**：

- ①：自然语言中文纯文本，不输出 JSON、键值对、表格、代码块、标题、`evidence_id` 或分数等级。
- ②：仅 `{ "score": number, "comment": string }`，不接受 Markdown 代码块、解释文字或额外字段。

## 7. 失败与降级

| 场景 | 行为 |
| --- | --- |
| 没有音素越过 `-0.35` | 不调用 LLM①，生成确定性的保守说明 |
| 词典缺词 | 屈折回退 → 仍缺则剔出对齐，记入 `uncovered_words`；① 仅在缺词时附「不要猜测这些词」 |
| 全部词缺词 / 空 ASR 转写 | 抛 `NO_DICTIONARY_COVERAGE:`；跳过 GOP 与①；② 附加「必须 0 分 + 说明原因 + 仅按内容参考分」政策；解析后程序强制归零 |
| 多段录音中任一段全缺词/无有效语音 | 整题 0 分 |
| ASR 或声学步骤失败 | 该评分单元 failed，不产分；整场继续，重试成功后才能完成/审查 |
| LLM② 返回无效 JSON | 该单元 failed，要求重试；不自动修复模型 JSON |

## 8. 评测结果

### 8.1 论文复现（MultiPA，50 条）

| 后端 | Accuracy PCC | Fluency PCC |
| --- | ---: | ---: |
| 论文 GPT-4o-mini LLM-only | 0.643 | 0.650 |
| 论文 Gemini 2.0 Flash LLM-only | 0.554 | 0.557 |
| 论文最终 IPA 融合，GPT-4o-mini | 0.728 | 0.650 |
| 论文最终 IPA 融合，Gemini 2.0 Flash | 0.697 | 0.557 |
| 本复现 eSpeak NG 1.51 重算 | 0.733 | 0.700 |

LLM-only 可精确复算；最终融合只能近似（论文未发布 canonical IPA、融合输出与 eSpeak 版本）。详见 [BENCHMARK.md](../BENCHMARK.md)。

### 8.2 模型与 effort 对照（50 条）

- Luna max 融合 0.724，质量最高，耗时约为 Sol high 的 5.4 倍。
- Sol high 融合 0.656；Sol max 0.697，只作质量上限。
- DeepSeek max 融合 0.691，低成本高并发。
- 50 条样本不足以证明 Luna max 与 GPT-4o-mini 有显著差异。

### 8.3 真实作答包（candidate 666666，旧管线）

- 12 段录音 / 11 个评分单元，总分 **8.25/10**（v3 + eSpeak 旧模型口径）。
- 同音频同②对照：v3 的 JSON 措辞使教师近满分朗读得 0.5/1，v4 纯文本得 1/1。
- 三个关键问题：朗读短文截断伪影（27.4%→72.1%）、recording-11 应用/研究侧分歧（46.2% vs 96.7%）、CMUdict 缺词导致整题失败。
- **注意**：这是旧管线结果，不是当前 v4+charsiu 方案的全量评估；当前方案尚未在同一作答包上重跑端到端。

### 8.4 声学模型切换后（同一批 12 段录音）

| 录音 | 旧清晰率 | 新清晰率 |
| --- | ---: | ---: |
| 0 朗读句子 | 79.3% | 98.3% |
| 2 朗读短文 | 27.4% | 98.3% |
| 5 看图说话 | 45.8% | 95.5% |
| 11 观点题 | 46.2% | 95.5% |

12 段整体从 27.4%–84.8% 提升到 90%–100%。但短句样本量小，90%–100% 不能当作准确率；阈值仍待重标。

## 9. 已知局限与风险

1. **阈值未重标**：`-0.35` 与 `confidence` 是旧 eSpeak 模型标定的，换 charsiu 后 GOP 分布整体上移，阈值现在偏宽松。
2. **无人工审计集**：没有带音素标签的中国学生语料，无法给出 precision/recall/MDD F1；误报率未知。
3. **GOP 不是错误概率**：低值可能来自模型混淆、对齐边界、连读/弱读、合法变体；结果必须人工复听。
4. **ASR 错词污染参考**：自由表达用 ASR 转写当参考，错词会改变对齐目标，甚至进入②的评语。
5. **只评发音**：不评语法/内容/流利度/语调；自由表达的词级结论强度应低于朗读。
6. **v4 放弃逐条审计**：不再逐 ID/逐音素校验，审计依赖 trace 中的完整证据与原始响应。
7. **长录音算力**：exact GOP 不可行，自动回退 Viterbi；仅 CPU 推理。
8. **工程/许可遗留**：eSpeak GPL 残留（sherpa-onnx 预编译库）、上游模型 license 未决、FFmpeg 对应源码未闭合、worker 提前退出不 reject `state.ready`、reasoning 开启仍发 `temperature=0`、扩展包不校验固定 manifest（详见 [licensing-audit.md](../../docs/engineering/licensing-audit.md)）。

## 10. 运行与验证

- 环境检查：`textpa doctor --cache-dir models`（研究侧）；模型资产下载：`node scripts/download-pronunciation-model.js`。
- 端到端发音证据：`node scripts/test-pronunciation.js`。
- 单元测试：`pronunciation.test.ts` 13 例、`speech-correction.test.ts` 7 例、`engine.test.ts` 6 例，覆盖 Viterbi 原始字段、冻结样本 15 条证据/9 个词窗、完整证据入 prompt、纯文本透传、无低 GOP 跳过模型、缺词剔除、全缺词强制 0 分、严格 JSON 等。
- 运行时回归：`xvfb-run -a yarn test:smoke`；跨模块改动跑完整 Electron 集成测试。

## 11. 后续工作

| 优先级 | 工作 | 验收标准 |
| --- | --- | --- |
| P0 | 建 20–50 条人工音素审计集（正确/疑似/错误/无法判断） | 给出当前规则的误报率、漏报率 |
| P0 | 用中国学生语料重标 `-0.35` 与 `confidence` | 误报率-召回率曲线，阈值有数据依据 |
| P0 | 当前 v4+charsiu 方案在 666666 类完整作答包上重跑端到端 | 与旧 8.25/10 可对照的新结果 |
| P1 | worker 退出路径、reasoning+temperature、扩展包 manifest 校验 | 对应 follow-up 关闭 |
| P1 | eSpeak 残留、上游模型 license、FFmpeg 源码 | 许可审计关闭 |
| P2 | 词边界/对齐质量（MFA/WhisperX/ctc-segmentation 评估） | 在审计集上比较 |
| P2 | 诊断/评分分层：P-/F-/U- 稳定 ID 记录 | 诊断与评分解耦，支持复核与拒答 |
| P2 | 流利度/韵律特征（F0、时长、强度、停顿） | 独立于发音维度的可核验证据 |

## 12. 参考文件

- 研究总览：[textpa/README.md](../README.md)
- 基准与模型对照：[textpa/BENCHMARK.md](../BENCHMARK.md)
- v4 合同与模型切换：[textpa/PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md](../PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md)
- v3 冻结协议：[textpa/PRONUNCIATION_GOP_LLM_V3_FREEZE.md](../PRONUNCIATION_GOP_LLM_V3_FREEZE.md)
- 诊断线进展与限制：[textpa/PRONUNCIATION_GOP_PROGRESS.md](../PRONUNCIATION_GOP_PROGRESS.md)
- 研究暂停点与分层建议：[textpa/RESEARCH_PAUSE.md](../RESEARCH_PAUSE.md)
- 后续论文与部署启示：[textpa/RELATED_WORK.md](../RELATED_WORK.md)
- 真实作答包评估：[pronunciation-report-666666.md](../../pronunciation-report-666666.md)、[ai-pronunciation-feedback-666666.md](../../ai-pronunciation-feedback-666666.md)、[ai-grading-report-666666.md](../../ai-grading-report-666666.md)
- v3/v4 对照实验：[HANDOFF-plain-text-correction.md](../../HANDOFF-plain-text-correction.md)
- 产品功能说明：[features/ai-grading.md](../../features/ai-grading.md)
- 实现入口：[pronunciation.ts](../../packages/grading-engine/src/pronunciation.ts)、[speech-correction.ts](../../packages/grading-engine/src/speech-correction.ts)、[index.ts](../../packages/grading-engine/src/index.ts)
- 许可审计：[docs/engineering/licensing-audit.md](../../docs/engineering/licensing-audit.md)
