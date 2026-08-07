/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

//
// Usage: node scripts/test-stt.js [--model-dir <assetsDir>] <path/to/audio.wav|mp3|webm>
//
// This script verifies the sherpa-onnx-node STT setup works correctly.
// It mirrors the reference code pattern provided by the User.
//
// Options:
//   --model-dir <path>  Custom path to model-assets/stt directory (tests paths with spaces, etc.)

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { existsSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
const { execSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')

const sherpa_onnx = require('sherpa-onnx-node')
const ffmpegPath = require('ffmpeg-static')

function resolveAssetsDir(argv) {
  const idx = argv.indexOf('--model-dir')
  if (idx !== -1 && idx + 1 < argv.length) {
    const dir = argv[idx + 1]
    argv.splice(idx, 2)
    return dir
  }
  return join(__dirname, '..', 'model-assets', 'stt')
}

const ASSETS_DIR = resolveAssetsDir(process.argv)
const qwen3AsrDir = join(ASSETS_DIR, 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
const sileroPath = join(ASSETS_DIR, 'silero_vad.onnx')

function checkModels() {
  const files = [
    join(qwen3AsrDir, 'conv_frontend.onnx'),
    join(qwen3AsrDir, 'encoder.int8.onnx'),
    join(qwen3AsrDir, 'decoder.int8.onnx'),
    sileroPath
  ]
  let ok = true
  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`MISSING: ${f}`)
      ok = false
    }
  }
  const tokenizerDir = join(qwen3AsrDir, 'tokenizer')
  if (!existsSync(tokenizerDir)) {
    console.error(`MISSING: ${tokenizerDir}`)
    ok = false
  }
  if (!ok) {
    console.error('\nPlease run: node scripts/download-stt-models.js')
    process.exit(1)
  }
  console.log('All model files found.')
}

function createRecognizer() {
  const config = {
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
  }

  return new sherpa_onnx.OfflineRecognizer(config)
}

function createVad() {
  const config = {
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
  }

  const bufferSizeInSeconds = 60

  return new sherpa_onnx.Vad(config, bufferSizeInSeconds)
}

function convertToWav(inputPath) {
  const ext = inputPath.split('.').pop().toLowerCase()
  if (ext === 'wav') return inputPath

  const outputPath = join(tmpdir(), `${randomUUID()}.wav`)
  console.log(`Converting to WAV: ${inputPath} -> ${outputPath}`)
  execSync(`"${ffmpegPath}" -y -i "${inputPath}" -ar 16000 -ac 1 "${outputPath}"`)
  return outputPath
}

;(() => {
  const audioPath = process.argv[2]
  if (!audioPath) {
    console.error(
      'Usage: node scripts/test-stt.js [--model-dir <assetsDir>] <path/to/audio.wav|mp3|webm>'
    )
    process.exit(1)
  }

  if (!existsSync(audioPath)) {
    console.error(`File not found: ${audioPath}`)
    process.exit(1)
  }

  console.log('Models dir:', ASSETS_DIR)
  checkModels()

  console.log('Creating recognizer...')
  const recognizer = createRecognizer()

  console.log('Creating VAD...')
  const vad = createVad()

  let wavPath = audioPath
  try {
    wavPath = convertToWav(audioPath)

    console.log('Reading WAV file:', wavPath)
    const wave = sherpa_onnx.readWave(wavPath)

    if (wave.sampleRate !== recognizer.config.featConfig.sampleRate) {
      throw new Error(
        `Expected sample rate: ${recognizer.config.featConfig.sampleRate}. Given: ${wave.sampleRate}`
      )
    }

    console.log('Started')
    const start = Date.now()

    const windowSize = vad.config.sileroVad.windowSize
    const speechSegments = []
    for (let i = 0; i < wave.samples.length; i += windowSize) {
      const thisWindow = wave.samples.subarray(i, i + windowSize)
      vad.acceptWaveform(thisWindow)

      while (!vad.isEmpty()) {
        const segment = vad.front()
        vad.pop()
        speechSegments.push({
          samples: segment.samples,
          startSample: segment.start
        })
      }
    }

    vad.flush()

    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()
      speechSegments.push({
        samples: segment.samples,
        startSample: segment.start
      })
    }

    // Build contiguous timeline: interleave speech and silence, covering entire audio
    const timeline = []
    let cursor = 0

    for (const seg of speechSegments) {
      if (seg.startSample > cursor) {
        timeline.push({
          samples: wave.samples.subarray(cursor, seg.startSample),
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

    if (cursor < wave.samples.length) {
      timeline.push({
        samples: wave.samples.subarray(cursor),
        startSample: cursor,
        endSample: wave.samples.length,
        kind: 'silence'
      })
    }

    // Log timeline
    for (const entry of timeline) {
      const s = entry.startSample / wave.sampleRate
      const e = entry.endSample / wave.sampleRate
      console.log(
        `[VAD] ${entry.kind}: ${s.toFixed(2)}s - ${e.toFixed(2)}s (${(e - s).toFixed(2)}s)`
      )
    }

    // Greedy merge contiguous timeline entries, max 30s per chunk
    const MAX_MERGE_DURATION = 30
    const chunks = []
    let buf = null
    let bufStart = 0
    let bufEnd = 0

    for (const entry of timeline) {
      const bufDuration = buf ? buf.length / wave.sampleRate : 0
      const entryDuration = (entry.endSample - entry.startSample) / wave.sampleRate

      if (bufDuration + entryDuration <= MAX_MERGE_DURATION) {
        if (!buf) {
          bufStart = entry.startSample
          buf = new Float32Array(entry.samples)
        } else {
          const combined = new Float32Array(buf.length + entry.samples.length)
          combined.set(buf)
          combined.set(entry.samples, buf.length)
          buf = combined
        }
        bufEnd = entry.endSample
      } else {
        if (buf) {
          chunks.push({ samples: buf, startSample: bufStart, endSample: bufEnd })
        }
        buf = new Float32Array(entry.samples)
        bufStart = entry.startSample
        bufEnd = entry.endSample
      }
    }
    if (buf) {
      chunks.push({ samples: buf, startSample: bufStart, endSample: bufEnd })
    }

    console.log(`Timeline entries: ${timeline.length}, chunks: ${chunks.length}`)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const stream = recognizer.createStream()
      stream.acceptWaveform({
        samples: chunk.samples,
        sampleRate: wave.sampleRate
      })

      recognizer.decode(stream)
      const r = recognizer.getResult(stream)
      const text = r.text.trim()
      const s = chunk.startSample / wave.sampleRate
      const e = chunk.endSample / wave.sampleRate
      console.log(
        `[ASR] chunk #${i + 1}: ${s.toFixed(2)}s - ${e.toFixed(2)}s (${(e - s).toFixed(2)}s) "${text}"`
      )
    }

    const stop = Date.now()
    console.log('Done')

    const elapsed_seconds = (stop - start) / 1000
    const duration = wave.samples.length / wave.sampleRate
    const real_time_factor = elapsed_seconds / duration
    console.log('Wave duration', duration.toFixed(3), 'seconds')
    console.log('Elapsed', elapsed_seconds.toFixed(3), 'seconds')
    console.log(
      `RTF = ${elapsed_seconds.toFixed(3)}/${duration.toFixed(3)} =`,
      real_time_factor.toFixed(3)
    )
  } finally {
    if (wavPath !== audioPath) {
      try {
        unlinkSync(wavPath)
      } catch {
        /* ignore */
      }
    }
  }
})()
