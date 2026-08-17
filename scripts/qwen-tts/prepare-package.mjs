/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFileSync } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, modelAssetNames } from './download-release-assets.mjs'

const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()

export async function preparePackage() {
  if (process.env.LS101_SKIP_QWEN_TTS_DOWNLOAD === '1') {
    console.log('[qwen-tts] local package preparation skipped by LS101_SKIP_QWEN_TTS_DOWNLOAD')
    return null
  }
  const modelDir = path.join(root, 'model-assets', 'qwen-tts', 'models')
  const output = path.join(
    root,
    'dist',
    `qwen3-tts-0.6b-base-${config.model.quantization}-${config.release.version}.zip`
  )
  const temporaryOutput = `${output}.part`
  for (const name of Object.values(modelAssetNames())) {
    await assertFile(path.join(modelDir, name), 'Qwen TTS Release 模型')
  }
  const { buildPackage, parseOptions } = await import('./build-package.mjs')
  const voiceMetadata = readVoiceMetadata()
  const args = [
    '--model-dir',
    modelDir,
    '--voices-dir',
    path.join(root, 'native', 'qwen-tts', 'voices'),
    '--version',
    config.release.version,
    '--quantization',
    config.model.quantization,
    '--output',
    temporaryOutput
  ]
  for (const voice of voiceMetadata) args.push('--voice-name', `${voice.id}=${voice.name}`)
  await rm(temporaryOutput, { force: true })
  const result = await buildPackage(parseOptions(args))
  await rm(output, { force: true })
  await rename(temporaryOutput, output)
  console.log(`[qwen-tts] local model package written: ${output}`)
  return { ...result, outputPath: output }
}

function readVoiceMetadata() {
  const file = path.join(root, 'scripts', 'qwen-tts', 'voices.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(value)) throw new Error('Qwen TTS 音色元数据必须是数组')
  return value.map((voice) => {
    if (!voice || !/^[a-zA-Z0-9_.-]+$/.test(voice.id) || typeof voice.name !== 'string') {
      throw new Error('Qwen TTS 音色元数据无效')
    }
    return { id: voice.id, name: voice.name }
  })
}

async function assertFile(file, label) {
  const details = await stat(file).catch(() => null)
  if (!details?.isFile() || details.size <= 0) throw new Error(`${label}不存在：${file}`)
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  preparePackage().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
