# IndexTTS 2.5 音色样本库

> 本文件夹汇集 IndexTTS 2.5 评估期间的全部参考音色样本（24 个声音；其中 2 个现有产品合成音色以引用方式收录，不重复入库，见 `native/qwen-tts/voice-design/`）。
> 每个样本的出处、许可证、剪辑窗、实验语速（wpm，来自 E 系列实验）与评估状态见下表。
> 实验产物（合成音频）在 [`../index-tts-eval/`](../index-tts-eval/) 按实验编号归档。
> 实验方法论：同文本（prosody 句，20 词）同 seed（20260918）无情绪条件（`emotionFromText:false`）合成，时长换算 wpm + 人耳听感。

## 最终音色池（2026-10-18 用户定稿，5 声：3 男 2 女）

**annmale（Jones-Cruise）· Greenman · Brooks · Alec Daitsman · A. Janelle Risa**

## 样本清单

| 文件 | 音色 | 性别 | 出处 | 许可证 | 参考窗 | 实验 wpm | 评估状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `announcer-male-12s.wav` | **Christopher Jones-Cruise**（VOA Learning English《As It Is》） | 男 | [Commons](https://commons.wikimedia.org/wiki/File:An_American_National,_But_Not_a_Citizen.mp3) | PD-USGov | 90-102s | 106-112 | **✅ 入池**（df 0.85 → 125-132，E11 验证） |
| `reading-greenman-12s.wav` | **John Greenman**（《密西西比河上的生活》） | 男 | [LibriVox](https://librivox.org/life-on-the-mississippi-by-mark-twain/) / [archive.org](https://archive.org/details/life_mississippi_jg_librivox) | PD（LibriVox） | 30-42s | 114 | **✅ 入池**（E14 f16 确认不错） |
| `weekly-brooks-12s.wav` | **Rep. Susan Brooks**（每周共和党回应 2015-03-14） | 女 | [archive.org](https://archive.org/details/31415WeeklyRepublicanAddressRep.SusanBrooksRIN) | 联邦 PD（议员职务作品） | 14-26s | 126 | **✅ 入池**（E14 f16 确认不错） |
| `voices_alec_daitsman.flac` / `user-alec.wav` | **Alec Daitsman** | 男 | [voice-zero](https://github.com/OwenTyme/voice-zero)（LibriVox 读者 [reader/2272](https://librivox.org/reader/2272)）；原始出处：[Famous Men of the Middle Ages, Track 12](https://librivox.org/famous-men-of-the-middle-ages-by-john-h-haaren-and-a-b-poland/) | **CC0**（voice-zero 全库；样本经 RNNoise/Kanade/Resemble Enhance 降噪增强） | 全段 8.68s | 150 | **✅ 入池**（用户评"还可以，不算很好"；df≈0.83 压速） |
| `voices_a_janelle_risa.flac` / `user-janelle.wav` | **A. Janelle Risa** | 女 | [voice-zero](https://github.com/OwenTyme/voice-zero)（LibriVox 读者 [reader/4214](https://librivox.org/reader/4214)）；原始出处：[Anne of Green Gables (v5), Track 16](https://librivox.org/anne-of-green-gables-version-5-by-lucy-maud-montgomery/) | **CC0**（同上） | 全段 7.62s | 155-160 | **✅ 入池**（同上；df≈0.8 压速） |
| `obama-12s.wav` | Barack Obama（每周讲话 2009-01-24） | 男 | [archive.org](https://archive.org/details/PresidentObamaWeeklyAddress012409)（白宫官方播客） | 联邦 PD（17 USC §105） | 2-14s | 127-138 | ❌ 移除（2026-10-18 用户决定） |
| `weekly-obama17-12s.wav` | Barack Obama（最后一次每周讲话 2017-01-14） | 男 | [奥巴马白宫存档](https://obamawhitehouse.archives.gov/the-press-office/2017/01/14/weekly-address-honor-serving-you-president) | 联邦 PD | 9-21s | 128 | ❌ 否决（E12） |
| `weekly-biden-12s.wav` | Joe Biden（副总统期每周讲话 2016-10-29） | 男 | [奥巴马白宫存档](https://obamawhitehouse.archives.gov/the-press-office/2016/10/29/weekly-address-achieving-mission-cancer-moonshot) | 联邦 PD | 1-13s | 143 | ❌ 否决（E12） |
| `weekly-trump-12s.wav` | Donald Trump（每周讲话 2017-03-24） | 男 | [archive.org](https://archive.org/details/witnde-President_Donald_Trump_s_Weekly_Address_-_March_24_2017)（社区台转存官方视频） | 联邦 PD | 1-13s | 117 | ❌ 否决（E12） |
| `weekly-black-12s.wav` | Rep. Diane Black（每周回应 2013-09-14） | 女 | [archive.org](https://archive.org/details/RNCWeeklyDianeBlack91413) | 联邦 PD | 0-12s | 117 | ❌ 否决（E12） |
| `weekly-michelle-12s.wav` | Michelle Obama（圣诞每周讲话 2016-12-24） | 女 | [奥巴马白宫存档](https://obamawhitehouse.archives.gov/the-press-office/2016/12/24/weekly-address-merry-christmas-president-and-first-lady) | 联邦 PD | 44-56s | 121 | ❌ 否决（E12） |
| `reading-barnes-12s.wav` | David Barnes（《化身博士》2006） | 男 | [LibriVox](https://librivox.org/the-strange-case-of-dr-jekyll-mr-hyde-by-robert-louis-stevenson/) / [archive.org](https://archive.org/details/jekyll_and_hyde_librivox) | PD | 35-47s | 95 | ❌ 否决（E13） |
| `reading-neufeld-12s.wav` | Bob Neufeld（《化身博士》v3 2011） | 男 | [LibriVox](https://librivox.org/the-strange-case-of-dr-jekyll-and-mr-hyde-by-robert-louis-stevenson/) / [archive.org](https://archive.org/details/jekyll_hyde_1111_librivox) | PD | 30-42s | 123 | ❌ 否决（E13） |
| `reading-walden-12s.wav` | Laurie Anne Walden（《巴斯克维尔的猎犬》第 8 章） | 女 | [LibriVox](https://librivox.org/the-hound-of-the-baskervilles-by-arthur-conan-doyle/) / [archive.org](https://archive.org/details/hound_baskervilles_librivox) | PD | 25-37s | 122 | ❌ 否决（E13） |
| `reading-savage-12s.wav` | Karen Savage（《傲慢与偏见》v3） | 女 | [LibriVox](https://librivox.org/pride-and-prejudice-by-jane-austen-2/) / [archive.org](https://archive.org/details/pride_prejudice_krs_librivox) | PD | 25-37s | 150 | ❌ 否决（E13） |
| `reading-uscis.wav` | USCIS 公民测试旁白（Q08） | ? | [USCIS 官方](https://www.uscis.gov/citizenship/find-study-materials-and-resources/study-for-the-test/100-civics-questions-and-answers-with-mp3-audio-english-version)（官方站 403，经 [archive.org 镜像](https://archive.org/details/question-01-what-is-the-supreme-law-of-the-land)获取） | 联邦 PD | Q08 4-16s | 113 | ❌ 否决（E13） |
| （引用）[`native/qwen-tts/voice-design/american-woman.wav`](../native/qwen-tts/voice-design/american-woman.wav) | Qwen VoiceDesign 合成女声 | 女 | 本仓库（provenance JSON 同目录；字节级同文件不重复入库） | Apache-2.0 模型生成 | 全段 10.9s | 122-125 | 原基线；**已定位为"平淡"根因**（韵律复刻自参考） |
| （引用）[`native/qwen-tts/voice-design/american-man.wav`](../native/qwen-tts/voice-design/american-man.wav) | Qwen VoiceDesign 合成男声 | 男 | 同上 | 同上 | 全段 | 未测 | 未定 |
| `jabberwocky-12s.wav` | Dvortygirl（《Jabberwocky》戏剧化朗读） | 女 | [Commons](https://commons.wikimedia.org/wiki/File:Jabberwocky.ogg) | PD（朗读者自行释出） | 首 12s | 145-162 | ❌ 方向让位（E2） |
| `jabberwocky-uk-12s.wav` | Vanderdecken（《Jabberwocky》英音朗读） | 男 | [Commons](https://commons.wikimedia.org/wiki/File:Jabberwocky-UK.ogg) | CC0 | 首 12s | 108 | ❌ 否决（E7a） |
| `raven-mid-12s.wav` | Chris Goringe（《The Raven》） | 男 | [LibriVox](https://librivox.org/the-raven-by-edgar-allan-poe/) / [archive.org](https://archive.org/details/raven) | CC0 | 2:00-2:12 | 98 | ❌ 否决（E7b） |
| `announcer-female-12s.wav` | Diane Roberts（VOA 整点新闻） | 女 | [Commons](https://commons.wikimedia.org/wiki/File:20220908-180000-VEN119-program_-_VOA_News_announcing_Queen_Elizabeth_II%27s_death.ogg) | PD-USGov-VOA | 8-20s | 155-157 | ❌ 否决（E8c/d） |
| `uptalk-24k.wav` | 升调疑问句样本（情绪参考素材，非音色参考） | 女 | [Commons](https://commons.wikimedia.org/wiki/File:Example_of_Uptalk_Used_for_Grounding.wav) | CC0 | 全段 2.5s | — | ❌ 否决（E2c 语速传导太急） |

## 关键结论（详见 `.cache/index-tts-quality-state.md`）

- **韵律与语速复刻自参考音频**（IndexTTS2 论文），选参考 = 选风格与语速档（95-157 wpm 跨度）。
- 语速统一用 `durationFactor` 线性校准（E11 已验证：0.85 倍率实测与理论值误差 <1%）。
- 产品默认配置 `emotionFromText` 开（合成原文做情绪分类）；中性文本安全回退 [自然=1]。
- 参考窗 5-15s 甜点区；引擎 style encoder 工作在 16kHz，44.1k/24k 源都会被重采样（voice-zero 的 44kHz 增强版无浪费但也无额外收益）。
- voice-zero 样本已经过专业降噪链（RNNoise + Kanade 重合成 + Resemble Enhance），是本库中预处理质量最高的来源。

## 源文件说明

体积较大的原始源文件（整章 MP3/OGG，未收入本文件夹）保留在 `.cache/voice-test/`（gitignore 区），需要重下时按上表出处链接获取。
