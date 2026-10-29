# 技术方案调研

- 整理日期：2026-10-29
- 基线：`dev@e54ff72e`
- 作用：记录本项目在候选方案之间做过的对照实验、取舍理由和证据；候选清单见 [01-existing-solutions.md](01-existing-solutions.md)，落地结果见 [03-final-report.md](03-final-report.md)。
- 口径：所有数字来自本仓库可复算的数据；样本量小、无人工音素真值的地方会明确标注。

## 1. 调研方法与指标

- 固定数据：
  - MultiPA 作者公开的 50 条 acoustic cues + 五位标注者分数。
  - 四极值锚点实验：4 条锚点 + 46 条评估（Luna max）。
  - 真实作答包 666666：12 段录音 / 11 个评分单元。
  - CTC 参考 A/B：3 条固定样本，同一份 ONNX logits 对齐两遍。
  - `.gop-research/`：单条长录音与 MultiPA 单样本的三种 GOP 实现对照。
- 方法：同音频/同参考对照；模型固定 revision；PCC 用标注分数重算；差值用 20,000 次 paired bootstrap 估区间；关键数字独立重算过。
- 指标：句级 PCC、MAE/RMSE/Spearman、音素清晰率（`gop_log_ratio > -0.35` 占比）、high 候选数、DER/FAR（引用他人结果时）。

## 2. 参考表示：eSpeak IPA vs CMUdict ARPAbet

**候选**：eSpeak 全句 IPA（与多语言模型词表一致） vs CMUdict ARPAbet + 手写 IPA 映射。

**实验**（[ctc-espeak-reference-ab](../benchmark-data/ctc-espeak-reference-ab/README.md)）：3 条固定样本，一次 ONNX 推理、同一份 logits 分别用 CMUdict 与 eSpeak `en-us` 参考做 CTC 强制对齐，不调用 LLM。

| 指标 | CMUdict | eSpeak |
| --- | ---: | ---: |
| 平均实验音素分 | 71.67 | 73.33 |
| high 候选数 | 60 | 52 |

eSpeak 参考消除了 `computer`（`/t/` vs `/ɾ/`）、`reliable`（`/ə/+/l/` vs `/əl/`）、`are`（`/ɚ/` vs `/ɑːɹ/`）等表示伪差异，三条路径分数都更高。

**判断**：eSpeak 参考在旧多语言模型下略优，但样本只有 3 条、无人工真值，复合 token（如 `/ɔːɹ/` vs `/ɔː/+ɹ/`）仍需等价对齐，作者自己的结论也只是「可作为下一轮参考基础，不足以直接送 LLM」。9-30 切换英文 CMU 音素模型后，模型词表本身就是 CMU/ARPAbet，CMUdict 可直接对齐、无需 IPA 映射，也不再引入 eSpeak 运行时与 GPL 复杂度，因此**最终采用 CMUdict**；eSpeak 的 A/B 结论保留为历史依据，不作为当前链路组件。

## 3. 声学模型：多语言 eSpeak 模型 vs 英文 CMU CTC 模型

**候选**：`facebook/wav2vec2-lv-60-espeak-cv-ft`（多语言 IPA） vs `charsiu/en_w2v2_ctc_libris_and_cv`（39 个英文 CMU 音素）。

**证据**（[V4 文档第 7 节](../PRONUNCIATION_GOP_LLM_V4_PLAINTEXT.md)）：

- 应用侧 recording-11 与研究侧同音频、同 2996 帧，但清晰率 46.2% vs 96.7%、均 GOP −0.845 vs +6.592、低 GOP 行 241 vs 15。
- 多语言模型在长自由表达上把英语判成带声调普通话音素；39 个英文音素只分到约 7% 概率质量。把 softmax 限制到 39 个英文音素后 GOP 结果不变，说明是模型声学判断错误，不是词表稀释。
- 换 charsiu 后，同一批 12 段录音清晰率从 27.4%–84.8% 提升到 90%–100%；recording-2 27.4%→98.3%，recording-5 45.8%→95.5%，recording-11 46.2%→95.5%。
- INT8 与 fp32 在本批数据上几乎无差（95.5% vs 95.7% 清晰）。

**判断**：采用 charsiu 英文 CMU CTC。阈值 `-0.35` 与 `confidence` 是旧模型标定的，换模型后分布整体上移，需重新标定（见第 13 节）。

## 4. GOP 算法：exact CTC-GOP vs Viterbi GOP

**候选**：exact CTC-GOP-S（wildcard denominator）、CTC-GOP-SD、有界 Viterbi GOP。

**证据**（[.gop-research/README.md](../../.gop-research/README.md)、`ctc-gop-*-result.json`）：同一录音 116 音素 / 746 帧，三种实现平均 GOP 分别为 −0.1241 / −0.1245 / −0.1283，两两 Pearson r ≈ 0.9993–0.99999，仅 4 个音素低于 −1.0。60 s 录音（449 音素 / 2996 帧）的 exact 估算工作量约 1.2e9，远超 2e6 预算。

