# TextPA 复现记录

记录日期：2026-08-08。环境为 Linux x86_64、Python 3.11、8 个 CPU、
7.7 GiB 内存、无 swap。模型均使用源码中固定的 Hugging Face revision。

## MultiPA 指标

使用作者公开的 50 条 acoustic cues、LLM 输出和五位标注者数据，本地指标为：

| 后端 | Accuracy PCC | Fluency PCC | 论文 LLM-only |
|---|---:|---:|---:|
| GPT-4o-mini | 0.642977 | 0.650692 | 0.643 / 0.650 |
| Gemini 2.0 Flash | 0.554004 | 0.556740 | 0.554 / 0.557 |

LLM-only 结果可由 `textpa verify-reference` 精确重算。加入作者的字符级
Smith-Waterman IPA match 和 cohort min-max 后：

| 后端 | 本地 eSpeak NG 1.51 | 论文最终 Accuracy | 差值 |
|---|---:|---:|---:|
| GPT-4o-mini | 0.732859 | 0.728 | +0.004859 |
| Gemini 2.0 Flash | 0.699754 | 0.697 | +0.002754 |

本地 Smith-Waterman 与 `textdistance==4.6.3` 的 50 条结果在浮点误差
`1e-16` 内一致。改用 classic eSpeak 1.48 时得到 0.730097 / 0.698877，说明
eSpeak 版本能解释一部分差异，但不能完整解释。IPA-match-only 的本地 PCC 是
0.657369（classic eSpeak 为 0.657434），论文报告为 0.653。

作者材料没有 requirements，也没有发布 canonical IPA、IPA match、融合输出或
最终 PCC 脚本。评分源码读取的是一份未公开的独立 phoneme 中间目录；当前公开
MultiPA 标注 revision 也晚于论文。论文只给三位小数，而且公开 LLM-only 结果
重算后并非每列都采用普通四舍五入。因此这里把论文数字作为近似对照，不通过
人工校准追齐。部署分数应固定 eSpeak NG 版本；论文 cohort 分数只用于批量对照。

## 单条声学冒烟

样本是官方 MultiPA 的 16.745 秒、16 kHz mono WAV：

`00174478-41df-41e8-9d0d-08256c16d87b---06fa6962-a03a-4d9d-b8f8-c1a6caaf194.wav`

| 阶段 | 首次运行（含下载） | 缓存命中 | 首次峰值 RSS | 缓存峰值 RSS |
|---|---:|---:|---:|---:|
| faster-whisper large-v3, CPU int8 | 76.92 s | 32.98 s | 5.13 GiB | 3.90 GiB |
| IPA wav2vec2 + Charsiu | 70.12 s | 37.92 s | 2.63 GiB | 2.02 GiB |

Charsiu CMU/pause 串和识别 IPA 均与作者公开中间结果逐字符一致。faster-whisper
的转写与作者结果只有一个局部差异：作者结果是 `attended music and singing
classes`，CPU int8 结果是 `attended a music and singing class`。因此声学特征
复现已打通，但部署 ASR 与论文 ASR 不能视为完全相同。

以上耗时是单次容器测量，不代表并发吞吐；当前实现通过阶段拆分和默认 30 秒
输入上限控制 8 GiB 机器的峰值内存。
