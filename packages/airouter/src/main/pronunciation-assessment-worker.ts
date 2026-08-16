import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import type * as OnnxRuntime from 'onnxruntime-node'
import { assessCtcPronunciation } from '@ls101/grading-engine/pronunciation'
import type { AIRouterPronunciationAssessmentRequest } from '../shared'

const SAMPLE_RATE = 16_000
const MAX_PCM_BYTES = 256 * 1024 * 1024

interface WorkerConfig {
  modelDir: string
  ffmpegPath: string
}

const require = createRequire(import.meta.url)
let workerConfig: WorkerConfig
let runtime: typeof OnnxRuntime
let session: OnnxRuntime.InferenceSession
let vocabulary: Record<string, number>

async function initialize(config: WorkerConfig): Promise<void> {
  // On Windows, loading the addon through the ESM/bundle import path can resolve it through a
  // \\?\ path and fail with ERROR_BAD_EXE_FORMAT. Use the package's direct CommonJS path instead.
  workerConfig = config
  runtime = require('onnxruntime-node') as typeof OnnxRuntime
  vocabulary = JSON.parse(readFileSync(join(config.modelDir, 'vocab.json'), 'utf8')) as Record<
    string,
    number
  >
  session = await runtime.InferenceSession.create(
    join(config.modelDir, 'onnx', 'model_quantized.onnx'),
    {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 2,
      interOpNumThreads: 1
    }
  )
}

async function assess(
  request: AIRouterPronunciationAssessmentRequest
): Promise<ReturnType<typeof assessCtcPronunciation>> {
  const samples = decodeAudio(request.audio.data)
  normalizeSamples(samples)
  const input = new runtime.Tensor('float32', samples, [1, samples.length])
  const output = await session.run({ input_values: input })
  const logits = output.logits
  if (!logits || logits.type !== 'float32' || logits.dims.length !== 3) {
    throw new Error('发音模型输出 logits 无效')
  }
  const frameCount = Number(logits.dims[1])
  const vocabularySize = Number(logits.dims[2])
  if (!(logits.data instanceof Float32Array)) throw new Error('发音模型 logits 类型无效')
  return assessCtcPronunciation({
    logits: logits.data,
    frameCount,
    vocabularySize,
    vocabulary,
    referenceText: request.referenceText,
    durationMs: (samples.length / SAMPLE_RATE) * 1000,
    blankTokenId: vocabulary['<pad>'] ?? 0
  })
}

function decodeAudio(data: Uint8Array): Float32Array {
  const converted = spawnSync(
    workerConfig.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_f32le',
      '-f',
      'f32le',
      'pipe:1'
    ],
    { input: data, maxBuffer: MAX_PCM_BYTES }
  )
  if (converted.error) throw converted.error
  if (converted.status !== 0) {
    throw new Error(
      converted.stderr.toString('utf8').trim() || `FFmpeg 退出（${converted.status}）`
    )
  }
  if (!converted.stdout.byteLength || converted.stdout.byteLength % 4 !== 0) {
    throw new Error('FFmpeg 未生成有效的 float32 PCM')
  }
  return new Float32Array(
    converted.stdout.buffer.slice(
      converted.stdout.byteOffset,
      converted.stdout.byteOffset + converted.stdout.byteLength
    )
  )
}

function normalizeSamples(samples: Float32Array): void {
  let mean = 0
  for (const sample of samples) mean += sample
  mean /= samples.length
  let variance = 0
  for (const sample of samples) variance += (sample - mean) ** 2
  variance /= samples.length
  const scale = Math.sqrt(variance + 1e-7)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] - mean) / scale
  }
}

function send(message: Record<string, unknown>): void {
  if (parentPort) {
    parentPort.postMessage(message)
    return
  }
  if (typeof process.send === 'function') process.send(message)
}

function listen(): void {
  const onMessage = (message: unknown): void => {
    if (!message || typeof message !== 'object') return
    const value = message as { type?: unknown; requestId?: unknown; request?: unknown }
    if (
      value.type !== 'assess' ||
      typeof value.requestId !== 'string' ||
      !value.request ||
      typeof value.request !== 'object'
    ) {
      return
    }
    void assess(value.request as AIRouterPronunciationAssessmentRequest)
      .then((result) => send({ type: 'result', requestId: value.requestId, result }))
      .catch((error: unknown) =>
        send({
          type: 'error',
          requestId: value.requestId,
          message: error instanceof Error ? error.message : String(error)
        })
      )
  }
  if (parentPort) parentPort.on('message', onMessage)
  else process.on('message', onMessage)
}

function start(config: WorkerConfig): void {
  initialize(config)
    .then(() => {
      send({ type: 'ready' })
      listen()
    })
    .catch((error: unknown) => {
      send({ type: 'init-error', message: error instanceof Error ? error.message : String(error) })
    })
}

if (isWorkerConfig(workerData)) {
  start(workerData)
} else if (typeof process.send === 'function') {
  process.once('message', (message: unknown) => {
    if (!isWorkerConfig(message)) {
      send({ type: 'init-error', message: '发音评测子进程初始化参数无效' })
      return
    }
    start(message)
  })
} else {
  throw new Error('发音评测 Worker 缺少启动通道')
}

function isWorkerConfig(value: unknown): value is WorkerConfig {
  return (
    isRecord(value) && typeof value.modelDir === 'string' && typeof value.ffmpegPath === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
