# 语音纠错侧线讨论交接记录

记录日期：2026-08-20。

本文记录一次关于现有语音纠错系统误报、音标体系和单词级证据设计的侧线讨论，
供主线程继续设计 CTC + TextPA 停顿 + LLM demo 时参考。本文不包含 API key。

## 用户体验与回归案例

现有系统对近乎完美的朗读过于严格，会把普通自然变体、token 表示差异和很难听辨的
声学差异当成需要教学纠正的问题。下面这段由英语老师朗读，ASR 文本与参考文本完全
一致：

> The rapid development of artificial intelligence has raised important
> questions about the future of employment and the skills that young people
> need to acquire.

系统给出整体音素匹配度 81/100，并列出八个“重点复听”项：

- `artificial`: `/ɑː/ -> /ɑːɹ/`，16/100
- `artificial`: `/ə/ -> /ɪ/`，4/100
- `artificial`: `/ə/ -> /ɚ/`，3/100
- `intelligence`: `/ɛ/ -> /æ/`，3/100
- `about`: `/ə/ -> /ɐ/`，8/100
- `employment`: `/ɛ/ -> /eɪ/`，2/100
- `people`: `/ə/ -> /əl/`，3/100
- `need`: `/iː/ -> /ɪ/`，2/100

这个案例应加入人工审计回归集。期望行为不是把八项换一种措辞继续报告，而是对没有
充分证据、不可稳定听辨或不影响理解的项目输出 `no_issue` / `uncertain`，多数情况下
不向用户展示。

## 对误报原因的判断

产品内模型为 `facebook/wav2vec2-lv-60-espeak-cv-ft`，但参考音素来自 CMUdict 加
手写 ARPAbET 到 IPA 映射。模型词表和 eSpeak 本身含有复合 token，例如：

```text
/ɑːɹ/          对比 /ɑː/ + /ɹ/
/əl/           对比 /ə/ + /l/
/ɚ/            对比 /ə/ + /ɹ/ 或不同口音下的弱读表示
```

因此，一部分极低分来自表示体系和 token 边界不一致，而不是发音错误。强制对齐若只
允许目标 token 与单个候选 token 一一竞争，遇到一对多、多对一和复合 token 时还会
造成后续音素连锁错位。

当前所谓 `confidence` 主要反映模型标签之间的 logit margin，并不等于“这个人确实
读错的概率”。长句固定挑选分数最低的若干项，也会从正常语音中系统性挑出伪异常。

## eSpeak 能解决什么

项目改为 AGPL 后，可考虑固定 eSpeak NG 版本，并让参考发音、模型词表和 tokenizer
使用同一套 eSpeak IPA 约定。这能显著减少音标符号、复合 token、重音和弱读表示导致
的误报。

它不能单独解决以下问题：

- 合法口音和自然弱读的容许范围；
- 两个音素在感知上是否足够接近；
- 正确发音在声学模型中经常被混淆成哪些标签；
- 某个差异是否值得对学习者展示。

eSpeak NG 是 `GPL-3.0-or-later`。GPLv3 与 AGPLv3 代码组合需要按许可证第 13 节及
相应源码、许可和通知义务处理；这只是工程层面的初步判断，不是法律意见。使用前还应
固定版本、语言/口音和 phonemization 参数，避免不同机器输出漂移。

## 相似音素的建议处理层次

没有发现 eSpeak 生态内可直接当作“英语学习者近似发音容许库”的成熟、已校准组件。
更实际的是分三层处理：

1. 确定性归一化和等价图：先处理 `/ɑːɹ/ <-> /ɑː/ + /ɹ/`、
   `/əl/ <-> /ə/ + /l/`、塞擦音、重音、长度符号和 Unicode 组合形式。
2. 音系特征距离：PanPhon（MIT）可把 IPA 映射为发音部位、发音方式、清浊、元音
   高低/前后、圆唇、长度等特征，并计算 feature edit distance。它适合做软成本和
   候选过滤，但不是经过学习者数据校准的错误概率。
3. 数据驱动混淆和 GOP/MDD：用确认读对的教师或母语者录音估计“正确发音时模型会
   输出什么替代 token”，再用人工标签校准是否告警。Kaldi 的 SpeechOcean762
   GOP/MDD recipe 可作为实现参考。

