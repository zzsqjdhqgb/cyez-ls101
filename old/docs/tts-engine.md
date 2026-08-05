<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# TTS 语音合成引擎

## 概述

曹二听说101 内置离线 TTS（Text-to-Speech）引擎，基于 Pocket TTS 模型的 ONNX WASM 导出实现。引擎在独立的 Worker 线程中运行，使用 WebAssembly，无需网络连接或外部 API 调用。

## 技术架构

```
┌───────────────────────────────┐
│  Main Process (tts.ts)        │
│  ┌─────────────────────────┐  │
│  │  getTtsEngine()          │  │
│  │  (单例模式)               │  │
│  │  Worker 线程调度          │  │
│  │  请求-响应消息循环        │  │
│  └─────────┬───────────────┘  │
│            │  postMessage     │
│  ┌─────────▼───────────────┐  │
│  │  Worker Thread           │  │
│  │  (tts-worker.ts)         │  │
│  │  ┌─────────────────┐    │  │
│  │  │ ptts_wasm.js     │    │  │
│  │  │ ptts_wasm_bg.wasm│    │  │
│  │  ├─────────────────┤    │  │
│  │  │ Model (回归模型)   │    │  │
│  │  │ Tokenizer (Unigram)│   │  │
│  │  │ Voice Embeddings  │    │  │
│  │  └─────────────────┘    │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

## 源码结构

| 文件 | 说明 |
|------|------|
| `tts.ts` | 主进程入口，单例 `getTtsEngine()`，Worker 线程创建和消息路由 |
| `tts-worker.ts` | Worker 线程，WASM 加载、模型初始化、合成循环 |
| `tokenizer.ts` | SentencePiece protobuf 解码器 + Unigram 维特比分词器 |
| `wav-encoder.ts` | Float32Array → PCM 16-bit WAV 编码 |

## 模型文件

| 文件 | 路径 | 说明 |
|------|------|------|
| ptts_wasm.js | `resources/tts/` | WASM JavaScript 绑定 |
| ptts_wasm_bg.wasm | `resources/tts/` | WebAssembly 运行时二进制 |
| tts_b6369a24.safetensors | `assets/` | 模型权重文件 |
| tokenizer.model | `assets/` | SentencePiece 分词器模型 (protobuf) |
| {voice}.safetensors | `assets/embeddings_v2/` | 7 种音色的嵌入向量 |

模型文件通过 `scripts/download-tts-assets.js` 从 HuggingFace 下载到 `assets/` 目录。

## 音色列表

引擎支持 7 种英语音色：

| 音色名 | 文件 |
|--------|------|
| alba | `assets/embeddings_v2/alba.safetensors` |
| marius | `assets/embeddings_v2/marius.safetensors` |
| javert | `assets/embeddings_v2/javert.safetensors` |
| fantine | `assets/embeddings_v2/fantine.safetensors` |
| cosette | `assets/embeddings_v2/cosette.safetensors` |
| eponine | `assets/embeddings_v2/eponine.safetensors` |
| azelma | `assets/embeddings_v2/azelma.safetensors` |

默认使用 **alba** 音色。

## 合成参数

| 参数 | 值 | 说明 |
|------|------|------|
| SAMPLE_RATE | 24000 Hz | 采样率 |
| MAX_TOKEN_PER_CHUNK | 50 | 每块最大 token 数 |
| SILENCE_BETWEEN_CHUNKS | 0.2 秒 | 块间静音间隔 |
| temperature | 0.7 | 生成温度 |
| 输出格式 | WAV (PCM 16-bit, 单声道) | |

## 模块详解

### 1. tts.ts — 主进程入口 (`src/main/tts/tts.ts`)

`getTtsEngine()` 采用单例模式：
1. 根据打包状态解析 WASM 和资源文件路径（`resolveWorkerPath()`）
2. 创建 `Worker` 线程，传入 `workerData`
3. 通过消息循环处理四种消息类型：
   - `ready` — Worker 初始化完成，resolve Promise
   - `synthesize-done` — 合成完成，resolve 对应请求
   - `synthesize-error` — 合成失败，reject 对应请求
   - `init-error` — 初始化失败，reject Promise
4. 每次 `synthesize()` 调用分配递增 `requestId`，通过 `pendingRequests` Map 配对请求和响应
5. 返回 `{ synthesize(text, outFile): Promise<void> }` 对象

`terminateTtsWorker()` 终止 Worker 线程并清除状态。

### 2. tokenizer.ts — 分词器 (`src/main/tts/tokenizer.ts`)

**`decodeSentencepieceModel(buffer: Uint8Array)`** (行 7-101)
- 解析 protobuf 格式的 SentencePiece 模型文件
- 使用 varint 解码器逐字段解析
- 返回 `Array<{ piece: string; score: number; type: number }>`

**`UnigramTokenizer` 类** (行 104-154)
- 构造函数：从 pieces 构建词汇表 Map，识别 UNK token（type=2）
- `encode(text)`：将输入文本中的空格替换为 `▁`（U+2581），调用维特比算法
- `viterbi(text)` 维特比分词算法：
  - 动态规划，`best[i]` 记录位置 `i` 处的最优路径（score, len, id）
  - 对每个位置 `i`，尝试长度 1-64 的子串匹配词汇表
  - 匹配成功则更新 `best[i+len]` 为该子串 token 的最佳得分
  - 无匹配时回退：尝试字符的十六进制字节表示（`<0xXX>`），否则用 UNK token（惩罚 -100）
  - 回溯得到 token ID 序列

### 3. wav-encoder.ts — WAV 编码器 (`src/main/tts/wav-encoder.ts`)

**`encodeWav(samples: Float32Array, sampleRate: number): Uint8Array`** (行 7-39)
- 单声道，16-bit 深度
- 构建 44 字节 WAV 头：RIFF chunk + fmt chunk (PCM format) + data chunk
- Float32 样本钳制到 [-1, 1]，转换为 16-bit signed integer
- 返回完整 WAV 文件的 Uint8Array

### 4. tts-worker.ts — Worker 工作线程

执行合成流程：
1. 收到 `workerData`（WASM 路径、assets 目录）
2. 加载 WASM 模块、模型权重、分词器、音色向量
3. 发 `ready` 消息通知主进程
4. 收到 `synthesize` 消息后：
   - 文本预处理（规范化、大写首字母、添加句号）
   - Unigram 分词
   - 按 token 限制分句
   - 逐块合成音频帧（start_generation → generation_step 循环）
   - 块间插入静音
   - WAV 编码并写入文件
   - 发 `synthesize-done` 或 `synthesize-error` 消息

## 使用场景

TTS 引擎在以下场景被调用：

| 场景 | 调用位置 | 说明 |
|------|----------|------|
| 草稿导出 | `draft-service.ts` | 对 `audio` 节点 `src` 文件不存在时合成语音 |
| 模板创建草稿 | 同上 | 作为导出流程的一部分 |

## 依赖

| 依赖 | 许可证 | 说明 |
|------|--------|------|
| Pocket TTS (kyutai-labs) | MIT | 语音合成模型 |
| PocketTTS ONNX Export (KevinAHM) | MIT | WASM 运行时导出 |

## 测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| `tokenizer.test.ts` | 9 | decodeSentencepieceModel 的 protobuf 解析、UnigramTokenizer 编码、空输入、未知字符 |
| `wav-encoder.test.ts` | 11 | WAV 头部结构（RIFF/WAVE/fmt/data chunks）、采样率、声道数、位深度、数据大小、静音编码、样本钳制 |
