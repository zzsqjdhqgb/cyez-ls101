# 发音纠错 GOP Demo 当前进展

记录日期：2026-08-23。当前实现基于提交 `4541b0b`，目标是先得到一个可以稳定调用、
方便人工复核的本地发音纠错 demo，再决定是否投入时间自研和调优。它不是正式考试评分器，
也不是已经完成准确率验证的产品系统。

当前暂时冻结版本为 `gop-llm-word-context-v3`。后续软件内 AI 批改引擎的重写以
[`PRONUNCIATION_GOP_LLM_V3_FREEZE.md`](PRONUNCIATION_GOP_LLM_V3_FREEZE.md) 和
`.gop-research/exam/stable-gop-demo-llm-v3/` 为行为基准；改变阈值、上下文、prompt
或输出合同时必须另起版本号。

## 当前结论

目前已经有一条单命令、端到端的本地链路：

```text
音频
  -> 可选的本地 Qwen3 ASR（只提供临时文本）
  -> CMUdict 参考音素
  -> 本地 39 音素 Wav2Vec2 CTC 模型
  -> CTC Viterbi 对齐
  -> GOP 音素证据
  -> 保守的重复辅音诊断
  -> result.json + report.md
```

当前链路只做发音诊断，不做语法、内容、措辞、停顿、流利度或总分判断。ASR 词语与录音
不一致时，脚本不会把这种差异直接写成发音错误；它只把 ASR 文本当作后续音素对齐的临时
目标。

## 为什么改成这条路线

早期路线使用 eSpeak/IPA 字符串做参考，容易把同一个发音拆分方式的差异误认为实际错误，
例如 `/e/ + /l/` 与 `/el/`。当前路线作了以下收敛：

| 之前的问题 | 当前处理 |
| --- | --- |
| eSpeak 版本、IPA 切分和连读边界导致字符串不一致 | 直接使用 CMUdict 的 ARPAbet 音素 token |
| ASR 错词被误当成发音错误 | ASR 仅作为临时文本；未知词必须显式提供读音 |
| 手动串联解码、ASR、对齐和报告脚本 | `run_pronunciation_gop_demo.py` 一次调用完成 |
| 长录音运行 exact GOP 可能长时间无响应 | `--gop-method auto` 超过工作量限制时切到 Viterbi GOP |
| 每个低 GOP 都直接生成反馈，误报较多 | 先保留原始证据，再按重复辅音模式保守聚合 |

这不是说 CMUdict 或当前模型已经解决了所有误报，而是先把参考表示、证据来源和输出边界
固定下来，使后续人工核对有明确对象。

## 当前脚本流程

实现位于 [`scripts/run_pronunciation_gop_demo.py`](scripts/run_pronunciation_gop_demo.py)。

### 1. 参数和输出预检查

入口要求一个音频和一种文本来源：

- `--asr qwen3`：调用本地 Qwen3 ASR；
- `--text TEXT`：直接提供文本；
- `--text-file FILE`：从 UTF-8 文件读取文本。

脚本先解析音频、模型和输出目录。已有 `result.json` 或 `report.md` 且没有传
`--overwrite` 时，会在 ASR 和模型推理前失败，避免重复消耗 CPU 时间。输出使用临时文件、
`fsync` 和原子替换；写入失败时会清理临时文件。

### 2. 获取临时转写

使用 `--asr qwen3` 时，Python 以参数数组调用 `scripts/test-stt.js`，收集每个 ASR chunk
的文本并按顺序合并。命令不会经过 shell 拼接，因此音频路径中的空格不会被展开。

ASR 的职责仅是给出“可能说了哪些词”。它不负责判断发音是否正确，也不负责把错词改成
更符合题意的词。对于 CMUdict 中不存在的词，脚本会停止并提示：

```text
--pronunciation WORD=ARPABET ARPABET ...
```

### 3. CMUdict 参考音素

脚本优先使用 Python `cmudict`；没有该包时，可以读取仓库的
`node_modules/cmu-pronouncing-dictionary/index.js`，也可以通过 `--dictionary` 指定
JSON/JS 词典。

