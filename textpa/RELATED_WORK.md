# TextPA 后续研究与部署启示

检索与核查日期：2026-08-09。本文记录围绕 TextPA 的直接后续论文，以及对
语音转写、音素识别、对齐、韵律特征、LLM 提示和反馈生成有直接工程价值的
相关工作。除特别注明外，数字均来自论文正文、表格或官方论文页面。

不同论文的指标不能直接横向比较：PCC 衡量连续分数的相关性，PFER/PER 衡量
音素识别，F1/FAR/FRR/DER 衡量错音检测，NCE/AUC 衡量置信度，MOS/G-Score
衡量反馈质量。某一项提高不代表整条评测链路同时提高。

## 结论摘要

截至检索日期，没有论文在相同数据、相同零样本设置和相同指标下全面超过
TextPA。Semantic Scholar 记录了三篇明确引用 TextPA 的 2026 论文；Crossref、
OpenAlex 和 OpenCitations 的引用链接仍有索引滞后。

现有证据支持的部署结构是：

1. 声学模型独立识别实际发音，不在解码阶段用 canonical pronunciation 拉偏结果。
2. 用 Viterbi、CTC-GOP 或专用对齐器生成可核验的逐词、逐音素证据。
3. 将替换音映射为标准发音属性，并加入置信度与低置信拒答。
4. 用确定性的 F0、时长、强度和停顿特征补充流利度与韵律。
5. LLM 只根据结构化证据评分和生成教学反馈，不自行猜测音素或重做对齐。
6. 在独立验证集上校准在线分数，同时分别评价标签正确性和反馈事实性。

这也解释了当前实验中“加入 IPA 后有时变差”的现象：TextPA 原论文中成功的
IPA 融合是把独立 IPA match 分数与 LLM 分数做 cohort min-max 后平均，并不等于
把更多 IPA 或 canonical 文本直接加入 LLM prompt。后续研究表明，canonical
prompt 本身可能使声学判断向标准答案偏移。

## TextPA 基线

