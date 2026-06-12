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
//   --model-dir <path>  Custom path to assets/stt directory (tests paths with spaces, etc.)

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
  return join(__dirname, '..', 'assets', 'stt')
}

const ASSETS_DIR = resolveAssetsDir(process.argv)
const whisperDir = join(ASSETS_DIR, 'sherpa-onnx-whisper-small.en')
const sileroPath = join(ASSETS_DIR, 'silero_vad.onnx')

function checkModels() {
  const files = [
    join(whisperDir, 'small.en-encoder.int8.onnx'),
    join(whisperDir, 'small.en-decoder.int8.onnx'),
    join(whisperDir, 'small.en-tokens.txt'),
    sileroPath
  ]
  let ok = true
  for (const f of files) {
    if (!existsSync(f)) {
      console.error(`MISSING: ${f}`)
      ok = false
    }
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
      whisper: {
        encoder: join(whisperDir, 'small.en-encoder.int8.onnx'),
        decoder: join(whisperDir, 'small.en-decoder.int8.onnx')
      },
      tokens: join(whisperDir, 'small.en-tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0
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
    for (let i = 0; i < wave.samples.length; i += windowSize) {
      const thisWindow = wave.samples.subarray(i, i + windowSize)
      vad.acceptWaveform(thisWindow)

      while (!vad.isEmpty()) {
        const segment = vad.front()
        vad.pop()

        let start_time = segment.start / wave.sampleRate
        let end_time = start_time + segment.samples.length / wave.sampleRate

        start_time = start_time.toFixed(2)
        end_time = end_time.toFixed(2)

        const stream = recognizer.createStream()
        stream.acceptWaveform({
          samples: segment.samples,
          sampleRate: wave.sampleRate
        })

        recognizer.decode(stream)
        const r = recognizer.getResult(stream)
        if (r.text.length > 0) {
          const text = r.text.toLowerCase().trim()
          console.log(`${start_time} -- ${end_time}: ${text}`)
        }
      }
    }

    vad.flush()

    while (!vad.isEmpty()) {
      const segment = vad.front()
      vad.pop()

      let start_time = segment.start / wave.sampleRate
      let end_time = start_time + segment.samples.length / wave.sampleRate

      start_time = start_time.toFixed(2)
      end_time = end_time.toFixed(2)

      const stream = recognizer.createStream()
      stream.acceptWaveform({
        samples: segment.samples,
        sampleRate: wave.sampleRate
      })

      recognizer.decode(stream)
      const r = recognizer.getResult(stream)
      if (r.text.length > 0) {
        const text = r.text.toLowerCase().trim()
        console.log(`${start_time} -- ${end_time}: ${text}`)
      }
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
