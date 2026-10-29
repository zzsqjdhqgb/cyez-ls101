# 附录 A：相关方案明细

> 本文档是 [01-existing-solutions.md](01-existing-solutions.md) 的附录，保留原始明细表供备查；正文只保留分类叙述，不展开各方案的具体链路与数字。

## A.1 监督多粒度与 MDD / 发音属性路线

| 方案 | 链路要点 | 公开结果 | 可借鉴点 | 局限 |
| --- | --- | --- | --- | --- |
| **Finetuned SpeechLLM** | Qwen2-Audio-7B + LoRA + SFT + Bounded DPO，一次输出句/词/音素级评分和理由 | SpeechOcean762 句级 0.66/0.73/0.71，词级 Accuracy 0.52，音素级 0.42；理由与人工真值一致性句级 0.61–0.66、词级 0.35、音素级 0.07 | 多粒度输出可行；越细粒度「理由合理但不忠实」风险越高 | 需要监督微调，不再是零样本 |
| **Interspeech 2024 发音属性反馈** | MDD 音素预测 → Viterbi 对齐 → 错误音素 → 八维发音属性 → GPT-4 反馈 | L2-ARCTIC 10 人主观 MOS：GPT-4+Viterbi 3.50/3.30，再加发音属性 3.46/3.79（Comprehensibility/Helpfulness） | 支持「专用模块出证据、LLM 只做表述」和发音属性反馈 | 评价人数少、无一致性/显著性、代码不可复现 |
| **CSL 2026 扩展** | 全面微调 Whisper + Viterbi 定位差异 + 发音属性 + LLM 反馈 | 反馈 G-Score 0.52（论文引 SOTA 0.54） | 同样的职责切分；中间 schema 可机器校验 | G-Score 与 1–5 MOS 不可横比 |
| **Phonological-feature MDD** | wav2vec2-large-robust + separable CTC，预测 35 个二值音系特征 | L2-ARCTIC 上 DER < 10%；34 组混淆音中多数 FAR 优于音素模型 | 用特征差异解释「怎么发错」，而非只报两个 phone 不等 | 特征选择有偏差、跨域方差大 |
| **传统 GOP/MDD** | Kaldi SpeechOcean762 GOP/MDD recipe 等 | 经典可复现基线 | 阈值、竞争集、对齐质量的工程经验 | GOP 不是校准概率，需按误报率标定 |

## A.2 反馈可靠性分析

| 方案 | 结论 | 对本项目的约束 |
| --- | --- | --- |
| **Prior over Evidence**（L2-ARCTIC，1,800 条、6 种 L1、34,887 个判定单元） | 39.6% 属于「理由自洽但结论错误」，只有 15.8% 同时连贯且有事实依据；模型会重复报告 `/θ/`、`/ð/`、`/r/`、`/v/` 等刻板 L2 错音；文本化 F0 证据把 pitch grounding 从 0.18–0.19 提到 0.45–0.62 | 声学诊断与 LLM 表述必须分离；部署评测应隐藏 L1、性别等先验；反馈要绑定可核验证据 |
| **TTS-PRISM**（普通话 TTS 质量诊断） | 十二维 rubric、先生成证据再评分、按维度推理 | 只借鉴 rubric 与证据优先结构；语言/任务不同，不能引用其分数 |

## A.3 GOP 算法一致性核对

同一段测试录音（116 个音素、746 帧）分别用 exact CTC-GOP、CTC-GOP-SD 和 Viterbi GOP 三种实现计算，平均 GOP 分别为 −0.1241 / −0.1245 / −0.1283，两两相关系数在 0.999 以上，说明三种实现结果一致。但 60 秒长录音的 exact 计算量约 12 亿次，远超 200 万次的预算，因此长音频需要自动回退到 Viterbi；短音频才适合用 exact 做核对。