[Read to Hear: A Zero-Shot Pronunciation Assessment Using Textual Descriptions
and LLMs](https://aclanthology.org/2025.emnlp-main.134/) 发表于 EMNLP 2025，
DOI 为 [10.18653/v1/2025.emnlp-main.134](https://doi.org/10.18653/v1/2025.emnlp-main.134)，
预印本为 [arXiv:2509.14187](https://arxiv.org/abs/2509.14187)。

原链路使用 Whisper `large-v3-en` 转写、wav2vec2 识别 IPA、Charsiu 生成
CMU/ARPAbet 与停顿，再由文本 LLM 输出 Accuracy、Fluency 和理由。最终 Accuracy
把字符级 Smith-Waterman IPA match 与 LLM 分数分别在整个测试 cohort 上做
min-max，并等权平均。

主要结果如下：

| 数据集与模型 | Accuracy PCC | Fluency PCC |
|---|---:|---:|
| MultiPA, TextPA GPT-4o-mini | 0.728 | 0.650 |
| MultiPA, GPT-4o-mini-audio | 0.674 | 0.648 |
| MultiPA, supervised MultiPA model | 0.618 | 0.683 |
| MultiPA, MultiPA model + TextPA | 0.769 | 0.784 |
| SpeechOcean762, TextPA Gemini 2.0 Flash | 0.532 | 0.557 |
| SpeechOcean762, supervised MultiPA model | 0.705 | 0.772 |

MultiPA Accuracy 的消融尤其重要：LLM all-cues 为 `0.643`，独立 IPA match 为
`0.653`，外部分数融合后才达到 `0.728`。详细评分 rubric 也不是稳定改进：在
MultiPA 的 GPT-4o-mini 上，Accuracy/Fluency 从 `0.643/0.650` 降到
`0.500/0.543`；在其他模型和 SpeechOcean 上则有小幅正向结果。

TextPA 的 ToBI 文本韵律实验没有成功。加入 Prosody 任务后，Accuracy 从
`0.633` 降至 `0.590`，Fluency 从 `0.678` 降至 `0.549`，Prosody PCC 只有
`0.243`。

部署时还需注意：论文的最终 Accuracy 依赖整个测试 cohort，不能给在线单条请求
稳定打分；原实验主要覆盖中文母语者英语，MultiPA 只有 50 条开放回答；理由的
人工分析也没有等价于逐条事实核验。

## 明确引用 TextPA 的后续论文

### Prior over Evidence

[Prior over Evidence: Stereotype-Driven Diagnosis in LLM-Based L2
Pronunciation Feedback](https://arxiv.org/abs/2606.15325) 是目前最直接、对部署
最重要的后续分析。实验包含 L2-ARCTIC 的 1,800 条语音、六种 L1、三种多模态
LLM、五种证据条件和四个发音维度。

论文把评价拆成 Rating Accuracy、Evidence Coherence 和 Grounded Correctness。
在 34,887 个已判定单元中，`39.6%` 属于“理由自洽但结论错误”，只有 `15.8%`
同时理由连贯且有事实依据。模型会重复报告 `/θ/`、`/ð/`、`/r/`、`/v/`
等刻板的 L2 错音，即使录音证据不支持这些结论。

文本化 F0 证据把 pitch 的 Grounded Correctness 从约 `0.18-0.19` 提高到
`0.45-0.62`；直接提供同一音频并不能稳定复现该增益。注意这里是 grounding
指标，不是 PCC。论文支持“专用声学模块负责诊断，LLM 负责表述”的职责切分，
并提示部署评测应隐藏 L1、性别等可能诱发先验偏见的信息。

### Finetuned SpeechLLM

[A Finetuned SpeechLLM for Joint Multi-Granular L2 Assessment and
Natural-Language Rationales](https://arxiv.org/abs/2606.09470) 使用
Qwen2-Audio-7B、LoRA、SFT 和 Bounded DPO，一次输出句、词、音素级评分和理由。
[作者代码](https://github.com/Aditya3107/speechllm-l2-assessment)已公开。

在 SpeechOcean762 上，句级 Accuracy/Fluency/Prosody PCC 为
`0.66/0.73/0.71`，词级 Accuracy 为 `0.52`，音素级 Accuracy 为 `0.42`。
GOPT 对照为 `0.71/0.75/0.76`、词级 `0.53`、音素级 `0.61`，因此它没有全面
超过专用评分器。

理由中提及的分数与人工真值的一致性，句级约为 `0.61-0.66`，词级为 `0.35`，
音素级只有 `0.07`。该结果说明多粒度自然语言输出可以做出来，但越细粒度，
“理由看起来合理但不忠实”的风险越高。该方法需要监督微调，也不再是 TextPA 的
零样本设置。

### TTS-PRISM

[TTS-PRISM: A Perceptual Reasoning and Interpretable Speech Model for
Fine-Grained Diagnosis](https://arxiv.org/abs/2604.22225) 只在相关工作中引用
TextPA，任务是普通话 TTS 质量诊断，而不是 L2 学习者发音评测。
[代码](https://github.com/xiaomi-research/tts-prism)已公开。

其可迁移价值是显式十二维 rubric、先生成证据再评分，以及按维度推理来降低
instruction overload。由于语言、数据和监督条件均不同，不能用其 LCC/SRCC
结果声称对 TextPA 有直接提升。

未发现 TextPA 三位作者共同发表的正式续作。MultiPA 是 2024 年的前序工作，
不是后续论文。

## 对齐与发音属性反馈

### Interspeech 2024 articulatory feedback

[Leveraging Large Language Models to Refine Automatic Feedback Generation at
Articulatory Level in Computer Aided Pronunciation Training](https://www.isca-archive.org/interspeech_2024/zhong24b_interspeech.html)
发表于 Interspeech 2024，DOI 为
[10.21437/Interspeech.2024-1005](https://doi.org/10.21437/Interspeech.2024-1005)。
它早于 TextPA，但给出了非常贴近部署目标的结构：

`MDD 音素预测 -> Viterbi 对齐 -> 错误音素 -> 八维发音属性 -> GPT-4 反馈`

论文还测试了让 GPT-4 自行分词、定位和映射的 prompt 路径，以及用 GPT-4
生成数据微调 ChatGLM-6B 的路径。L2-ARCTIC 上由 10 名学习者给出的表格 MOS 为：

| 方法 | Comprehensibility | Helpfulness |
|---|---:|---:|
| GPT-4 | 3.21 | 3.00 |
| GPT-4 + Viterbi | 3.50 | 3.30 |
| GPT-4 + Viterbi + articulatory features | 3.46 | 3.79 |
| GPT-4 Dataset Fine-tuning | 2.68 | 2.53 |
| SPD Dataset Fine-tuning | 3.00 | 2.70 |

Viterbi 提高了两项主观评价，发音属性进一步把 Helpfulness 提高 `0.49`，但
Comprehensibility 略降 `0.04`。这支持提供具体舌位、唇位和清浊建议，但需要按
学习者水平控制反馈复杂度。

证据限制较大：只有 10 名评价者，未报告评测条目数、评分者一致性或显著性；
声称计算 95% CI，但表中没有给出；正文与表格的 MOS 数字也略有冲突。论文没有
评价反馈事实正确率或上游 MDD 指标，因此这些 MOS 不能证明诊断正确。

[prompt 与数据脚本](https://github.com/lunar333/mis-feedback)没有 ASR、Viterbi
实现、训练脚本、checkpoint、requirements 或测试，且仓库没有 LICENSE。实际
prompt 是很长的中文多轮 few-shot 对话，音素属性映射存在 7/9 位 typo、维度定义
不一致和错误的语音学示例。因此可以借鉴职责拆分，但不能把代码当作可部署实现。

### Computer Speech & Language 2026 扩展

[Mispronunciation detection and diagnosis based on large language
models](https://doi.org/10.1016/j.csl.2026.101942) 是上述路线的直接期刊扩展。
前两位作者相同但顺序互换，沿用相同基金，并明确引用 Interspeech 2024 论文。

该文用 L2 数据全面微调 Whisper，以 Viterbi 代替 edit distance 定位 predicted
与 reference 音素差异，再把错误音素映射为发音属性并交给 LLM 生成反馈。
反馈 G-Score 为 `0.52`，接近论文所引 SOTA 的 `0.54`。它补齐了 2024 工作没有
验证的上游 detector，但 `0.52` 是反馈指标，不能与 2024 的 1-5 MOS 横比。

部署时应把中间结果固定为机器可验证的 schema，例如：

```json
{
  "word": "from",
  "reference_phone": "m",
  "recognized_phone": "n",
  "operation": "substitution",
  "confidence": 0.86,
  "feature_diff": ["bilabial -> alveolar"]
}
```

LLM 只把这种证据转成教学建议，并在低置信度时拒绝给出确定诊断。发音属性表应
采用标准 place、manner、voicing，以及元音 height、backness、rounding；不应
沿用 2024 仓库中未经校验的八位字符串。

### Phonological-feature MDD

[Phonological-Level Mispronunciation Detection and
Diagnosis](https://doi.org/10.21437/Interspeech.2024-2217) 使用
wav2vec2-large-robust 和 separable CTC with shared blank，分别预测 35 个二值
phonological feature stream。特征显式覆盖 manner、place、voicing，以及元音
height、backness、length 和 rounding。

在 L2-ARCTIC 上，三种 feature model 的 DER 均低于 `10%`；对应 phoneme model
在 LibriSpeech、TIMIT、TIMIT+L2 训练条件下的 DER 分别为 `31%/27%/15%`。
34 组常见混淆音中，in-domain 时有 29 组至少一个 feature 的 FAR 优于 phoneme
模型，平均 FAR 改善 `16.5% +/- 28`；两个纯 native-data 的跨域设置分别有
30/34 和 32/34 组改善。

这些结果支持以特征差异解释“如何发错”，而不是只报告两个离散 phone 不相等。
但每个混淆对都选其最佳 feature 会带来选择偏差，标准差也很大。部署时应固定
完整 feature schema 和决策规则，再在独立数据上整体评价，不能为每个测试错误
事后挑选最有利的特征。

## CTC、音素识别与强制对齐

### Context-aware CTC

[Investigating Context-aware CTC for Pronunciation Assessment: Mitigating
Peaky Behavior and Context Independency Assumption](https://aclanthology.org/2026.bea-1.3/)
发表于 BEA 2026。它不引用 TextPA，但可以改善 TextPA 的音素证据层。

方法在 WavLM-CTC 中加入 diphone 输出上下文、Label Prior 和 EnCTC，缓解 blank
过多和 posterior 过尖。在 SpeechOcean762 的 GOPT 上：

| 指标 | 论文比较基线 | 最佳 context-aware CTC |
|---|---:|---:|
| Phoneme PCC | 0.612 | 0.641 |
| Word total PCC | 0.549 | 0.582 |
| Correct/mispronounced score gap | 0.708 | 0.816 |
| Utterance total PCC | 0.742 | 0.747 |
| Utterance fluency PCC | 0.753 | 0.726 |
| Utterance prosody PCC | 0.760 | 0.736 |

score gap 的 `0.708` 来自标准 WavLM-CTC；其余表中数字以 TDNN-F 为比较基线。
增益集中在音素和词级，并不是句级全面提升。在依赖硬对齐的 HierCB 中，传统
TDNN-F 仍然总体更强。训练使用 WavLM-large 和 LibriSpeech 960h，论文没有发布
可直接部署的统一 checkpoint；因此它是中长期声学替换方案，不是当前 CPU 链路的
即插即用组件。

### HuPER

[HuPER: A Human-Inspired Framework for Phonetic
Perception](https://arxiv.org/abs/2602.01634) 是当前最值得立即 A/B 的 phone
recognizer。WavLM-large CTC 模型约 315.5M 参数，五个英语测试集平均 PFER
`8.82`，其中 L2-ARCTIC 为 `8.00`，SpeechOcean 为 `9.00`。

[代码](https://github.com/HuPER29/HuPER)和
[MIT 模型 checkpoint](https://huggingface.co/huper29/huper_recognizer)已发布。
它输出 ARPAbet，需要补充 ARPAbet 到 IPA 的确定性映射，并实测 CPU 时间、峰值
内存和 CTC blank 对停顿的可用性。

### PRiSM 与 POWSM

[PRiSM: Benchmarking Phone Realization in Speech
Models](https://arxiv.org/abs/2601.14046) 系统比较 phone recognizer。对 TextPA
所用 W2V2P-LV60 的 SpeechOcean phone-transcript probe，Kendall tau x 100
为 `36.1`，ZIPA-NS 为 `40.8`。使用监督 probe 时 Whisper-small representation
达到 `57.2`，高于 LV60 的 `49.9`；这不是零样本结论。论文总体发现专用
encoder-CTC phone 模型比大型音频语言模型更稳定。

[PRiSM benchmark](https://github.com/changelinglab/prism)已公开，但仓库没有
LICENSE，不能默认视为可再发布或商用代码。

[POWSM: A Phonetic Open Whisper-Style Speech Foundation
Model](https://arxiv.org/abs/2510.24992) 提供多语 IPA/ASR/G2P/P2G，但在
L2-ARCTIC 和 SpeechOcean 的 PFER 分别为 `11.32` 和 `17.84`，均弱于对照
W2V2Phoneme 的 `9.86` 和 `13.60`。它不能仅因模型较新就直接替换当前 phone
stream；20 秒 pad/truncate 和 ESPnet/GPU 路径也不利于现有 CPU 部署。

### Prompt-free MDD

[Beyond Acoustic Sparsity and Linguistic Bias: A Prompt-Free Paradigm for
Mispronunciation Detection and Diagnosis](https://arxiv.org/abs/2604.22133)
提出 CROTTC-IF。在 L2-ARCTIC 上，MDD F1 为 `71.77%`，普通 CTC 为 `57.89%`。
[研究代码](https://github.com/Secondtonumb/IF-MDD)已公开，但仓库没有 LICENSE。

最重要的消融是 canonical pronunciation prompt 使 LLM-MDD F1 从 `56.87%`
降到 `40.52%`，potential pronunciations prompt 也只有 `42.63%`。这支持以下
架构规则：声学 decoder 不看目标发音，先独立解码 actual phones，再在后处理阶段
对齐 canonical phones。

### Phoneme-controlled LLM

[Phoneme-Controlled LLM with Self-Supervised Speech Prompts for
Mispronunciation Detection](https://doi.org/10.1145/3743093.3771002) 在
ACM Multimedia Asia 2025 发表。S-TATLLM 用 phoneme control 和
text-audio-text embedding 约束 LLM 关注易混淆音。官方摘要报告 Recall
`99.44%`、F1 `0.8281`、诊断准确率 `92.03%`；wav2vec2-CTC 对照为
`60.84%/0.6164/70.74%`。

这些是 MDD 指标，不是句级 PCC。公开摘要没有给出足够的数据划分与部署资源
细节，也未发现可直接使用的代码或 checkpoint，因此目前只把它视为“用音素控制
约束 LLM”这一方向的支持证据，不将数字当作当前链路的可复现目标。

### Training-free retrieval MDD

[Mispronunciation Detection and Diagnosis Without Model Training: A
Retrieval-Based Approach](https://arxiv.org/abs/2511.20107) 用预训练 HuBERT
embedding 和带音素时间标注的检索池，不训练新的 MDD 模型。L2-ARCTIC F1 为
`69.60%`，FRR 为 `4.43%`。

“无需训练”不等于无需标注数据：方法仍需带时间边界的音素样本构建检索池。
其 PER 高达 `104.08%`，原因是大量 insertion，而论文采用的 MDD 指标基本不惩罚
插入。因此它可作为低成本研究分支，暂不适合替换默认 phone recognizer。

### 强制对齐工具对比

[Tradition or Innovation: A Comparison of Modern ASR Methods for Forced
Alignment](https://doi.org/10.21437/Interspeech.2024-429) 比较 MFA、WhisperX
和 MMS。25 ms word-boundary accuracy 在 TIMIT 上为 `72.8/52.7/43.5`，在
Buckeye 上为 `69.9/43.1/52.7`；MFA phone F1@20ms 在 TIMIT/Buckeye 为
`66.0/56.2`。

结论是 Whisper timestamp 不足以独立支撑局部错音反馈。需要时间边界时应继续
使用专用 frame/forced aligner，或者使用密集 CTC posterior。

## Whisper 相关改进

### Whisper confidence

[Adopting Whisper for Confidence Estimation](https://arxiv.org/abs/2502.13446)
表明 Whisper 原始 token probability 过度自信。论文冻结 encoder，让 decoder
额外输出校准 confidence。英文平均结果中，Whisper-large 的 NCE/ROC-AUC/error
PR-AUC 为 `.399/.881/.611`，tiny 为 `.308/.840/.531`。

作者没有发布 checkpoint。当前部署可先记录 faster-whisper 的 `avg_logprob`、
`no_speech_prob`、beam disagreement、ASR/phone disagreement，再在独立验证集上
校准成拒答概率；不能直接把原始 token probability 当成错音分数。

### Target-prompted Whisper

[Prompting Whisper for Improved Verbatim Transcription and End-to-end Miscue
Detection](https://arxiv.org/abs/2505.23627) 把 read-aloud target prepend 到
Whisper。在儿童语音上，medium WER 从 `9.7` 降至 `4.0`，CMU Kids OOD 从
`17.1` 降至 `11.1`，atypical adult 从 `27.4` 降至约 `5.8`。

它适用于朗读模式，但更接近标准文本的转写不一定更忠实地保留错音。部署时如果
使用 target-prompted ASR 改善正文转写，必须同时保留独立、未提示的 phone decoder
作为错音证据，不能用提示后的转写同时承担诊断。

### Whisper 用于 L2 score 的限制

[Using Whisper to assess non-native pronunciation](https://doi.org/10.1007/s10772-024-10141-5)
在较小学习者样本上使用 language probability 和 subtoken probability 区分水平，
但没有与人工连续分数做 PCC，也存在 abstract/正文方法名和数据切分描述不一致。
这些概率只能作为低置信辅助 cue，不能独立打分。

直接把 Whisper-large-v3 扩成 phone decoder 的
[IqraEval 2025 系统](https://aclanthology.org/2025.arabicnlp-sharedtasks.64/)
在阿拉伯语 MDD 上 F1 只有 `0.3224`，模型约 1.55B 且作者明确指出不能实时。
这不支持用 Whisper decoder 默认替代专用 CTC phone stream。

## 韵律、流利度与超音段特征

[Automatic Pronunciation Assessment for L2 English by Incorporating
Suprasegmental Features and Weighted Loss Function](https://doi.org/10.21437/SLaTE.2025-5)
发表于 TextPA 预印本之前，因而不是后续论文，但对其失败的 ToBI 路径是直接改进。

论文给 GOPT 加入 11 个 phone-level Praat cue，包括 duration、F0、pitch/intensity
的 mean/min/max/SD 和 mean pitch slope。在 SpeechOcean762 的 speaker-disjoint
测试上：

| 指标 | GOPT baseline | 最佳配置 |
|---|---:|---:|
| Fluency PCC | 0.753 | 0.805 |
| Prosody PCC | 0.760 | 0.797 |
| Overall PCC | 0.742 | 0.764 |
| Fluency MAE | 0.142 | 0.127 |
| Prosody MAE | 0.144 | 0.132 |

结果均报告 `p < .001`，但属于监督式、窄域实验，作者没有发布内部 Praat 脚本或
模型。对当前链路最合理的迁移方式是先把这些数值作为结构化证据保存，再测试
LLM 是否能稳定解释；不要把 ToBI 标签或长段自然语言描述直接堆进同一个 prompt。

## LLM 提示、直接音频与校准

### 直接音频 LMM

[Exploring the Potential of Large Multimodal Models as Effective Alternatives
for Pronunciation Assessment](https://arxiv.org/abs/2503.11229) 直接用 GPT-4o
处理 SpeechOcean762 音频。句级 Accuracy/Fluency/Prosody/Completeness/Total
PCC 为 `.471/.459/.443/.259/.502`，多粒度 prompt 有 `41.52%` 样本未成功给出
完整分数。

把 Azure 专用 PA 分数交给 GPT-4o 生成反馈时，Helpfulness/Alignment 为
`7.69/7.98`，高于直接单阶段方法的 `6.95/6.73`。这再次支持“专用评分器输出
证据，LLM 生成反馈”，不支持以 raw-audio LMM 取代整条链路。

[Pronunciation Assessment with Multi-modal Large Language
Models](https://arxiv.org/abs/2407.09209) 使用 Data2vec2、adapter 和冻结的
Qwen-7B，在 SpeechOcean762 上得到 Fluency/Accuracy PCC `.777/.713`。
加入 target text prompt 后 Accuracy 从 `.698` 提高到 `.713`，但该方法需要
LibriSpeech 1000h、SpeechOcean 监督数据和 8 x A800，不能视为当前 CPU/零样本
方案。

### Prompt 长度和概率校准

[Assessment of L2 Oral Proficiency using Speech Large Language
Models](https://www.isca-archive.org/interspeech_2025/ma25b_interspeech.html)
显示 hard argmax 会浪费模型的类别不确定性。在两个数据集上，用完整类别概率
计算 expected score 后，zero-shot PCC 分别从 `.178/.394` 提高到 `.371/.507`，
并在 development set 上做线性校准。

[Natural Language-based Assessment of L2 Oral Proficiency using
LLMs](https://www.isca-archive.org/slate_2025/banno25_slate.html) 发现 label 顺序会
明显影响概率，某维度 positional JSD 达 `.42`。论文使用多个随机 label order 的
logit 平均，再可选 Ridge 校准。

这两篇是口语能力评估而非纯发音评估，但方法可以迁移：按维度独立输出 ordinal
label distribution，计算 expected score，再用独立验证集做 linear、isotonic
或 ordinal calibration。长 rubric、CoT 和 one-shot audio 都不应默认视为提升，
必须按模型和数据单独消融。

### 真人与 GenAI 评分偏差

[Pronunciation assessment in foreign language learning: Reliability and
scoring bias in human-generative AI evaluation](https://doi.org/10.1371/journal.pone.0354603)
发表于 PLOS One 2026。研究让三名标准化真人评分者和 ChatGPT-4o Voice Mode
使用同一七分 rubric，评价 60 名学生的 180 条样本和八个发音维度。

GenAI 与真人在 Fluency 上最可靠，ICC/Pearson r 为 `.637/.564`；Individual
phonemes 最弱，只有 `.210/.271`。GenAI 在全部八个维度都显著给出更高分，
例如音素平均分为 `5.108`，真人为 `3.486`。访谈还发现模型会漏罚未读词、忽略
上下文与自然连读、错误处罚正常语音变体，并生成录音或脚本中不存在的反馈。

这项结果和当前本地实验的分数拥挤相互印证：通用 GenAI 更适合低风险的即时练习
和初筛，不能仅凭句级相关性承担精细音素诊断或权威评分。

## 当前复现水平的直观解释

本项目的完整数字见 [`BENCHMARK.md`](BENCHMARK.md)。在同一批 50 条 MultiPA
公开 acoustic cues 上，当前默认 Sol high 的论文式融合 Accuracy PCC 为
`0.656`，Fluency PCC 为 `0.698`；质量上限实验中，Luna max 的融合 Accuracy
为 `0.724`，Sol max 的 Fluency 为 `0.725`。

PCC `0.72` 不表示 72% 的样本“打对”。它表示句级分数随人工平均分变化的线性
趋势较强。在这 50 条上，Luna max 对人工平均 Accuracy 不同的样本对，排序方向
为 `871/1135 = 76.7%` 正确。作为人工基准，单个标注者与其余四人平均分的 PCC，
Accuracy 平均为 `0.730`，Fluency 平均为 `0.741`。

因此，在这个很小且高度匹配的数据集上，当前句级粗排大致接近一名有噪声的普通
评分者。但这不能外推为真人教师水平：

- 只有 50 条，且主要是中文母语者英语；尚无跨 L1、跨任务独立测试。
- 模型原始 1-5 分高度集中在 2/3 档，绝对分数和细微差异没有校准。
- 论文式 Accuracy 使用测试 cohort min-max，不能直接在线服务。
- PCC 不评价逐词、逐音素诊断，也不评价反馈理由是否忠实。
- 当前最佳模型差异的 bootstrap 区间很宽，不能证明超过原论文。

适合的产品定位是低风险练习助手：做低/中/高粗分、明显问题筛查和多次练习趋势。
不适合考试定级、权威 1-5 分、无置信度的逐音素纠错或替代专业教师。

## 建议的实施顺序

### P0：修正评分与证据边界

- 保留独立 ASR 和 phone decoder，canonical target 只在解码后参与比较。
- 取消生产路径中的测试 cohort min-max，建立独立 calibration/dev set。
- 每条声学证据记录来源、时间边界、置信度和模型版本。
- LLM 不能输出证据表中不存在的错词、错音或声学现象。

### P1：逐音素证据

- 首先 A/B HuPER 与当前 wav2vec2 IPA/Charsiu 分支。
- 用 Viterbi 或 CTC posterior 对齐生成 substitution、deletion、insertion。
- 将 phone difference 转成标准 articulatory/phonological features。
- 对低置信度或多个近似 hypothesis 输出“不确定”，而不是强制诊断。

### P2：流利度与韵律

- 加入 speech rate、articulation rate、pause count/duration、phone duration。
- 加入 F0 与 intensity 的统计量和 slope，先作为结构化数值证据。
- Accuracy、Fluency、Prosody、Completeness 分开评分，避免单个 prompt 过载。

### P3：LLM 反馈和质量控制

- 先输出 evidence record，再输出分数分布，最后生成教学反馈。
- 反馈必须引用 evidence ID；无证据时不得自行补充典型 L1 错误。
- 建立独立 critic 或规则校验，但仍需抽样人工审计 critic 本身。
- 分别报告 sentence PCC/RMSE、phone MDD F1/FAR/FRR、校准误差、反馈事实正确率
  和学习者 Helpfulness，不能用一个总分替代所有目标。

### P4：后续训练型方案

- 有足够标注数据后再考虑 context-aware CTC、GOPT/HierCB 或 SpeechLLM 微调。
- 直接音频 LMM 先作为低比例 shadow assessor，不能默认作为主评分器。
- 在多 L1、性别、口音、自由回答和朗读任务上分别做 subgroup audit。

## 检索边界

本文优先核查正式论文页、ACL/ISCA 页面、论文 PDF 和作者仓库。引用数量会随
索引更新变化；预印本状态、代码许可证和 checkpoint 发布状态也可能变化。后续
实施前应再次确认对应仓库的许可证与最新 release。文中部分 2026 工作仍只有
arXiv 预印本，尚不能默认视为已经同行评审。
