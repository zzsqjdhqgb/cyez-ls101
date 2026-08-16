import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parentPort, workerData } from 'node:worker_threads'

const require = createRequire(import.meta.url)
const sherpaOnnx = require('sherpa-onnx-node') as {
  OfflineRecognizer: new (config: Record<string, unknown>) => {
    createStream(): {
      acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
    }
    decode(stream: unknown): void
    getResult(stream: unknown): { text: string }
  }
  Vad: new (
    config: Record<string, unknown>,
    bufferSizeInSeconds: number
  ) => {
    acceptWaveform(samples: Float32Array): void
    isEmpty(): boolean
    front(enableExternalBuffer?: boolean): { samples: Float32Array; start: number }
    pop(): void
    flush(): void
  }
  readWave(
    path: string,
    enableExternalBuffer?: boolean
  ): { samples: Float32Array; sampleRate: number }
}

interface WorkerConfig {
  assetsDir: string
  ffmpegPath: string
}

const config = workerData as WorkerConfig
const modelDir = join(config.assetsDir, 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
const sileroPath = join(config.assetsDir, 'silero_vad.onnx')
let recognizer: InstanceType<typeof sherpaOnnx.OfflineRecognizer>

function initialize(): void {
  for (const path of [
    join(modelDir, 'conv_frontend.onnx'),
    join(modelDir, 'encoder.int8.onnx'),
    join(modelDir, 'decoder.int8.onnx'),
    join(modelDir, 'tokenizer'),
    sileroPath
  ]) {
    if (!existsSync(path)) throw new Error(`Qwen3 ASR 模型文件不存在：${path}`)
  }
  recognizer = new sherpaOnnx.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      qwen3Asr: {
        convFrontend: join(modelDir, 'conv_frontend.onnx'),
        encoder: join(modelDir, 'encoder.int8.onnx'),
        decoder: join(modelDir, 'decoder.int8.onnx'),
        tokenizer: join(modelDir, 'tokenizer'),
        hotwords: ''
      },
      tokens: '',
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    }
  })
}

function recognize(data: Uint8Array, filename?: string): string {
  const directory = join(tmpdir(), `ls101-asr-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const extension = safeExtension(filename)
  const inputPath = join(directory, `input${extension}`)
  const wavPath = join(directory, 'audio.wav')
  try {
    writeFileSync(inputPath, data)
    const converted = spawnSync(
      config.ffmpegPath,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-ar',
        '16000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        wavPath
      ],
      { encoding: 'utf8' }
    )
    if (converted.error) throw converted.error
    if (converted.status !== 0) {
      throw new Error(converted.stderr.trim() || `FFmpeg 退出（${converted.status}）`)
    }
    // Electron does not allow the external ArrayBuffers returned by sherpa-onnx by default.
    const wave = sherpaOnnx.readWave(wavPath, false)
    if (wave.sampleRate !== 16000) throw new Error(`语音采样率无效：${wave.sampleRate}`)
    return recognizeWave(wave.samples, wave.sampleRate)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function recognizeWave(samples: Float32Array, sampleRate: number): string {
  const vad = new sherpaOnnx.Vad(
    {
      sileroVad: {
        model: sileroPath,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 30,
        windowSize: 512
      },
      sampleRate,
      debug: false,
      numThreads: 1
    },
    120
  )
  const segments: Array<{ samples: Float32Array; start: number }> = []
  for (let index = 0; index < samples.length; index += 512) {
    vad.acceptWaveform(samples.subarray(index, Math.min(index + 512, samples.length)))
    drainVad(vad, segments)
  }
  vad.flush()
  drainVad(vad, segments)
  const texts: string[] = []
  for (const segment of segments) {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples: segment.samples, sampleRate })
    recognizer.decode(stream)
    const text = recognizer.getResult(stream).text.trim()
    if (text) texts.push(text)
  }
  return texts.join(' ').trim()
}

function drainVad(
  vad: InstanceType<typeof sherpaOnnx.Vad>,
  segments: Array<{ samples: Float32Array; start: number }>
): void {
  while (!vad.isEmpty()) {
    const segment = vad.front(false)
    vad.pop()
    segments.push({ samples: segment.samples, start: segment.start })
  }
}

function safeExtension(filename?: string): string {
  if (!filename) return '.audio'
  const extension = extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.audio'
}

function send(message: Record<string, unknown>): void {
  parentPort?.postMessage(message)
}

if (!parentPort) throw new Error('Qwen3 ASR Worker 缺少 parentPort')

try {
  initialize()
  send({ type: 'ready' })
  parentPort.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object') return
    const value = message as {
      type?: unknown
      requestId?: unknown
      audio?: { data?: unknown; filename?: unknown }
    }
    if (
      value.type !== 'recognize' ||
      typeof value.requestId !== 'string' ||
      !(value.audio?.data instanceof Uint8Array)
    ) {
      return
    }
    try {
      send({
        type: 'result',
        requestId: value.requestId,
        text: recognize(
          value.audio.data,
          typeof value.audio.filename === 'string' ? value.audio.filename : undefined
        )
      })
    } catch (error) {
      send({
        type: 'error',
        requestId: value.requestId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
} catch (error) {
  send({ type: 'init-error', message: error instanceof Error ? error.message : String(error) })
}