每个词会保留 CMUdict 的合法读音变体。重音数字在模型输入中去除，但原始 ARPAbet 和 IPA
展示仍保存在结果中。`--pronunciation` 只用于明确提供 OOV 词的读音，不是语义纠错开关。

### 4. 音频解码和声学推理

FFmpeg 将输入音频统一解码为 16 kHz、单声道、`float32` 波形，并限制最大时长。随后从
本地 `.gop-research/model` 加载 Hugging Face Wav2Vec2 CTC 模型，在 CPU 上输出每一帧对
CMU 39 音素和 `<pad>` 的 logits。

模型目录和 `.gop-research/site` 依赖目录由 Git 忽略，权重不会进入代码提交；运行 demo 的
机器仍需准备这些本地资产。

### 5. 选择合法读音变体

模型 logits 先进行贪心 CTC 解码，得到一条观测音素流。脚本把它和每个词的合法 CMUdict
变体做音素编辑距离匹配，组成有限数量的整句候选，再对候选进行 CTC 对齐，选取路径分数
最高的合法变体。

因此，声学证据可以帮助选择 `read` 等词的已有变体，但不能创造词典之外的“新标准读音”。

### 6. CTC Viterbi 对齐

选定参考音素序列后，脚本运行 log-space CTC Viterbi，对每个目标音素记录帧跨度和毫秒时间
戳。结果同时按扁平音素和词分组保存，便于从 JSON 追溯到原音频。

### 7. GOP 计算

`--gop-method auto` 是默认模式。它根据帧数和参考音素数估算 exact GOP 的工作量：

- 小输入使用实现于脚本内的 exact CTC-GOP-S wildcard denominator；
- 大输入自动使用有界 Viterbi GOP；
- 显式要求 `--gop-method exact` 且超过 `--exact-work-limit` 时直接报错。

当前 Viterbi GOP 对每个对齐片段计算：

```text
目标音素的平均 log posterior
- 竞争音素 posterior 的 log-sum-exp
```

`confidence` 是根据 GOP 幅度得到的筛选值，不是经过校准的真实概率。exact 模式下还会
保存对应的 Viterbi GOP，方便比较两种算法。

### 8. 保守诊断

低 GOP 只作为原始声学证据，不会自动成为 learner-facing 结论。当前默认筛选条件包括：

- 声学赢家与目标音素不同；
- GOP 不高于阈值且置信度达到阈值；
- 目标和赢家都是辅音；
- 在多个位置或多个词中形成重复模式。

内置模式目前包括：

- `/ð/ -> /t/`；
- `/θ/ -> /s/`、`/t/` 或 `/tʃ/`；
- 词尾 `/z/ -> /s/`；
- 词首 `/b/ -> /p/`。

`--include-generic` 才会加入其他至少跨三个词重复出现的辅音混淆。没有生成诊断不等于
所有音素都已被人工确认正确；它只表示没有达到当前保守规则。

### 9. 输出文件

输出目录包含：

- `result.json`：完整转写来源、词典来源、模型信息、合法变体、逐词/逐音素对齐、声学
  赢家、GOP、时间戳、诊断和限制说明；
- `report.md`：面向人工复听的中文发音报告。

## 已验证的当前结果

使用考试包中的一条自由表达录音：

```text
音频：.gop-research/exam/recording-11.webm
时长：59.94 秒
转写：本地 Qwen3 ASR
参考：CMUdict（另为 overweigh 显式提供 OW V ER W EY）
```

最终入口完整运行得到：

- 130 个词；
- 449 个对齐音素；
- `gop_method = viterbi`；
- 1 条保守诊断，包含两次 `books` 的词首 `/b/ -> /p/` 证据：
  - `00:02.56-00:02.58`，GOP `-2.277763`；
  - `00:13.82-00:13.85`，GOP `-6.508749`。

该项标记为“较弱证据，仅作待确认复听项”，不是确定的发音判错。在这条样本上，早期
IPA 路径出现的多处 `/ð/`、`/θ/`、`/z/` 报告没有在当前 CMU 音素模型的保守输出中复现；
这说明误报有所收敛，但不能据此声称已经完成准确率验证。

产物位于：

- [report.md](../.gop-research/exam/stable-gop-demo/report.md)
- [result.json](../.gop-research/exam/stable-gop-demo/result.json)

