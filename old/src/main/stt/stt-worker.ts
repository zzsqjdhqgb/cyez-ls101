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

const qwen3AsrDir = join(cfg.assetsDir, 'stt', 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
const sileroPath = join(cfg.assetsDir, 'stt', 'silero_vad.onnx')

interface Engine {
  recognizer: InstanceType<typeof sherpa_onnx.OfflineRecognizer>
}

let engine: Engine | null = null

function initEngine(): Engine {
  if (!existsSync(join(qwen3AsrDir, 'encoder.int8.onnx'))) {
    throw new Error(`Qwen3 ASR model not found at ${qwen3AsrDir}`)
  }
  if (!existsSync(sileroPath)) {
    throw new Error(`Silero VAD model not found at ${sileroPath}`)
  }

  log.info('Initializing OfflineRecognizer (Qwen3 ASR 0.6B)...')
  const recognizer = new sherpa_onnx.OfflineRecognizer({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80
    },
    modelConfig: {
      qwen3Asr: {
        convFrontend: join(qwen3AsrDir, 'conv_frontend.onnx'),
        encoder: join(qwen3AsrDir, 'encoder.int8.onnx'),
        decoder: join(qwen3AsrDir, 'decoder.int8.onnx'),
        tokenizer: join(qwen3AsrDir, 'tokenizer'),
        hotwords: ''
      },
      tokens: '',
      numThreads: 2,
      provider: 'cpu',
      debug: 1
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
    const sampleRate = wave.sampleRate
    const totalDuration = samples.length / sampleRate

    const { recognizer } = engine!
    const vad = createVad()

    const windowSize = 512
    const speechSegments: Array<{ samples: Float32Array; startSample: number }> = []

    log.info(`Processing ${samples.length} samples (${totalDuration.toFixed(1)}s)...`)

    for (let i = 0; i < samples.length; i += windowSize) {
      const thisWindow = samples.subarray(i, Math.min(i + windowSize, samples.length))
      vad.acceptWaveform(thisWindow)

      while (!vad.isEmpty()) {
        const segment = vad.front(false)
        vad.pop()
        speechSegments.push({ samples: segment.samples, startSample: segment.start })
      }
    }

    vad.flush()

    while (!vad.isEmpty()) {
      const segment = vad.front(false)
      vad.pop()
      speechSegments.push({ samples: segment.samples, startSample: segment.start })
    }

    // Build contiguous timeline: interleave speech and silence, covering entire audio
    interface TimelineEntry {
      samples: Float32Array
      startSample: number
      endSample: number
      kind: 'speech' | 'silence'
    }

    const timeline: TimelineEntry[] = []
    let cursor = 0

    for (const seg of speechSegments) {
      if (seg.startSample > cursor) {
        timeline.push({
          samples: samples.subarray(cursor, seg.startSample),
          startSample: cursor,
          endSample: seg.startSample,
          kind: 'silence'
        })
      }
      timeline.push({
        samples: seg.samples,
        startSample: seg.startSample,
        endSample: seg.startSample + seg.samples.length,
        kind: 'speech'
      })
      cursor = seg.startSample + seg.samples.length
    }

    // Trailing silence
    if (cursor < samples.length) {
      timeline.push({
        samples: samples.subarray(cursor),
        startSample: cursor,
        endSample: samples.length,
        kind: 'silence'
      })
    }

    // Log timeline
    for (const entry of timeline) {
      const s = entry.startSample / sampleRate
      const e = entry.endSample / sampleRate
      log.info(`[VAD] ${entry.kind}: ${s.toFixed(2)}s - ${e.toFixed(2)}s (${(e - s).toFixed(2)}s)`)
    }

    // Greedy merge contiguous timeline entries, max 30s per chunk
    const MAX_MERGE_DURATION = 30
    const chunks: Array<{ samples: Float32Array; startSample: number; endSample: number }> = []
    let buf = new Float32Array(0)
    let bufStart = 0
    let bufEnd = 0

    for (const entry of timeline) {
      const bufDuration = buf.length / sampleRate
      const entryDuration = (entry.endSample - entry.startSample) / sampleRate

      if (bufDuration + entryDuration <= MAX_MERGE_DURATION) {
        if (buf.length === 0) {
          bufStart = entry.startSample
        }
        const combined = new Float32Array(buf.length + entry.samples.length)
        combined.set(buf)
        combined.set(entry.samples, buf.length)
        buf = combined
        bufEnd = entry.endSample
      } else {
        if (buf.length > 0) {
          chunks.push({ samples: buf, startSample: bufStart, endSample: bufEnd })
        }
        buf = new Float32Array(entry.samples)
        bufStart = entry.startSample
        bufEnd = entry.endSample
      }
    }
    if (buf.length > 0) {
      chunks.push({ samples: buf, startSample: bufStart, endSample: bufEnd })
    }

    log.info(`Timeline entries: ${timeline.length}, chunks: ${chunks.length}`)

    const results: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const stream = recognizer.createStream()
      stream.acceptWaveform({
        samples: chunk.samples,
        sampleRate
      })

      recognizer.decode(stream)
      const r = recognizer.getResult(stream)
      const text = r.text.trim()
      if (text.length > 0) {
        results.push(text.toLowerCase())
      }
      const startSec = chunk.startSample / sampleRate
      const endSec = chunk.endSample / sampleRate
      log.info(`[ASR] chunk #${i + 1}: ${startSec.toFixed(2)}s - ${endSec.toFixed(2)}s (${(chunk.samples.length / sampleRate).toFixed(2)}s) "${text}"`)
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
