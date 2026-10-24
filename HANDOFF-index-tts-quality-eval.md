# Handoff: IndexTTS 2.5 音质评估（side conversation 结论）

> 2026-10-17 ~ 10-19 的音质评估 side conversation 已收口。全部改动已提交（5 笔），本文是给主分支/后续工作的交接摘要。

## 提交清单

| 提交 | 内容 |
| --- | --- |
| `15f7f75` | `native/index-tts/main.cpp`：helper 协议 +4 可选字段（`durationFactor`/`temperature`/`topP`/`topK`）；**情绪字段全部移除**。向后兼容（应用侧零改动），已字节级验证 |
| `28c868d` | TODO：maxTokens 崩溃（GGML 256MiB 池断言，待大内存复测） |
| （同批） | TODO：f16 分发分卷（>4GB ZIP）；异音词自动化（g2p 前置消歧） |
| `6d3d016` | `voice-samples/`（24 文件 12MB）：音色库 + README 全表（出处/许可证/剪窗/wpm/状态） |
| `53d3dca` | `index-tts-eval/`（80 文件 33MB）：E0-E18 实验 WAV + README 索引 |

## 一句话结论

三个音质问题全部定位并有解：**金属感**=量化（f16 改善，分发记 TODO）；**平淡/问句无起伏**=Qwen 合成参考音本身平淡（韵律复刻自参考）→ 换真人参考；**read 读错**=`<read|R IY1 D>` 内联标注有效（自动化记 TODO）。**引擎情绪控制在克隆场景不稳定，协议已全部关闭。**

## 最终音色池（5 声，3 男 2 女）

annmale（VOA Jones-Cruise）· Greenman · Brooks · Alec Daitsman · A. Janelle Risa（voice-zero CC0）

语速统一：每音色一个 `durationFactor` 系数（`index-tts-eval/E17-final-config-corrected/calibration.json`：0.90/1.0/1.07/1.09/1.17），产品管线全局 125 wpm。

## 后续工作（按优先级）

1. **runtime 二进制重建**：`externals/ai/index-tts/runtime/linux-x64/` 仍是旧协议版；用新字段前先 `yarn index-tts:build-runtime --backend cpu`
2. **音色资产化**：5 个入池音色进产品 voices 管线（assets.json + provenance JSON + 校准系数入 manifest）
3. **三个 TODO**：maxTokens 复测 / f16 分卷 / 异音词 g2p 自动化
4. **可选**：qwen 1.7B + ICL 韵律克隆——当前 pin 不兼容，等上游 [PR #30](https://github.com/predict-woo/qwen3-tts.cpp/pull/30) 合并后升级 pin 重新评测（qwen 路线届时补齐韵律短板，凭 7-10 倍速度优势可上探批量场景）
5. **可选**：把 E6+E16 的 [自然=1] 尖峰回退证据反馈给 audio.cpp 上游（社区零报告）

## 工程记录（开发容器本地，gitignored）

`.cache/index-tts-quality-state.md`：E0-E18 全部参数与产物、12 批听感决策链、6 份子代理调研（发音标注规范/情绪控制实证/音色素材出处）、下载源直链。恢复上下文先读此文件。