**判断**：短输入可 exact，长输入自动回退 Viterbi；产品默认 Viterbi，`--gop-method exact` 仅用于短样本核对。三种实现差异在现有数据上可忽略，**长录音可算性**是硬约束。

## 5. LLM 职责：LLM-only 评分 vs 两段式（证据整理 + rubric 评分）

**候选**：LLM 直接看 transcript/CMU/IPA 给 1–5 分；或先由声学模块产出可核验证据，再由 LLM 表述和评分。

**证据**：

- 论文本身：LLM-only MultiPA 0.643/0.650，融合 IPA match 后 0.728/0.650；说明单靠文本 LLM 有上限。
- Prior over Evidence：39.6% 的 LLM 判定属于「理由自洽但结论错误」，支持把诊断职责交给声学模块。
- 产品实测：v3 的 JSON 证据整理把教师近满分朗读的弱读/连读断言成 `likely_issue`，② 给 0.5/1；只改①措辞后 ② 给 1/1。

**判断**：采用两段式——① 只整理声学证据、不给分数；② 依据题目/rubric 和①的文字给分；GOP 数字不进入②。LLM 不得重新猜音素。

## 6. LLM① 输出合同：v3 严格 JSON vs v4 纯文本

| 维度 | v3（已被替换） | v4（当前） |
| --- | --- | --- |
| ① 输出 | 严格 JSON：`summary_zh` / `feedback_items` / `withheld_differences` / `limitations_zh`，逐条 `evidence_id`、逐字复制四个音素字段 | ≤2 段保守中文纯文本，无 JSON/ID/分数/等级 |
| ① 载荷 | 仅局部 `word_contexts`，完整 ASR 转写不进请求 | 完整冻结证据 JSON（含完整转写与扁平证据行） |
| 程序侧 | JSON 解析 + ID 恰好覆盖一次 + 逐字校验，失败整题作废 | 只剥代码围栏 + 非空检查，原文透传 |
| ② | 不变 | 不变 |

**证据**（[HANDOFF-plain-text-correction.md](../../HANDOFF-plain-text-correction.md)）：同一音频、同一个②，v3 的「essential、being 等处有较明显/高置信偏差」导致 0.5/1（教师近满分作答）；v4 的「多为弱读、连读或协同发音造成的低 GOP」得到 1/1。① 长度从 1,781/2,022 字符降到 655/723 字符。

**判断**：采用 v4。代价是放弃 v3 的逐条证据审计结构；完整证据与原始响应保留在 trace 中，审计改为事后查看。

## 7. 参考文本来源：题目原文 vs ASR 临时转写

**候选**：朗读题用题目原文当参考；或所有题型统一用 ASR 转写当参考。

**证据**（[pronunciation-report-666666.md](../../pronunciation-report-666666.md)）：朗读短文要求 30 秒读 119 词（17.8 音素/秒，正常 10–14），ASR 只对上前 68/119 词。用完整原文当参考只有 27.4% 清晰，后三段 GOP 崩到 −3.67/−4.29；改用实际读到的前 68 词后 72.1%。该题 rubric 明确「未读完不扣分」。

**判断**：产品统一用 ASR 转写做 GOP 参考（固定朗读原文只保留给②评分）；这样「没读完」不会被当成「读错」。代价是 ASR 错词会改变参考与对齐目标，已作为已知边界记录。

## 8. 分数口径与校准：cohort min-max vs 部署 1–5 标尺

**候选**：

- 论文式 `paper_cohort_accuracy`：IPA match 与 LLM 分分别在整个测试 cohort 上做 min-max 后等权平均。只能批量评估，单条在线请求没有同款分数。
- `deployment_accuracy_1_5`：固定标尺 + phone-token 匹配，可在线。
- 四极值锚点：用 4 条人工极端分样本做 few-shot 标尺，只评剩余 46 条。

**证据**（[BENCHMARK.md](../BENCHMARK.md)）：四锚点把 Luna max 的 Accuracy 取值从 2 档扩到 17 档，MAE 0.930→0.441，Fluency PCC +0.180；但 20k bootstrap 只有 Fluency 区间为正，Accuracy/融合区间都跨 0。锚点是用全 50 条标签选出的 transductive 实验，不能当无泄漏成绩。

**判断**：在线只使用固定 1–5 部署标尺；cohort 指标只用于离线对照；锚点不部署，作为「标尺拥挤与整体低估」的诊断实验保留。

## 9. LLM 后端：模型与 reasoning effort

**证据**（[BENCHMARK.md](../BENCHMARK.md)，50 条 MultiPA，论文兼容 prompt）：

