# GOP-LLM 纠错协议 v4：纯文本纠错说明（gop-llm-word-context-v4）

冻结日期：2026-08-29。本文记录软件内 AI 批改引擎采用的 `gop-llm-word-context-v4`
协议。它由 2026-08 纯文本纠错实验的最终设计（交接文档 `HANDOFF-plain-text-correction.md`
中的版本 C，脚本 `.cache/pron-work/ai_eval3.mjs`）直接移植而来。

## 1. 与 v3 的关系

证据构建与 v3（`PRONUNCIATION_GOP_LLM_V3_FREEZE.md`）完全一致，未做任何改动：

- 低 GOP 选择：全部 `gop_log_ratio <= -0.35`，无任何语义筛选；
- 问题词上下文：前后各最多两个 ASR 单词；
- 证据 schema 2：扁平音素行 + 词级上下文，逐字复制、完整覆盖、稳定 `evidence_id`。

改动只发生在 LLM 阶段的 **输出合同** 与 **请求载荷**：

| | v3（已被替换） | v4（当前） |
|---|---|---|
| ① 的输出 | 严格 JSON（summary_zh / feedback_items / withheld_differences / limitations_zh），程序逐字校验证据 ID 与四个音素字段 | 不超过两段的保守中文纯文本，无 JSON / ID / 分数 / 等级 |
| ① 的请求载荷 | 仅 word_contexts 等局部上下文，完整 ASR 转写不进请求 | 完整冻结证据 JSON（含完整 ASR 转写与扁平证据行） |
| ① 的程序侧处理 | JSON 解析 + 恰好一次 ID 覆盖 + 逐字校验，失败整题作废 | 剥离意外代码围栏 + 非空检查，原文透传 |
| ②（评分调用） | `buildAIGradingPrompt` + 严格 `{score, comment}` 解析 | 与 v3 完全相同，未改动 |

## 2. 动机（实验对照）

同一份作答包（12 段录音 / 11 个评分单元）、同一个 ②，仅 ① 的输出形态不同：

- 朗读句子（单元 0，高级教师近乎满分的作答）：v3 的 JSON 措辞把 `likely_issue`
  断言成「essential、being 等处有较明显或高置信的发音偏差」，② 给 0.5/1；
  v4 纯文本把同一批低 GOP 描述为「多为弱读、连读或协同发音造成的低 GOP 现象，
  未显示严重发音问题」，② 给 1/1。
- v3 的 ① 输出约 1,800–2,000 字符 Markdown（逐条证据 ID）；v4 约 650–720 字符
  两段纯文本。
- v3 的严格校验一旦失败即整题作废；v4 无结构校验，失败面更小。

完整数据见 `HANDOFF-plain-text-correction.md` 与
`ai-grading-report-666666.md`、`ai-pronunciation-feedback-666666.md`。

## 3. 冻结的 prompt 原文

system prompt（①）：

```text
You are an English pronunciation feedback writer working from CTC-GOP phone evidence.
You cannot hear the audio and may only describe what the supplied reference/observed phone evidence shows.
Write plain natural-language Chinese prose. Never output JSON, key-value pairs, tables, code blocks,
evidence IDs or any kind of score. Never claim a pronunciation error is confirmed.
```

用户 prompt（①，`${JSON.stringify(evidence, null, 2)}` 之前的部分）与实验脚本
逐字一致，实现于 `packages/grading-engine/src/speech-correction.ts` 的
`buildSpeechCorrectionPrompt`；约束要点：

1. 只谈发音，不讨论语法、内容、停顿、流利度、语调等；
2. expected 与 acoustic_winner 不同不等于发音错误，不断言已发错；
3. 只输出不超过两段自然语言中文纯文本，先观察模式、再 1-3 条具体建议。

生成参数沿用 v3：`temperature=0`、单次 `maxOutputTokens=65535`、固定 system message。

## 4. 程序侧响应处理

`normalizePlainTextResponse`：剥离首尾意外出现的 Markdown 代码围栏（与实验脚本的
`plain()` 一致）并要求结果非空；除此之外原文透传，进入 ② 的 `correction` 字段
与面向审查者的展示。没有音素越过阈值时不调用模型，生成确定性的保守纯文本说明。

## 5. 已知边界（继承 v3，未因措辞软化而消失）

- GOP 仍不是校准概率；低值可能来自模型混淆或 CTC 边界偏移；
- ASR 错词仍会改变参考与对齐目标；完整转写进入 ① 请求后，模型仍需自行警惕错词；
- v4 放弃了 v3 的逐条证据审计结构（ID 覆盖、逐字音素复制），换取更保守的整体措辞；
  审计仍可通过 trace 中的完整证据与原始响应进行；
- 阈值仍未用中国学生语料标定，人工复听仍不可省。

## 6. 2026-08-30 增补：词典缺词处理（仍属 v4）
背景：实验中 ASR 把 `outweigh` 转成 `overweigh`，词典无此词，GOP 步骤直接抛错、
该单元无结果（`HANDOFF-plain-text-correction.md` 第五节）。落地处理：

