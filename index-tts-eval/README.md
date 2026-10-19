# IndexTTS 音质评估实验产物（E0-E18）

> 2026-10-17 ~ 10-19 IndexTTS 2.5 音质评估的全部合成产物，按实验编号归档。
> 统一实验条件：同 seed（20260918）、同参数设计，各目录之间严格可比；除 E18 外均为 IndexTTS 产物。
> 音频格式：`.wav` 为引擎原始输出（IndexTTS 22.05kHz / qwen 24kHz，mono PCM16）；`calibration.json` 为对应实验的语速校准系数。
> 实验动机、完整参数与听感决策链见开发容器 `.cache/index-tts-quality-state.md`（工程记录，不入库）。
> 参考音色出处与许可证见 [`../voice-samples/README.md`](../voice-samples/README.md)。

## 测试文本（贯穿全部实验）

- **prosody 句**（20 词，133 字符）：`Convert? I admired the curatorial daring, and the colours are technically impressive, but the canvases left me cold—emotionally mute.`——含问句、评论性语气与 em-dash，考察韵律/语调/起伏。
- **exam 指令段**（24 词，156 字符）：`Speaking. Section A. Directions: Read aloud the following sentences. For each sentence, you will have thirty seconds to prepare and fifteen seconds to read.`——中性指令文体，考察产品主场景（含 read 异音词）。
- wpm = 词数 ÷ 音频时长换算；英语考试听力目标区间 120-150 wpm，本评估统一校准目标 125 wpm。

## 实验索引

