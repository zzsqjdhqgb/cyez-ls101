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

## 当前可用模型实测

使用同一批 50 条作者公开 acoustic cues、论文兼容提示词和 Responses API，
本地得到：

| 模型 | LLM Accuracy PCC | Fluency PCC | IPA 融合 Accuracy PCC | 并发 | 总耗时 |
|---|---:|---:|---:|---:|---:|
| deepseek-v4-flash | 0.481574 | 0.562812 | **0.630669** | 10 | 12 分 18 秒 |
| gpt-5.6-sol | **0.530538** | **0.700850** | 0.628769 | 3 | 4 分 10 秒 |
| gpt-5.6-luna | 0.247565 | 0.369907 | 0.539054 | 3 | 2 分 55 秒 |

每组均为 50 个唯一 ID，没有缺失或重复。1--5 分的计数分布如下，未出现的
分数计数为 0：

| 模型 | Accuracy 分布 | Fluency 分布 |
|---|---|---|
| deepseek-v4-flash | 1: 8, 2: 36, 3: 6 | 1: 8, 2: 38, 3: 3, 4: 1 |
| gpt-5.6-sol | 2: 35, 3: 15 | 1: 4, 2: 28, 3: 18 |
| gpt-5.6-luna | 1: 10, 2: 36, 3: 4 | 1: 3, 2: 34, 3: 12, 4: 1 |

三个新模型的 Accuracy 都有明显的分数压缩，因而 LLM-only Accuracy 低于作者
公开的 GPT-4o-mini 基线；加入 IPA match 后有所改善，但仍未达到本地复算的
0.732859。Sol 的 Fluency 已超过作者公开的 0.650692，且融合 Accuracy 与
DeepSeek 只差 0.001900，当前适合作为单模型部署默认。DeepSeek 成本更低、融合
Accuracy 略高，适合作为低成本候选；Luna 在两个维度都明显较弱，暂不作为默认。

这些是论文零样本提示词的直接迁移结果，并未针对三个新模型调参或校准。生产
版本下一步应在独立验证集上改善评分区分度，避免拿这 50 条测试集调参造成指标
泄漏。表中并发只是本次测量配置，不是客户端或服务端上限；DeepSeek 后续吞吐
测试可从更高并发开始，遇到排队或限流后再回退。

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