- CMUdict 无法覆盖的转写词（词典缺词或 ASR 非词）不再使 GOP 步骤终止：
  - 先尝试扩展的屈折后缀规则（原 `-y`/`-'s`/`-s`，新增 `-es`/`-ed`/`-ing`）在词典内还原读音；
  - 仍缺的词从强制对齐参考中剔除，评测结果新增 `uncovered_words` 字段记录，
    证据 `source_result` 同步携带；被剔除词的音频段成为自由区间；
  - ① 的 prompt 仅在存在缺词时附加一句「补充：以下单词不在标准发音词典中，未参与
    强制对齐……不要猜测或评价这些单词的发音」；无缺词时 prompt 与实验冻结版逐字一致
    （测试以 endsWith 证据 JSON 钉住）。
- 某答案的全部单词都不覆盖时（含转写中没有英文单词）：worker 抛出带
  `NO_DICTIONARY_COVERAGE:` 前缀的可解析错误（跨 Worker/IPC 只传消息字符串），
  引擎对该答案跳过 GOP 与 ①，correction 写入确定性说明；② 的 prompt 附加评分政策
  指令（本题 score 必须为 0；评语说明原因并给出「如果仅根据内容评分」的参考分），
  程序解析后强制 score=0。多段录音单元中任一段全缺词即整题 0 分。
- 设计理由：ASR 非词不存在正确读音，G2P 兜底会虚构对齐目标、制造假低 GOP 证据；
  剔除并如实记录更符合证据保守原则。② 仍能看到完整转写，读错产生的非词作为
  语言层面的信号保留在评语中。

## 7. 2026-09-30 增补：声学模型换成英文 CMU 音素模型（仍属 v4）

背景：用户反馈应用批改明显比实验偏严。逐段复核后定位到声学模型，而不是 ①/②
的 prompt（两者与实验逐字节一致）：

- 现象：recording-11（60 秒观点题）应用侧 46.2% 音素清晰、均 GOP −0.845、241 行低 GOP
  证据；研究侧同一段音频 96.7%、+6.592、只有 15 行。全卷 1083 行低 GOP 证据中有
  467 行（43%）来自两段长自由表达（5 号看图说话、11 号观点题）。
- 定位：用应用自己的 ONNX 模型与 worker 相同的 FFmpeg 解码路径逐条重跑 12 段录音，
  多语言 eSpeak 模型在长时自由表达上把英语判成带声调的普通话音素
  （`ai5 t y5 p t ts. j i5 p ɚ s ɔː p uei5 w ei5 ph eɪ …`），39 个英文音素只分到
  约 7% 概率质量；把 softmax 限制到 39 个英文音素重算 GOP 结果分毫不变，说明不是
  词表稀释，而是模型自身的声学判断错误。短句与朗读段不受影响（解码正确）。
- 处置：改用英文 CMU 音素 CTC 模型 `charsiu/en_w2v2_ctc_libris_and_cv`
  （wav2vec2-base；词表为 39 个无重音 CMU/ARPAbet 音素 + `[SIL]`/`[UNK]`/`[PAD]`，
  `[PAD]` 为 CTC blank），与研究侧冻结基线同族。只对 MatMul 做 INT8 量化，本批数据上
  与 fp32 几乎无差（95.5% vs 95.7% 清晰）。

切换前后（应用管线，同一批 12 段录音，参考为 ASR 转写，括号为旧模型均值 GOP）：

| 录音 | 旧清晰% | 新清晰% | 录音 | 旧清晰% | 新清晰% |
| --- | ---: | ---: | --- | ---: | ---: |
| 0 朗读句子 | 79.3 | 98.3 | 6 快速应答 | 84.8 | 100.0 |
| 1 朗读句子 | 84.0 | 97.1 | 7 快速应答 | 65.0 | 90.0 |
| 2 朗读短文 | 27.4 | 98.3 | 8 快速应答 | 68.8 | 100.0 |
| 3 情景提问 | 76.4 | 94.6 | 9 快速应答 | 67.6 | 94.1 |
| 4 情景提问 | 82.9 | 97.6 | 10 事实题 | 75.2 | 98.1 |
| 5 看图说话 | 45.8 | 95.5 | 11 观点题 | 46.2 | 95.5 |

阈值、词窗、证据 schema、①/② prompt 都没有变化；动的只是声学模型。资产构建：
`scripts/export-pronunciation-model.py` 把 `charsiu/en_w2v2_ctc_libris_and_cv` 与
`charsiu/tokenizer_en_cmu` 在本地导出为 ONNX（上游没有可直接下载的 ONNX），产物发布成
`pronunciation-model-v1.0.0` Release；安装与 CI 只运行
`scripts/download-pronunciation-model.js` 从该 Release 下载并按 size 与 SHA-256 校验，
不需要 Python。重新导出用 `node scripts/download-pronunciation-model.js --export`
（受限网络可用 `LS101_HF_ENDPOINT` 指向镜像），再用
`node scripts/publish-pronunciation-model.mjs --publish` 发布新 Release。

仍未解决：阈值 −0.35 与 `confidence` 是随旧模型标定的，换模型后分布整体上移，
该阈值现在更宽松，是否重新标定需要中国学生语料；短句（快速应答）样本量小，
90%–100% 的清晰率还不能当作准确率。