## 低 GOP 的 LLM 二次整理实验

在基础 GOP 结果之上新增了独立的
[`scripts/run_pronunciation_gop_llm_demo.py`](scripts/run_pronunciation_gop_llm_demo.py)。
它不重新推理音频，也不改变 GOP；只按可配置阈值选择原始 phone rows，再按问题单词组织后
交给 OpenAI-compatible chat endpoint 进行归纳。当前默认阈值是 `gop_log_ratio <= -0.35`，
因此不会偷偷复用基础脚本中“只保留辅音/重复模式”的人工规则。

当前上下文版输入中，每个至少含一条低 GOP 行的单词都会带上前后各最多两个 ASR 单词、
该词完整的 CMU/IPA 参考序列、所有对齐位置的 `acoustic_winner` 序列，以及该词内每条
低 GOP 行的完整证据。观测序列明确标为强制对齐窗口赢家，不冒充独立词级 ASR。完整
ASR 文本只保存在本地 `evidence.json` 供审计，不再随请求发送给 LLM。

程序要求 LLM：

- 对每个输入 `evidence_id` 恰好归档一次；
- 在 `feedback_items` 和 `withheld_differences` 之间覆盖全部输入行；
- 为每条归档复制 ARPAbet 和 IPA 原始字段。

程序会校验上下文包、ID、覆盖关系和原始音素字段，另行保存 `evidence.json`、`prompt.txt`、
`response.json`、`result.json`、`report.md` 和 `manifest.json`。模型的自然语言理由和
练习建议仍然是未听音频的草稿，不会因为 JSON 合法就被视为真值。

### 历史 v2 样本结果

下面的 v2 结果保留作历史对照。它使用了较早的 prompt，输入仍是扁平 phone rows；不要
把它当作当前冻结协议：

结果文件：

- v2 报告：`../.gop-research/exam/stable-gop-demo-llm-v2/report.md`
- v2 结构化结果：`../.gop-research/exam/stable-gop-demo-llm-v2/result.json`
- v1（较宽松 prompt，用于对照）：`../.gop-research/exam/stable-gop-demo-llm/report.md`

上下文版默认输出目录为
`../.gop-research/exam/stable-gop-demo-llm-v3/`；重新调用 LLM 前应确认 prompt 中的
问题词窗口和完整音素序列符合预期。

### 当前冻结 v3 样本结果

已用同一条 `recording-11.webm` 实际运行上下文版：15 条低 GOP 行被组织成 9 个问题词，
模型返回 7 个反馈/复听项和 5 个暂缓项，15/15 条 evidence ID 通过程序校验。新的
`prompt.txt`、`evidence.json` 和 `report.md` 均保存在上述 v3 目录；本次请求共使用
9483 个输入 token 和 3910 个输出 token。

第一次较宽松调用虽然也覆盖了 15 条，但出现了把 `B` 写成其他音素、把 `AH` 重述为
`/ɒ/`、补写整词 IPA 等事实漂移。v2 增加了逐行原始字段合同后，这些字段层面的错误被
程序约束住；自然语言解释仍可能使用不严谨的语言，因此当前定位是“LLM 整理草稿 + 原始
证据审计”，不是自动发音判定。

## 复现方式

自由表达：

```bash
python3 textpa/scripts/run_pronunciation_gop_demo.py \
  --audio .gop-research/exam/recording-11.webm \
  --asr qwen3 \
  --model-dir .gop-research/model \
  --pronunciation 'overweigh=OW V ER W EY' \
  --output-dir .gop-research/exam/stable-gop-demo \
  --overwrite
```

已有文本时跳过 ASR：

```bash
python3 textpa/scripts/run_pronunciation_gop_demo.py \
  --audio answer.wav \
  --text-file transcript.txt \
  --model-dir .gop-research/model \
  --output-dir artifacts/pronunciation-demo
```

短录音可以显式试 exact GOP：

```bash
python3 textpa/scripts/run_pronunciation_gop_demo.py \
  --audio short.wav \
  --text 'The short sentence.' \
  --model-dir .gop-research/model \
  --gop-method exact \
  --output-dir artifacts/pronunciation-exact
```

