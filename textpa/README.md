# TextPA 可部署复现

这是论文 *Read to Hear: A Zero-Shot Pronunciation Assessment Using Textual
Descriptions and LLMs* 的独立工程化复现。它不依赖工作区中的 Electron 项目。

链路保持论文的核心设计：

1. Whisper 生成英文转写。
2. wav2vec2 生成识别 IPA。
3. Charsiu frame classifier 生成 CMU/ARPAbet，并把内部静音写成
   `(0.12s pause)`。
4. 文本 LLM 根据 transcript、CMU 和 IPA 输出 1-5 分的 Accuracy、Fluency
   及 Reasoning。
5. eSpeak 从 ASR transcript 生成 canonical IPA，并与识别 IPA 匹配以修正
   Accuracy。

## 与论文实现的边界

- ASR 默认使用同一 `large-v3` 模型的 faster-whisper CPU int8 版本，便于部署；
  论文用 Transformers float 模型。已知的单条实测偏差见
  [`BENCHMARK.md`](BENCHMARK.md)。
- `scores.paper_cohort_accuracy` 精确采用论文的测试集 min-max 融合，只适合
  批量评估。单条在线请求没有论文同款分数。
- `scores.deployment_accuracy_1_5` 使用固定标尺和 phone-token 匹配，是稳定的
  在线 1-5 分；它是部署定义，不冒充论文指标。
- LLM 默认走最兼容的 Chat Completions 风格，并保留论文的单 user message、
  Python dict 输入和默认采样参数。也可切换 Responses API 或 JSON mode。

## 环境

当前验证环境是 Linux x86_64、Python 3.11 和纯 CPU 推理。实验容器可直接安装
到全局 Python；`requirements-lock.txt` 固定了本次实测的完整传递依赖：

```bash
cd /workspace/textpa
python3 -m pip install --break-system-packages -r requirements-lock.txt
python3 -m pip install --break-system-packages --no-deps -e .
```

`requirements-cpu.txt` 只固定六个顶层依赖，适合需要让 pip 重新解析传递依赖时
使用；环境重建和结果复核应优先使用 lock 文件。

音频解码、时长检查和最终 IPA 修正还需要 FFmpeg/FFprobe 与 eSpeak NG：

```bash
apt-get update
apt-get install -y ffmpeg espeak-ng
```

检查环境：

```bash
textpa doctor --cache-dir models
```

模型首次运行时下载。固定的模型 revision 和大致权重为：Whisper large-v3
约 3.1 GB、IPA wav2vec2 约 1.3 GB、Charsiu 约 0.38 GB。

## 基准资料

下面的命令只下载约 0.5 MB 的官方 MultiPA 中间结果和标注，并验证论文中
LLM-only 的 PCC：

```bash
textpa verify-reference --output-dir artifacts/multipa-reference
```

应得到：

| 论文后端 | Accuracy PCC | Fluency PCC |
|---|---:|---:|
| gpt-4o-mini, LLM-only | 0.643 | 0.650 |
| gemini-2.0-flash, LLM-only | 0.554 | 0.557 |

论文加入 IPA match 后的最终 MultiPA Accuracy PCC 分别为 0.728 和 0.697。
当前 eSpeak NG 1.51 环境重算为 0.733 和 0.700；字符级 Smith-Waterman 已与
作者所用 `textdistance` 对齐。论文未固定 eSpeak 版本，也未发布 canonical
IPA、融合结果及实际使用的音素目录，因此只能作近似对照，不能强行校准命中。
完整对照及 CPU 资源数据见 [`BENCHMARK.md`](BENCHMARK.md)。
本次模型评测的原始 `assess` 记录及 manifests 见
[`benchmark-data/`](benchmark-data/README.md)。
TextPA 的直接后续论文、Whisper/CTC/发音属性/韵律改进、指标口径和部署优先级
整理在 [`RELATED_WORK.md`](RELATED_WORK.md)。
本仓库固定作者代码 commit `e429201f2f8a7dbdb594e637bf0139c458256aad`
及 MultiPA revision `ff1e3c79bfb1d113d887a0b7b05fe2900c095264`。

如需 50 条公开音频：

```bash
textpa prepare-reference \
  --output-dir artifacts/multipa-reference \
  --include-audio
```

## 运行链路

声学阶段分开执行，以降低 CPU 内存峰值并支持断点续跑：

```bash
textpa transcribe data/wav \
  -o artifacts/transcripts.jsonl \
  --model large-v3 \
  --compute-type int8 \
  --cache-dir models

textpa extract-cues artifacts/transcripts.jsonl \
  -o artifacts/cues.jsonl \
  --device cpu \
  --cache-dir models
```

声学命令默认拒绝超过 30 秒的输入，避免 wav2vec2 的注意力内存随录音长度快速
增长。部署入口应先切分长录音；确实需要调整时可显式传
`--max-audio-seconds N`。

`--model` 的内置 `large-v3` / `large-v3-turbo` 别名固定到明确 revision。
自定义 Whisper 模型只接受本地 CTranslate2 模型目录，并把目录内容哈希写入
manifest；不接受无法固定内容的远端名称。

LLM 使用 OpenAI-compatible 端点。不要把 key 写入文件：

```bash
export TEXTPA_API_KEY='...'
export TEXTPA_BASE_URL='https://provider.example/v1'

textpa assess artifacts/cues.jsonl \
  -o artifacts/assessments.jsonl \
  --model MODEL_ID \
  --reasoning-effort high \
  --concurrency 3
```

如果服务只支持 Responses API，增加 `--api-style responses`；如果支持 JSON
mode，可增加 `--json-mode`。输出文件按 utterance 即时落盘，重新运行会跳过
已有 ID；每个中间文件旁会生成 `.manifest.json`，输入内容、模型或关键参数
变化时拒绝混合续跑。明确需要重跑时才使用 `--overwrite`。

`--concurrency` 默认是 1。执行器只保持指定数量的在途请求；发生错误时不会继续
派发剩余队列。并发值必须服从实际服务商的限流配置。

对支持推理深度的端点，可使用 `--reasoning-effort` 显式传入 `none`、
`minimal`、`low`、`medium`、`high`、`xhigh` 或 `max`。该值会写入 manifest
和每条输出；省略时不发送此参数，保留服务商默认行为。

加入 canonical IPA 与最终分数：

```bash
textpa finalize artifacts/assessments.jsonl \
  -o artifacts/final.jsonl
```

对 MultiPA 计算指标：

```bash
textpa evaluate-multipa artifacts/final.jsonl \
  --annotations artifacts/multipa-reference/annotation.csv \
  --accuracy-field scores.paper_cohort_accuracy
```

MultiPA 评测默认要求预测完整覆盖全部标注，防止把缺失样本的 PCC 当成论文
对照。只有明确评估子集时才增加 `--allow-subset`。

## 测试

核心测试不需要模型或 API：

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

论文、作者实现及数据仍受各自许可证约束。作者实现为 MIT；MultiPA 与
Speechocean762 的论文实验数据标注为 CC BY 4.0。
