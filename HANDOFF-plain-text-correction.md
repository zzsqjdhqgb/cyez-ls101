# 实验记录：语音纠错说明的两种形态（信息交接）

本文件只记录实验做了什么、观察到什么、数据在哪，不含任何改动要求。

## 一、实验对象

同一份作答包（`.lssubmission`，12 段录音 / 11 个评分单元）走 app 的真实调用链：

```
录音 → 本地 ASR(Qwen3 0.6B int8) → 本地 GOP(CMUdict + CTC Viterbi, schema 2)
     → LLM① 生成「语音纠错说明」 → LLM② 依据评分标准输出 {score, comment}
```

两次调用相互独立（各自一条 user message，无对话历史）；**GOP 数字不进 LLM②**，
LLM② 只看到 LLM① 产出的那段文字 + transcript + 题目材料 + rubric。

## 二、实验里跑过的三个版本

| 版本 | LLM① 的输出 | LLM② 的输入 | 数据 |
|---|---|---|---|
| **A. 生产现状**（`gop-llm-word-context-v3` 冻结合同） | 严格 JSON：`summary_zh` / `feedback_items` / `withheld_differences` / `limitations_zh`；每条证据带 `evidence_id` 与逐字复制的四个音素字段，`decision` 分 `likely_issue`(较可能) 与 `needs_listening`(需复听)；渲染成含 ID 的 Markdown | 生产 `buildAIGradingPrompt`（JSON 载荷：inputs 含题目说明与参考答案、rubric、每条答案的 transcript/correction/referenceText） | `ai/`（11 单元全量） |
| **B. ①纯文本 + ②改成只吃三样**（已撤回） | 纯自然语言中文，无 JSON/ID/分数 | 只有三块纯文本：①文本、ASR 转写、评分标准 | `ai2/`（11 单元，2 个失败） |
| **C. ①纯文本 + ②生产原样**（最终设计） | 同 B | **与 A 完全相同** | `ai3-unit-00.json`（只跑了朗读句子） |

## 三、实验里实际使用的 prompt 原文

system prompt（B/C 的 ①）：

```
You are an English pronunciation feedback writer from CTC-GOP phone evidence.
You cannot hear the audio and may only describe what the supplied reference/observed phone evidence shows.
Write plain natural-language Chinese prose. Never output JSON, key-value pairs, tables, code blocks,
evidence IDs or any kind of score. Never claim a pronunciation error is confirmed.
```

用户 prompt（B/C 的 ①；`${JSON.stringify(evidence, null, 2)}` 之前的部分）：

```
请把下面的低 GOP 音素证据写成一段保守的中文发音纠错说明。

输入按“问题单词”组织：每个 `word_context` 是一个至少含有一条低 GOP 音素的单词，
包含该词前后各最多两个 ASR 单词、该词完整的参考音素序列，以及沿强制对齐窗口得到的
声学赢家音素序列；`gop_evidence` 是该词内每一条低 GOP 音素的原始证据。

必须遵守：
1. 你看不到音频。这些证据是程序按阈值选出的声学观测，不是人工标注，也不是错误概率；
   expected 与 acoustic_winner 不同不等于发音错误。
2. `context_words` 和 `context_text` 来自 ASR，可能有错词，只用于提供局部语境。
3. 只谈发音。不要讨论语法、内容、措辞、停顿、流利度、音高、重音、语调、音量、情绪或整体水平。
4. 承认模型混淆、强制对齐边界、连读、弱读和合法变体的可能，不要断言已经发错。
5. 练习建议要落到具体单词或音素，措辞保守。

输出要求：
- 只输出自然语言中文，纯文本：不要 JSON、不要键值对、不要代码块、不要表格、不要标题、
  不要罗列 evidence_id、不要给分数或等级。
- 2 段以内：先说观察到的模式，再给 1-3 条具体建议。

按单词组织的低 GOP 证据 JSON：
```

B 版本的 ② prompt 是三段带【】标题的纯文本（评分标准 / ASR 转写 / 语音纠错说明），满分与输出格式写在指令里。

## 四、观察到的结果

### 4.1 关键对照：朗读句子（单元 0，2 段录音）

同一段音频、同一个 ②：

