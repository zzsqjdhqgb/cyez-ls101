/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { Worker } = require('node:worker_threads')

const MODEL_DIRECTORY = 'facebook-wav2vec2-lv-60-espeak-cv-ft-int8'
const PROVIDER_ID = 'builtin-facebook-phoneme'
const MODEL_ID = 'wav2vec2-lv-60-espeak-cv-ft-int8-c69750f'

function parseArgs(argv) {
  const audioPath = argv[0]
  const textIndex = argv.indexOf('--text')
  const referenceText = textIndex >= 0 ? argv[textIndex + 1] : undefined
  if (!audioPath || !referenceText) {
    throw new Error('用法：node scripts/test-pronunciation.js <audio> --text "Reference sentence"')
  }
  return { audioPath: resolve(audioPath), referenceText }
}

function mediaTypeFor(path) {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'wav') return 'audio/wav'
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'ogg' || extension === 'opus') return 'audio/ogg'
  if (extension === 'flac') return 'audio/flac'
  return 'audio/webm'
}

async function main() {
  const { audioPath, referenceText } = parseArgs(process.argv.slice(2))
  const workerPath = resolve('out/main/pronunciation-assessment-worker.js')
  const modelDir = resolve('externals/ai/pronunciation/model', MODEL_DIRECTORY)
  if (!existsSync(workerPath)) throw new Error('请先运行 yarn electron-vite build')
  if (!existsSync(join(modelDir, 'onnx', 'model_quantized.onnx'))) {
    throw new Error('请先运行 node scripts/download-pronunciation-model.js')
  }
  const worker = new Worker(workerPath, {
    workerData: {
      assets: {
        'model/config.json': join(modelDir, 'config.json'),
        'model/preprocessor_config.json': join(modelDir, 'preprocessor_config.json'),
        'model/vocab.json': join(modelDir, 'vocab.json'),
        'model/onnx/model_quantized.onnx': join(modelDir, 'onnx', 'model_quantized.onnx')
      },
      ffmpegPath: require('ffmpeg-static')
    }
  })
  const result = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error('发音评测超时')), 180_000)
    worker.on('error', reject)
    worker.on('message', (message) => {
      if (message.type === 'ready') {
        worker.postMessage({
          type: 'assess',
          requestId: 'cli',
          request: {
            providerConfigId: PROVIDER_ID,
            modelId: MODEL_ID,
            referenceText,
            audio: {
              data: new Uint8Array(readFileSync(audioPath)),
              mediaType: mediaTypeFor(audioPath),
              filename: audioPath
            }
          }
        })
      } else if (message.type === 'result') {
        clearTimeout(timer)
        resolveResult(message.result)
      } else if (message.type === 'error' || message.type === 'init-error') {
        clearTimeout(timer)
        reject(new Error(message.message))
      }
    })
  })
  await worker.terminate()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
