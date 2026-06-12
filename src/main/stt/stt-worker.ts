/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { parentPort, workerData } from 'node:worker_threads'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sherpa_onnx = require('sherpa-onnx-node')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static')

interface WorkerConfig {
  assetsDir: string
}

const cfg: WorkerConfig = workerData as WorkerConfig

const LOG_PREFIX = '[STT-Worker]'
const log = {
  debug: (...args: unknown[]): void => {
    console.debug(LOG_PREFIX, ...args)
  },
  info: (...args: unknown[]): void => {
    console.log(LOG_PREFIX, ...args)
  },
  warn: (...args: unknown[]): void => {
    console.warn(LOG_PREFIX, ...args)
  },
  error: (...args: unknown[]): void => {
    console.error(LOG_PREFIX, ...args)
  }
}

function send(msg: Record<string, unknown>): void {
  parentPort!.postMessage(msg)
}

const whisperDir = join(cfg.assetsDir, 'stt', 'sherpa-onnx-whisper-small.en')
const sileroPath = join(cfg.assetsDir, 'stt', 'silero_vad.onnx')

interface Engine {
  recognizer: InstanceType<typeof sherpa_onnx.OfflineRecognizer>
}

let engine: Engine | null = null

function initEngine(): Engine {
  if (!existsSync(join(whisperDir, 'small.en-encoder.int8.onnx'))) {
    throw new Error(`Whisper model not found at ${whisperDir}`)
  }
  if (!existsSync(sileroPath)) {
    throw new Error(`Silero VAD model not found at ${sileroPath}`)
  }

  log.info('Initializing OfflineRecognizer (Whisper small.en)...')
  const recognizer = new sherpa_onnx.OfflineRecognizer({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80
    },
    modelConfig: {
      whisper: {
        encoder: join(whisperDir, 'small.en-encoder.int8.onnx'),
        decoder: join(whisperDir, 'small.en-decoder.int8.onnx')
      },
      tokens: join(whisperDir, 'small.en-tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    }
  })

  log.info('OfflineRecognizer initialized')
  return { recognizer }
}

function createVad(): InstanceType<typeof sherpa_onnx.Vad> {
  return new sherpa_onnx.Vad(
    {
      sileroVad: {
        model: sileroPath,
        threshold: 0.5,
        minSpeechDuration: 0.25,
        minSilenceDuration: 0.5,
        maxSpeechDuration: 5,
        windowSize: 512
      },
      sampleRate: 16000,
      debug: false,
      numThreads: 1
    },
    60
  )
}

function convertToWav(inputPath: string): string {
  const ext = inputPath.split('.').pop()?.toLowerCase()
  if (ext === 'wav') return inputPath

  const outputPath = join(tmpdir(), `${randomUUID()}.wav`)
  log.info(`Converting to WAV: ${inputPath} -> ${outputPath}`)
  execSync(`"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 "${outputPath}"`)
  return outputPath
}

function cleanupTemp(wavPath: string, originalPath: string): void {
  if (wavPath !== originalPath && existsSync(wavPath)) {
    try {
      unlinkSync(wavPath)
    } catch {
      /* ignore */
    }
  }
}

function transcribe(audioPath: string): string {
  let wavPath = audioPath

  try {
    wavPath = convertToWav(audioPath)
    log.info('Reading WAV:', wavPath)

    const wave = sherpa_onnx.readWave(wavPath, false)

    if (wave.sampleRate !== 16000) {
      throw new Error(`Expected sample rate 16000. Got: ${wave.sampleRate}`)
    }

    const samples = wave.samples

    const { recognizer } = engine!
    const vad = createVad()

    const windowSize = 512
    const results: string[] = []

    log.info(`Processing ${samples.length} samples (${(samples.length / 16000).toFixed(1)}s)...`)

    for (let i = 0; i < samples.length; i += windowSize) {
      // 注意：samples 已经是纯 V8 内部数组，subarray 安全
      const thisWindow = samples.subarray(i, Math.min(i + windowSize, samples.length))
      vad.acceptWaveform(thisWindow)

      while (!vad.isEmpty()) {
        const segment = vad.front(false)
        vad.pop()

        const stream = recognizer.createStream()
        stream.acceptWaveform({
          samples: segment.samples,
          sampleRate: wave.sampleRate
        })

        recognizer.decode(stream)
        const r = recognizer.getResult(stream)
        if (r.text.length > 0) {
          results.push(r.text.toLowerCase().trim())
        }
      }
    }

    vad.flush()

    while (!vad.isEmpty()) {
      const segment = vad.front(false)
      vad.pop()

      const stream = recognizer.createStream()
      stream.acceptWaveform({
        samples: segment.samples,
        sampleRate: wave.sampleRate
      })

      recognizer.decode(stream)
      const r = recognizer.getResult(stream)
      if (r.text.length > 0) {
        results.push(r.text.toLowerCase().trim())
      }
    }

    const text = results.join(' ').trim()
    log.info(`Transcription done: "${text}"`)
    return text
  } finally {
    cleanupTemp(wavPath, audioPath)
  }
}

// ===================== Worker 入口 =====================

if (!parentPort) {
  console.error('[STT-Worker] parentPort is null')
  process.exit(1)
}

try {
  engine = initEngine()
  log.info('Worker ready')
  send({ type: 'ready' })
} catch (err: unknown) {
  log.error('Worker init failed:', err)
  send({ type: 'init-error', error: String(err) })
  process.exit(1)
}

parentPort.on('message', (msg: { type: string; requestId: number; audioPath: string }) => {
  if (msg.type === 'transcribe') {
    try {
      const text = transcribe(msg.audioPath)
      send({ type: 'transcribe-done', requestId: msg.requestId, text })
    } catch (err: unknown) {
      log.error('Transcribe error:', err)
      send({ type: 'transcribe-error', requestId: msg.requestId, error: String(err) })
    }
  }
})
