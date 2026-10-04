# AI 评分

`@ls101/grading-engine` 实现评分单元级的 AI 评分编排，作答记录页面负责整场会话、失败重试、审查和最终提交，`@ls101/submission-library` 保存中间状态。客观题仍由客观题引擎处理，不进入 AI 评分引擎。

## 会话与模型

用户开始一场评分会话后选择一次评分方式。AI 模式在整场会话中分别选择一个语音识别模型和一个文本模型；首版语音识别只提供 AIRouter 内置的 `builtin-qwen3-asr/qwen3-asr-0.6b`，文本模型来自 AIRouter 已启用的文本 Provider。

同一场会话可以包含多份作答。评分单元目前顺序执行，不并发调用语音识别或文本模型。已经用相同模型成功生成的评分单元会复用持久化结果；失败和未完成的评分单元会重新执行。

## 单元评分管道

每个非客观评分单元独立执行以下步骤：

1. 按 Schema 答案格式中的稳定顺序处理每个录音答案。
2. 将录音交给 AIRouter 语音识别，得到自然语言转写。
3. 将 ASR 临时转写和原始录音交给发音评测接口，以 CMUdict 生成完整参考音素并执行整句 CTC Viterbi 强制对齐和 GOP 计算。固定朗读原文不用于这一步，避免绕过冻结版的 ASR 输入边界。
4. 选择全部 `gop_log_ratio <= -0.35` 的原始音素行，按问题词组织前后各最多两个 ASR 单词的局部上下文，再由所选文本模型写成不超过两段的保守中文纯文本纠错说明。完整冻结证据 JSON（含完整 ASR 转写与扁平证据行）随该次模型请求发送。
5. 将 Schema 类型、名称、满分、静态输入 Markdown、评分标准、额外提示词、转写和纠错描述组成文本评分 prompt。`fixed-speech` 的原始朗读文本仍作为最终评分材料保留。
6. 调用所选文本模型并严格解析最终结果。

静态附件的二进制内容不发送给模型。Markdown 本身会进入 prompt，因此题目 Markdown 中已经填写的图片描述或提示词仍然可供文本模型使用。

发音评测后端使用内置的英文 CMU 音素 CTC 模型 `charsiu/en_w2v2_ctc_libris_and_cv`（wav2vec2-base；词表为 39 个无重音 CMU/ARPAbet 音素加 `[SIL]`、`[UNK]`、`[PAD]`）。模型输出逐帧 logits；评分引擎只使用与 39 个 CMU 音素一一对应的 uppercase ARPAbet token，`[PAD]` 作为 CTC blank。结果保留完整的扁平音素行和词级记录，包括 CMU/IPA 参考、声学赢家、排除参考后的最强替代项、两类平均 log posterior、GOP、相对证据强度、时间区间和完整词音素序列。

2026-09-30 之前使用 `facebook/wav2vec2-lv-60-espeak-cv-ft` 多语言 eSpeak 模型：它在长时自由表达上会把英语判成带声调的普通话音素（39 个英文音素只分到约 7% 的概率质量），同一段录音产生 241 行低 GOP 误报（研究侧基线只有 15 行），使 ① 的措辞和 ② 的评分系统性偏严。切换后同一批 12 段录音的音素清晰率由 27%–98% 提升到 90%–100%（背景与数据见 `textpa/PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md`）。

模型文件位于 `externals/ai/pronunciation/model/charsiu-en_w2v2_ctc_libris_and_cv-int8`。上游没有可直接下载的 ONNX，因此产物由维护者用 `scripts/export-pronunciation-model.py` 从固定 revision 的权重导出 fp32 ONNX 并只对 MatMul 做 INT8 量化，再通过 `scripts/publish-pronunciation-model.mjs` 按发布名暂存、由 `gh release create` 发布到 `scripts/pronunciation-model-assets.json` 固定的 GitHub Release。安装与 CI 只运行 `scripts/download-pronunciation-model.js` 从该 Release 下载 4 个运行时资产并按 size/SHA-256 校验，不依赖 Python；运行时目录已存在且一致时直接跳过。受限网络可用 `LS101_RELEASE_ENDPOINT` 指向 Release 镜像，重新导出时用 `LS101_HF_ENDPOINT` 指向上游镜像、`LS101_PYTHON` 指定解释器；缓存位置默认在 `externals/ai/` 下，可用 `LS101_PRONUNCIATION_MODEL_ROOT`（运行时资产）与 `LS101_PRONUNCIATION_SOURCE_ROOT`（上游权重缓存，约 377 MB）指到仓库内其他目录（例如 `.cache/pronunciation/`），打包与 `test-pronunciation` 跟随同一个变量。导出也可以在 CI 上完成：`.github/workflows/pronunciation-model.yml`（手动触发，`verify` 只导出核对、`publish` 额外发布新 Release）按 `scripts/pronunciation-model-requirements.txt` 固定 torch / transformers / onnx / onnxruntime 版本，因为换工具链会改变 `onnx/model_quantized.onnx` 的字节与哈希。模型及 ONNX Runtime 在独立 Worker 中运行，不阻塞 renderer。

LLM 后处理遵循 `gop-llm-word-context-v4` 冻结合同（2026-08 纯文本纠错实验的最终设计，背景与对照数据见 `textpa/PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md`）。请求使用固定 system message、`temperature=0` 和单次 `maxOutputTokens=65535`；输出必须是不超过两段的自然语言中文纯文本——不输出 JSON、键值对、表格、代码块、标题、evidence_id 或分数等级，也不得断言发音错误已确认。程序只剥离意外出现的 Markdown 代码围栏并要求结果非空，不再逐条校验证据 ID 或音素字段。没有音素越过阈值时跳过 LLM，并生成确定性的保守说明。