| 模型 / effort | LLM Accuracy PCC | LLM Fluency PCC | 论文融合 Accuracy |
| --- | ---: | ---: | ---: |
| deepseek-v4-flash 未指定 | 0.482 | 0.563 | 0.631 |
| deepseek-v4-flash max | 0.570 | 0.526 | 0.691 |
| gpt-5.6-sol 未指定 | 0.531 | 0.701 | 0.629 |
| gpt-5.6-sol high | 0.567 | 0.698 | 0.656 |
| gpt-5.6-sol max（单次） | 0.626 | 0.725 | 0.697 |
| gpt-5.6-luna 未指定 | 0.248 | 0.370 | 0.539 |
| gpt-5.6-luna max | **0.669** | 0.660 | **0.724** |

- Luna max 质量最高，但耗时约为 Sol high 的 5.4 倍，只作质量上限。
- Sol max 比 high 高约 0.06 LLM Accuracy，但耗时 18m17s（high 3m32s 的 5.2 倍）。
- DeepSeek max 适合低成本高并发；未指定 effort 时默认行为不稳定。
- 50 条样本不足以证明 Luna max 与 GPT-4o-mini 有差异（bootstrap 区间跨 0）。

**判断**：产品侧文本模型由 AIRouter 选择，不在代码里写死；研究侧部署默认 Sol high，质量优先可试 Luna max，成本优先用 DeepSeek max。另：`deepseek-effort-sweep/README.md` 的「46 条交集」口径与原始数据不一致，`reasoning-rerun-smoke/README.md` 与留存记录矛盾，这两组数字不进入选型结论。

## 10. 缺词与空转写：中止 vs G2P 兜底 vs 剔除并记录

| 方案 | 行为 | 问题 |
| --- | --- | --- |
| 中止整题 | 词典无词直接抛错 | 一个 ASR 错词就让整题失败（`outweigh`→`overweigh` 实测） |
| G2P 兜底 | 用规则生成读音继续对齐 | 非词没有正确读音，会虚构对齐目标、制造假低 GOP 证据 |
| 剔除并记录 | 屈折回退→仍缺则剔出对齐，写 `uncovered_words`；全缺词走 0 分政策 | 目前采用；代价是参考变短、被剔除段成为自由区间 |

**判断**：采用「剔除并记录」。缺词先尝试 `-y/-'s/-s/-es/-ed/-ing` 后缀还原；仍缺则从参考剔除、音频段成为自由区间；全部缺词或空转写时跳过①，② 按政策强制 0 分并给出「仅按内容」参考分，程序侧归零。

## 11. 选型结论汇总

| 维度 | 采用 | 核心理由 | 关键证据 |
| --- | --- | --- | --- |
| 参考表示 | CMUdict ARPAbet | 与 charsiu 词表同体系，无需 IPA 映射，无 eSpeak 运行时 | 3 条 A/B 仅作历史依据 |
| 声学模型 | charsiu en_w2v2 CTC | 英文 CMU 音素，长自由表达不再误判 | recording-11 46.2%→95.5% |
| GOP 算法 | Viterbi（长）/ exact（短） | 三种实现高度一致，长录音 exact 不可算 | r≈0.9993–0.99999 |
| LLM 职责 | 证据整理① + rubric 评分② | LLM 不猜音素；诊断可审计 | v3 0.5→v4 1/1 |
| ① 合同 | v4 纯文本 | 避免断言式措辞带偏评分 | 同音频对照 |
| 参考文本 | ASR 转写 | 避免「没读完=读错」 | 27.4%→72.1% |
| 在线分数 | 部署 1–5 标尺 | cohort min-max 不能单条 | 论文口径限制 |
| 缺词/空转写 | 剔除 + 记录 + 0 分政策 | 不虚构对齐目标，不卡死整题 | outweigh 案例 |
| LLM 后端 | AIRouter 可配置 | 质量/成本可切换 | 50 条对照 |

## 12. 暂不采用 / 待验证

- **MFA、WhisperX、ctc-segmentation**：可能改善词边界，但未做本地对照；当前整句对齐后按参考词聚合已够用。
- **PanPhon 音系特征距离、phonological-feature MDD**：适合「怎么发错」的解释层，需要额外训练/映射与人工校准，暂不进入主链路。
- **TTS-PRISM 十二维 rubric、监督 SpeechLLM**：任务/监督条件不同，暂不采用。
- **商用发音评估 API**：未实测，不比较。

## 13. 调研局限

- CTC 参考 A/B 只有 3 条、无人工真值，且结论属于切换 charsiu 之前的参考体系对照。
- 真实作答包只有 12 段、单次采样，8.25/10 是旧 v3+eSpeak 口径，不能代表当前方案。
- 四锚点实验 transductive；50 条 MultiPA 主要覆盖中文母语者英语。
- 尚无人工标注的音素审计集，因此没有 precision/recall/MDD F1，阈值仍是研究侧旧竞争集上定的。
- 两处文档与原始数据不一致（见第 9 节末），引用时需以 JSONL/报告为准。