静态音素距离只能说明发音特征接近，最终展示阈值仍应由“正确朗读误报率”和人工可
感知性来校准。产品目标应优先压低误报，不能仅按每句最差音素排序。

## 单词级对齐方案

可以做到单词级对齐，而且这比直接让 LLM 解释整句音素串更合适。推荐保留整句音频和
上下文，不要先把音频硬切成独立单词：连读、协同发音和词边界本来就会跨词，预切割会
引入新误差。

推荐链路：

```text
参考文本规范化
  -> 全句 CTC 强制对齐
  -> 按参考音素所属单词聚合时间范围和 posterior
  -> ASR 单词序列与参考单词序列做编辑距离对齐
  -> 合并 TextPA / Charsiu 停顿证据
  -> token 等价归一化、近音过滤和证据质量门控
  -> 每词证据包交给 LLM 做保守解释
```

ASR 与参考文本的单词对齐应显式标记 `match`、`substitution`、`deletion` 和
`insertion`。需要更可靠边界时，可评估 MFA、`ctc-segmentation`、WhisperX，或使用
字符/subword CTC 得到词边界后，再与音素 CTC 证据组合。

现有产品代码已经有 `groupPhonesByWord` 一类按词聚合逻辑，因此第一版未必需要更换
对齐器；重点是改进证据协议、归一化和告警决策。

建议给 LLM 的每词证据包至少包含：

```json
{
  "word": "artificial",
  "time": [1.24, 2.03],
  "canonical_variants": ["..."],
  "observed_phones": ["..."],
  "normalized_alignment": ["..."],
  "phone_posteriors": [],
  "alignment_quality": 0.0,
  "asr_word": "artificial",
  "asr_confidence": 0.0,
  "pause_evidence": [],
  "allowed_variants": [],
  "candidate_issue_ids": []
}
```

LLM 的职责应是结合单词、上下文和受约束证据判断差异是否清晰、可感知、值得教学
纠正，并把已验证事实改写成人话。LLM 不应凭一条自由解码 IPA 猜错误，也不应绕过
前置的 token 归一化、近音容许和证据门控。

## 给主线程 demo 的约束

主线程正在准备的 CTC + TextPA 停顿 + LLM 独立 demo，建议按以下原则调整：

- 使用固定版本 eSpeak，确保参考和模型 token 约定一致；同时保留原始 token 与归一
  化后 token，方便审计。
- CTC 在整句上运行，再聚合为单词证据；TextPA/Charsiu 只补充停顿证据。
- 将上述教师朗读案例视为关键负例：没有清晰教学价值时应输出“未发现需要纠正的
  问题”，不能为了产出而凑满若干项。
- 对证据冲突、对齐质量差、ASR 与参考不一致的情况允许 `uncertain`，且默认不展示。
- LLM 只能引用系统生成的稳定证据 ID，并保留完整原始输入、归一化过程和输出以供人工
  复核。
- 先随机选 2 至 3 条音频人工评判，不需要批量评测；评判重点是事实正确率和误报，而
  不是反馈条数。

## 相关代码入口

- `packages/grading-engine/src/pronunciation.ts`
- `packages/airouter/src/main/pronunciation-assessment-worker.ts`
- `packages/renderer/src/features/submissions/SubmissionAIRouterAdapter.ts`
- `externals/ai/pronunciation/model/facebook-wav2vec2-lv-60-espeak-cv-ft-int8/vocab.json`
- `textpa/src/textpa_repro/acoustic.py`
- `textpa/src/textpa_repro/alignment.py`
- `textpa/src/textpa_repro/scoring.py`
- `textpa/RESEARCH_PAUSE.md`

## 尚待验证

- 用统一 eSpeak tokenizer 后，上述八项中有多少会自然消失。
- 一对多、多对一 token 等价对齐的具体实现及其回归测试。
- 正确教师录音上的逐音素/逐词误报率，而不只是 SpeechOcean762 的相关性指标。
- LLM 对单词证据包能否稳定选择 `no_issue`，以及不同 prompt/模型下的一致性。
- 哪些口音变体应作为确定性允许项，哪些应只降低告警置信度。