| 版本 | 得分 | ② 给出的理由（原文摘） |
|---|---:|---|
| A（v3 JSON） | **0.5 / 1** | 「纠错提示多个内容词存在低 GOP、元音及辅音偏差需复听」「essential、being 等处有较明显或高置信的发音偏差提示」 |
| C（①纯文本） | **1 / 1** | 「语音系统标注多为弱读、连读或协同发音造成的低 GOP 现象，未显示严重发音问题。按评分标准，整句流利且重音、停顿合理时，个别单词读错不扣分，故给满分」 |

**用户说明：这条录音是高级教师近乎满分的作答。** 版本 A 中 ① 标出的
`likely_issue`（如 `essential`）属于误报，与 `textpa/SIDE_CONVERSATION_HANDOFF.md`
记录的「教师朗读 81/100 + 8 个重点复听」是同一类现象。

② 在 C 版本里**依然拿得到 `referenceText`**，也仍指出了「第二句将 one's 读作 everyone's」——
差别只来自 ① 的措辞：A 断言了问题，C 不断言。

### 4.2 ① 输出形态的量化差异（朗读句子）

| 版本 | 长度 | 形态 |
|---|---:|---|
| A | 1,781 / 2,022 字符 | Markdown，逐条列证据 ID、原因、练习 |
| C | 655 / 723 字符 | 两段纯文本：模式描述 + 1-3 条练习建议 |
| B | 约 1,300 字符 × 2 | 纯文本，风格同 C |

### 4.3 全量结果

| 版本 | 总分 | 备注 |
|---|---|---|
| A | **8.25 / 10** | 11 单元全部拿到分数；26 次调用；输入 548,509（缓存命中 95%）、输出 501,809（reasoning 80%）、合计 1,050,318 tokens |
| B | 6.5 / 10（9 单元） | 单元 3、9 遇 `fetch failed` 未完成；19 次调用、397,624 tokens |

B 的逐单元：0→1、1→0.75、2→1、4→1、5→0.25、6→0.5、7→0.25、8→0.25、10→1.5。
A 与 B 在内容类评分点上的差异，一个已知来源是 B 的 ② 看不到 `referenceText`/题目说明
（例如「看图说话必须以给定句开头」「朗读原文比对」这类判分点在 B 下失效）。

## 五、其它相关观察（同一批数据）

- **应用侧与研究侧 GOP 分歧**：同一条 60 s 录音（recording-11）、同一份参考、帧数相同（2996），
  研究侧冻结基线 96.7% 音素清晰、均 GOP +6.592；应用侧 46.2%、−0.845，且识别音素序列明显异常。
- **朗读短文截断伪影**：用完整原文当参考 → 27.4% 清晰；改用「实际朗读到的前 68 词」当参考 →
  72.1%。该题要求 30 秒读完 119 词（17.8 音素/秒），而 rubric 明确「未读完不扣分」。
- **CMUdict 缺词**：ASR 把 `outweigh` 转成 `overweigh`，词典无此词 → GOP 步骤直接抛错、
  该单元无结果；手工替换后才跑通，且该错词后来出现在评分评语里被当作语言错误。

## 六、产物位置（仓库根 = `/workspace`）

- 实验脚本（`.cache/pron-work/`，被 gitignore）：`ai_eval3.mjs`（版本 C）、`ai_eval2.mjs`（版本 B）、
  `ai_eval.mjs`（版本 A）；`engine.mjs` 是 esbuild 打出的 grading-engine 包
- 中间数据：`pron/recording-*.json`（本地 GOP，schema 2）、`asr.json`、`schemas.json`（含各题 rubric）、
  `mapping.json`（录音↔题目映射）、`answers/`（从作答包抽出的 12 段 webm）
- 结果：`ai/`（A）、`ai2/`（B）、`ai3-unit-00.json`（C，含 ① prompt/原文 与 ② 的完整 prompt/响应）
- 报告：`pronunciation-report-666666.md`（已提交 `fbca464`）、`ai-grading-report-666666.md`、
  `ai-pronunciation-feedback-666666.md`（后两份未跟踪）
- 作答包本体：根目录 `666666-2026-08-16T01-27-49Z.lssubmission`（12 MB，含考生姓名与录音）

## 七、复现参数

- 端点：`http://host.docker.internal:8787/v1`（本地 Key 代理），`api_key = s3cret`
- 模型：`deepseek-flash`，`reasoning_effort: max`，`temperature: 0`，`max_tokens: 65535`
- 环境事实：容器内 `/workspace/.git` 为只读挂载（`git checkout` 不可用，需 `git show HEAD:<path> > <path>` 还原）
