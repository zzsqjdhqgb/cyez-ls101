# TODO: IndexTTS 英文异音词自动发音消歧（暂不实现）

> 状态：**暂不实现**（维护者决定，2026-10-18 记录）。调研已完成、手动标注已验证有效；
> 处理本 TODO 时从"设计选项"里选路线实现。

## 背景

- 手动 `<word|PHONEMES>` 内联标注**已验证有效**：`<Read|R IY D>`（无重音数字）与
  `<read|R IY1 D>`（官方规范带重音）两种写法都把 exam 文本里的 read 修正为现在时 /riːd/
  （2026-10-18 用户试听确认，产物 `index-tts-exam-pronfix-q8.*` / `index-tts-exam-pronfix2-q8.*`）。
- 但考试文本（指令 + 阅读理解正文）不可能逐词手动标注 → 需要自动化消歧层。

## 已验证的技术事实

- 标注语法：`<word|pronunciation>`，竖线分隔；英文 = CMUdict ARPABET（重音数字可省略，
  引擎自动大写化）；中文 = 全大写拼音+声调数字；日文 = 假名。官方文档：
  index-tts/index-tts（main / v2.5.0 tag，bilibili/IndexTTS 已 404 迁移）README
  "Pronunciation Control"；实现 `indextts/infer_v2_5.py` `apply_pronunciation_annotations`；
  PR #738 保护标注穿过 normalize/切段。
- 引擎侧（audio.cpp `src/models/index_tts2/tokenizer_text.cpp`）：标注在 TN 前被占位符保护、
  切段时是原子块；word 含汉字走 SPECIAL_TOKEN_2，否则 SPECIAL_TOKEN_1。
- read 的 CMUdict 词条：R IY1 D（现在时）/ R EH1 D（过去时）；reed = R IY1 D。
  GPT-SoVITS 按 VBP（动词现在时）POS 消歧这对异音词。
- 标注可靠性：中文拼音路径有失效报告（index-tts issues #625/#792/#669：标注被忽略或声调被改）；
  英文 CMU 路径无失败报告（用例少，非官方保证）。备选兜底：同音词替换（read→reed，
  官方 #129 的旧建议）。

## 调研结论（子代理，2026-10-18，均有来源佐证）

工业界四种做法：
1. **g2p 前置消歧**（g2p_en / GPT-SoVITS 路线）：CMUdict + NLTK POS 标注，送 TTS 前自动把
   异音词展开为 `<word|PHONEMES>`；对受控语料最可靠。
2. **热词典**（GPT-SoVITS `engdict-hot.rep` / Azure PLS lexicon）：领域高频词一次性固化。
3. **LLM 前端**（CosyVoice 路线）：LLM 做 TN + 消歧，覆盖最广（含专有名词）但有成本。
4. **SSML `<phoneme>`**（Azure）：跨引擎可移植，IndexTTS 不支持 SSML，不适用。

## 设计选项（处理时择一或组合）

1. **g2p 前置消歧（推荐主线）**：在 `packages/airouter` 增加合成前文本预处理模块——
   cmudict 数据文件（~3.5 MB 文本，~13.5 万词条，可只保留异音词子集）+ 轻量 POS 标注
   （compromise / wink-pos-tagger 一类）+ 常见英文异音词表（read/live/tear/wind/row/bass/
   lead/close/minute/…）。规则：**只对异音词表命中的词按 POS 展开**，其余文本原样透传，
   避免误伤。用户显式写的 `<word|...>` 标注优先、不被覆盖。
2. **领域热词典（可叠加）**：考试指令固定句式的高频词读音表（如祈使 read→R IY1 D），
   零依赖，作为 1 的兜底/覆盖层。
3. **LLM 消歧（可选）**：备卷时用 AI Router 的 LLM 标注，覆盖专名与词典外词；
   结果进人工抽检流程。

落地位置：IndexTtsSynthesizer 发送前预处理，或模板编译期展开（后者可缓存、可人工审阅）。
需要开关（Provider 参数或模板级），默认开/关待产品决策。

## 处理时的验收标准

- 常见异音词（read/live/tear/wind/minute/close/lead/…）在真实考试语料上自动消歧抽检正确率达标
  （建议 ≥95%，抽样听 + ASR 回转核对）。
- 自动展开不破坏原文其余部分：TN/切段兼容回归通过，合成正常、无标注文本泄漏进音频。
- 手动标注优先级高于自动展开；开关行为在 `docs/engineering/index-tts.md` 有记录。