| 目录 | 实验 | 文件说明 | 结论 |
| --- | --- | --- | --- |
| `00-baseline/` | 基线三连（q8_0） | `exam-directions`（指令段基线）、`exam-seed2`（换 seed=20260919 重跑）、`prosody-q8`（韵律句基线），参考音 american-woman（合成） | 平淡问题基线（122-125 wpm）；**seed 方差不可控**，两 seed 均不稳定 |
| `01-f16-ab/` | f16 量化 A/B | `exam-f16` / `prosody-f16`，与 `00-baseline` 同 seed 同文本，唯一变量量化 | **f16 金属感改善**；分发 ZIP >4GB 需分卷（见 TODO-index-tts-f16-distribution.md） |
| `E0-pronfix/` | read 发音标注 | `pronfix`（文本含 `<read\|R IY D>`×2，无重音写法）、`pronfix2`（`<read\|R IY1 D>`×2，CMU 规范重音写法） | **两种写法均修复** read→/riːd/；引擎对标注格式宽容；自动化方案记 TODO |
| `E1-emotion/` | 显式情绪条件（旧协议 emotionText/emotionVector 字段） | `emosurp`（手动向量 [0,0,0,0,0,0,0.8,0.2]）、`emotext`（手写情绪文本 "Convert? Really?..."） | E1a 平庸；E1b 初评好、终判**过激动**——两者最终均否决 |
| `E2-realvoice/` | 真人参考对照 | `realvoice` ×2（Jabberwocky 戏剧化女声参考）、`uptalkemo`（american-woman 音色 + uptalk 独立情绪参考） | 真人参考路线成立（"还可以"）；**uptalk 语速传导太急**（5.42s/221 wpm）否决——证明参考的节奏 1:1 传导 |
| `E3-emotion-exam/` | 指令段 + 独立情绪文本 | `exam-emotext`（emotionText="Listen carefully..."） | 与 E4b **字节级相同**——中性文本使分类器输出全零 → 引擎回退 [自然=1] |
| `E4-emoself/` | emotionText=合成原文 | `prosody-emoself`（E4a）、`exam-emoself`（E4b） | E4a 当时胜出（评论性文本被分类出温和情绪）；E4b==E3 |
| `E5-emoself-f16/` | f16 + 原文情绪 | `prosody-emoself-f16` | 略差于 E4a——f16 情绪路径偏弱 |
| `E6-natural/` | 显式 [自然=1] 尖峰向量 | `natural-q8` / `natural-f16`（emotionVector [0,...,1]） | **音色漂移**（输出不再是参考音色）→ 否决；尖峰向量有害的第一份证据 |
| `E7-male-dramatic/` | 男声戏剧化参考 | `male-jabuk`（Jabberwocky-UK 英音）、`male-raven`（The Raven 中段） | 否决（戏剧腔节奏过慢 98-108 wpm） |
| `E8-announcer/` | VOA 播音员参考 | `annmale` ×2（Jones-Cruise 慢速教学）、`annfemale` ×2（Diane Roberts 新闻） | **annmale 入池**（106-112 wpm）；annfemale 否决（155-157 过快） |
| `E9-obama/` | Obama 2009 每周讲话参考 | `prosody-obama` / `exam-obama` | 方向认可（127-138 wpm 天然考试区间）；**最终筛选中移除池** |
| `E10-realman/` | 男声对照 | `realman` ×2（参考源记录缺失） | 仅存档（exam 段 188 wpm 异常） |
| `E11-rate-calibration/` | 语速校准验证 | `df085-q8` / `df085-f16`（annmale + durationFactor 0.85，prosody/exam 双文本） | 106-112 → **125-132 wpm**；倍率线性误差 <1%；两量化档一致——**校准机制定稿** |
| `E12-weekly-addresses/` | 每周讲话系列六声 | obama17（2017 最后一次）/ biden（副总统期）/ trump / **brooks**（议员回应女声）/ black（南方口音女声）/ michelle（圣诞讲话，窗位说话人存疑） | **Brooks 入池**（126 wpm）；其余最终筛选否决 |
| `E13-reading-education/` | 清晰朗读/教育六声 | barnes（英式 RP 最沉稳 95）/ neufeld（Barnes 的美式对照 123）/ **walden**（女声 122）/ **greenman**（讲古风 114）/ savage（女声最快 150）/ uscis（公民测试 Q08，113） | **Greenman 入池**；其余最终筛选否决 |
| `E14-finalists-f16/` | 入池音色 f16 确认 | greenman / brooks × prosody/exam（f16） | 两音色在 f16 下成立（量化对语速影响 ±4 wpm） |
| `E15-user-voices/` | voice-zero 音色 | alec / janelle × q8_0/f16（prosody） | **均入池**（"还可以"）；量化一致性极好（alec 两档同 wpm） |
| `E16-final-config/` | 产品默认配置（情绪开）两阶段 | `*-emo`（Stage1 无校准）+ `*-emo-cal`（Stage2 按系数校准）+ `calibration.json`，五音色 × 指令段 | **全部音质崩坏**——中性指令文本触发引擎 [自然=1] 尖峰回退，音色漂移（Brooks 语速异常 +43 wpm）→ **情绪路径全部关闭的直接诱因** |
| `E17-final-config-corrected/` | 修正定稿轮（关情绪） | `*-noemo`（Stage1 无校准）+ `*-noemo-cal`（Stage2 校准至 125 wpm）+ `calibration.json`（每音色系数 0.90-1.17）+ `v3-bare-payload`（协议验证：与 greenman-noemo 字节级一致）+ `v4b-df-check`（durationFactor 生效验证）+ `prosody-alec-f16-noemo`（追加的同句 f16 对照） | **最终产品形态**：五音色全部精确 125 wpm，质量回到 E12-E15 水平 |
| `E18-qwen-comparison/` | qwen3-tts 0.6B 引擎对照 | `qwen-prosody-americanman`（原生 .spk 音色）、`qwen-prosody-alec`（从 voice-zero WAV 提取的说话人嵌入），同 prosody 句，24kHz | qwen 快 **7-10 倍**（13s vs 95-146s）但**零韵律传导**（音色嵌入不含韵律：alec 语速 142 ≈ 原生 139，而 IndexTTS 传导出 150）；`--extract-speaker` 可用任意 WAV |

## 贯穿结论（详见 `.cache` 快照）

1. **韵律与语速复刻自参考音频**（IndexTTS2 论文设计）：选参考 = 选风格与语速档（实测 95-169 wpm 跨度）；参考的节奏、起伏、语速 1:1 传导到输出。
2. **情绪条件三路径全部否决**（E1b 文本过激动、E6 向量音色漂移、E16 中性文本尖峰回退、E2c 情绪参考语速失控）：引擎情绪控制在克隆场景不稳定，helper 协议已**移除全部情绪字段**。
3. **最终音色池（5 声，3 男 2 女）**：annmale（Jones-Cruise）/ Greenman / Brooks / Alec Daitsman / A. Janelle Risa——出处与许可证见 [`../voice-samples/README.md`](../voice-samples/README.md)。
4. **语速统一方案**：每音色一次性校准 `durationFactor`（E17 `calibration.json`：annmale 0.90 / greenman 1.0 / brooks 1.07 / alec 1.09 / janelle 1.17），产品管线全局 125 wpm。
5. **发音修复**：`<read|R IY1 D>` 内联标注有效；自动化（g2p 前置消歧）记 TODO-index-tts-heteronym-automation.md。
6. **量化选择**：f16 无情绪基线改善金属感、情绪路径略差；分发分卷问题记 TODO-index-tts-f16-distribution.md。