### 词典缺词与发音评测覆盖

转写中的词若不在 CMUdict（词典本身缺词，或学生读错被 ASR 转成非词），先尝试常用屈折后缀规则（`-y`、`-'s`、`-s`、`-es`、`-ed`、`-ing`）在词典内还原读音；仍无法覆盖的词会从强制对齐参考中剔除，记录在评测结果的 `uncovered_words` 字段与纠错证据里，① 的 prompt 仅在存在缺词时附加一句说明，要求模型不要猜测这些词的发音（无缺词时 prompt 与冻结版逐字一致）。被剔除词的音频段成为自由区间，其余词照常对齐评证。

当某段录音的转写没有任何词典可覆盖的英文单词时，该答案不再调用发音评测和 ①，correction 写入确定性说明；② 的评分 prompt 会收到明确的评分政策指令：该评分单元必须输出 0 分，评语必须说明原因，并单独给出「如果仅根据内容评分」可达的参考分。程序在解析模型响应后强制将这类单元的得分归零，不依赖模型自觉。多段录音的评分单元中只要有任一段录音全缺词，即适用整题 0 分政策。

`free-speech` 与 `fixed-speech` 使用同一套基于 ASR 临时转写的 GOP 证据流程；两者都可能受 ASR 错词影响。当前没有针对自由表达的专用发音或评分策略。

## 模型输出契约

文本模型只能返回一个 JSON 对象，不接受 Markdown 代码块、解释文字或额外字段：

```json
{ "score": 4.125, "comment": "Markdown 评语" }
```

对象必须同时满足：

- 只能包含 `score` 和 `comment`；
- `score` 是 `0..maxScore` 内的有限数字；
- `score` 的原始 JSON 数字最多三位小数，`4.1230` 也按超过三位小数判定为无效；
- `comment` 是字符串。

任一语音步骤、文本请求或结果校验失败时，该评分单元不产生分数。整场会话继续处理其他评分单元，所有失败项必须重试成功后才能进入完成或审查阶段。

## 中间状态

`SubmissionGradingRecord.aiRuns` 按评分单元保存：

- 状态：`processing`、`succeeded` 或 `failed`；
- 本次使用的语音识别和文本模型；
- 每个答案的转写、纠错描述及可选参考文本；
- prompt、模型原始响应、校验后的结果或错误消息；
- 审查模式、是否入选、是否已审查及人工编辑后的最终结果。

语音处理和 prompt 生成期间会逐步写入中间结果。退出页面会取消当前请求；重新进入后可复用已经成功保存的单元，并重试未完成单元。评分正式提交后仍记录为 `engine: 'ai'`，即使用户在审查阶段修改了分数或评语。

## 审查流程

整场 AI 生成全部成功后，用户选择一次后续处理方式：

- 完成：不审查，直接提交全部 AI 结果；
- 全部审查：逐题查看并可修改分数和评语；
- 抽查：只审查规则选中的评分单元，其余结果直接提交。

首版抽查规则包括整场抽查题数和按 `schemaId` 分组分别填写抽查题数。相同显示名称但不同 `schemaId` 的 Schema 不会合并。抽查实现通过规则注册表提供分组和默认值，新增同类规则不需要修改评分提交主流程。

审查分数同样限制在满分范围内且最多三位小数。确认某题后结果正式提交，不再在同一会话中二次修改。

## 取消与限制

- 首版只实现 Qwen3 ASR，不提供其他识别 Provider。
- 评分单元和单元内录音均顺序处理，尚未实现有界并发。
- 发音评测目前是实验性能力，GOP 和 `confidence` 不是校准后的发音错误概率，阈值尚未用中国学生语料标定。
- ASR 错词会改变 CMUdict 参考和强制对齐目标；局部上下文不会修复错词。词典缺词不再使整题失败，详见「词典缺词与发音评测覆盖」。
- 全缺词答案按政策强制 0 分并要求评语说明；这不是对内容质量的评价，审查阶段仍可人工改分。
- 连读、弱读、合法口音变体和 CTC 边界偏移仍需人工复听；系统不评估停顿、流利度、音高、重音、语调、音量或情绪。
- 静态附件字节不参与评分，也不直接发送给文本模型。
- 文本模型仍可能产生无效结果；系统只负责拒绝并要求重试，不自动修复模型 JSON。

## 验证覆盖

Vitest 覆盖多录音顺序处理、ASR 对齐文本传递、Viterbi GOP 原始字段、CMU 音素词表布局与 `[PAD]`/`<pad>` blank 解析、冻结样本的 15 条证据和 9 个词窗、完整证据载荷进入纠错请求、纯文本响应原样透传、代码围栏剥离与空响应拒绝、无低 GOP 跳过模型、词典缺词剔除与 `uncovered_words` 记录、缺词时 ① prompt 附加说明且无缺词时保持冻结原样、全缺词答案跳过 ① 且 ② 强制 0 分与政策指令、-es/-ed/-ing 后缀还原、语音失败中止单题、最终评分严格 JSON 和小数精度、AI 中间状态持久化、AIRouter 参数转发、整场完成、审查编辑及按 `schemaId` 抽查分组。Node 脚本测试覆盖固定清单校验、上游元数据比对与扩展包构建；Electron smoke 与 `airouter.spec.ts` 集成用例覆盖 preload 方法、扩展包导入和打包后内置模型运行。

## 代码依据

- `packages/grading-engine/src/index.ts`
- `packages/renderer/src/features/submissions/SubmissionAIRouterAdapter.ts`
- `packages/renderer/src/features/submissions/SubmissionGradingPage.tsx`
- `packages/renderer/src/features/submissions/reviewSampling.ts`
- `packages/submission-library/src/index.ts`