模型、Qwen3 ASR 资产、FFmpeg 和 Python 依赖必须在本地准备好；脚本不会自动下载大模型。

## 测试和验证状态

当前定向测试共 15 条，全部通过，覆盖：

- Qwen3 ASR chunk 收集和带空格路径；
- CMUdict JS 解析、合法变体和 OOV 显式读音；
- exact GOP 与小规模 CTC 路径穷举结果一致；
- exact 工作量保护和长输入 fallback；
- 保守辅音诊断及词首/词尾位置约束；
- 输出冲突快速失败和原子写入。
- 低 GOP 全量选择、LLM evidence ID 覆盖和原始音素字段校验。

全量 TextPA Python 测试最近一次结果为 66 条中 58 条通过、1 条因缺少 eSpeak 跳过、
7 条因当前全局 Python 环境没有 `numpy` 或 `openai` 报错。那 7 条不是本 demo 的断言
失败；没有为绕过它们安装临时依赖。脚本自身还通过了 `py_compile`、`git diff --check`、
CLI `--help` 和完整录音端到端运行。

## 已知限制

1. 当前只有本地声学模型和单条长录音的端到端验证，没有人工标注测试集上的发音检测
   precision/recall 或 MDD F1。
2. ASR 错词仍可能改变强制对齐边界；脚本不把它报告为发音错误，但不能消除它对附近
   音素证据的影响。
3. 连读、弱读、词间边界和合法读音变体可能造成音素归属偏移，需要结合原音频复听。
4. 默认诊断主要覆盖重复辅音混淆，单次错误、元音质量、长短、重音和语调不会自动形成
   learner-facing 反馈。
5. GOP 和 `confidence` 尚未做跨说话人、口音、录音设备的校准；它们是排序和筛选证据，
   不是分数或概率。
6. 当前 demo 只支持 CPU，长录音的推理速度和内存仍有限；模型权重不在 Git 中。
7. 该入口不处理语法、内容、停顿、流利度或考试总分，也没有把结果接回 TextPA 的
   `assess` 评分协议。
8. LLM 二次整理的程序校验只能保证引用和原始音素字段没有丢失；它不能证明自然语言
   理由、练习建议或“likely_issue”判断正确，仍需人工听音审阅。

## 下一步建议

按风险和收益排序，建议先做以下工作，而不是立即扩大规则数量：

1. 建立 20--50 条带人工音素标签的审计集，逐条记录“正确、疑似、错误、无法判断”，
   先测当前保守规则的误报率。
2. 保存 ASR 原始 chunk、候选文本和对齐置信信息，把“文本不确定”和“发音不确定”
   分开呈现。
3. 为报告中的每条诊断保留稳定 ID、原始音频时间段和模型证据，支持一键复听；只有
   审计确认后才增加新的元音、辅音或连读规则。
4. 对已知文本和自由表达分别评估：前者可以测强制对齐和发音检测，后者必须降低词级
   结论强度。
5. 补齐可重建的 Python 环境说明和模型资产清单，再考虑批量运行和性能优化。
6. 如果后续需要接入评分，把本 demo 的诊断结果作为独立证据层输入评分模块，不让评分
   LLM 重新猜测音素事实。

在完成这轮人工审计之前，当前最合适的定位是“可重复调用的研究 demo + 人工复听辅助”，
而不是自动判分系统。

## 文件索引

- 入口脚本：[`scripts/run_pronunciation_gop_demo.py`](scripts/run_pronunciation_gop_demo.py)
- 使用说明：[`PRONUNCIATION_GOP_DEMO.md`](PRONUNCIATION_GOP_DEMO.md)
- 定向测试：[`tests/test_pronunciation_gop_demo.py`](tests/test_pronunciation_gop_demo.py)
- LLM 后处理测试：[`tests/test_pronunciation_gop_llm_demo.py`](tests/test_pronunciation_gop_llm_demo.py)
- LLM v3 冻结协议：[`PRONUNCIATION_GOP_LLM_V3_FREEZE.md`](PRONUNCIATION_GOP_LLM_V3_FREEZE.md)
- README 入口：[`README.md`](README.md)
- 当前样本报告：`../.gop-research/exam/stable-gop-demo/`
