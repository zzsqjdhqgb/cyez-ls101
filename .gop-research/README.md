<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# `.gop-research` 目录状态

本目录保存 CTC/GOP 发音评测算法的研究过程证据：驱动脚本、实验结果 JSON、对照记录。
它不是产品代码，也不进入安装包（`electron-builder.yml` 只打包 `out/`、`resources/`、`docs/` 等路径）。

## 仍然有效的内容

- `exam/**` 的 result / evidence / prompt JSON：模型切换前后的对照原始结果。其中
  `exam/stable-gop-demo-llm-v3/evidence.json` 与 `prompt.txt` 被单元测试直接引用
  （`packages/grading-engine/src/__tests__/speech-correction.test.ts`），**不要删除**。
- `*.py` 脚本：CTC 对齐、GOP 计算与对照实验的复现脚本。

## 已失效的脚本（保留作历史记录，不要直接运行）

| 脚本 | 失效原因 |
| --- | --- |
| `run_current_pronunciation.mjs` | 依赖的 `./pronunciation-engine.mjs` 已删除——那是一个 4.7 MB 的 esbuild 打包产物，内容与 `packages/grading-engine/src/pronunciation.ts` 重复，且只被这一个脚本引用。此外脚本内仍硬编码已下线的 `facebook-wav2vec2-lv-60-espeak-cv-ft-int8` 模型目录与 `/workspace` 绝对路径。 |
| `exam/filter_pronunciation_feedback.mjs` | 硬编码同一个已下线模型的目录名。 |

当前实现请以 `packages/grading-engine/src/pronunciation.ts`（`assessCtcPronunciation` /
`createPronunciationReferences`）与 `scripts/test-pronunciation.js` 为准；需要重新生成端到端
证据时使用后者，它跟随 `scripts/pronunciation-model-assets.json` 固定的 Release 资产。

## 已被忽略的本地产物

`.gitignore` 已排除 `model/`、`site/`、`hf/`、`venv*/`、`pip-cache/`、`tmp/` 以及
`*.bin`、`**/*.pt`、`**/*.wav`、`**/*.webm`、`**/__pycache__/`；录音与模型权重不入库。
