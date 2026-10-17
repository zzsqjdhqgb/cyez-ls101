/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MODEL_FILE_NAME, loadConfig } from './download-release-assets.mjs'

const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()

export async function preparePackage() {
  if (process.env.LS101_SKIP_INDEX_TTS_DOWNLOAD === '1') {
    console.log('[index-tts] local package preparation skipped by LS101_SKIP_INDEX_TTS_DOWNLOAD')
    return null
  }
  const modelDir = path.join(root, 'externals', 'ai', 'index-tts', 'models')
  const output = path.join(
    root,
    'dist',
    `index-tts-2.5-${config.model.quantization}-${config.package.version}.zip`
  )
  const temporaryOutput = `${output}.part`
  await assertFile(path.join(modelDir, MODEL_FILE_NAME), 'IndexTTS 模型')
  const { buildPackage, parseOptions } = await import('./build-package.mjs')
  const voiceMetadata = readVoiceMetadata(config.voices)
  const args = [
    '--model-dir',
    modelDir,
    '--voices-dir',
    path.join(root, 'native', 'qwen-tts', 'voice-design'),
    '--version',
    config.package.version,
    '--output',
    temporaryOutput
  ]
  for (const voice of voiceMetadata) {
    args.push(
      '--voice',
      `${voice.id}=${path.resolve(root, voice.file)}`,
      '--voice-name',
      `${voice.id}=${voice.name}`
    )
  }
  await rm(temporaryOutput, { force: true })
  const result = await buildPackage(parseOptions(args))
  await rm(output, { force: true })
  await rename(temporaryOutput, output)
  console.log(`[index-tts] local model package written: ${output}`)
  return { ...result, outputPath: output }
}

function readVoiceMetadata(value) {
  if (!Array.isArray(value)) throw new Error('IndexTTS 音色元数据必须是数组')
  return value.map((voice) => {
    if (
      !voice ||
      !/^[a-zA-Z0-9_.-]+$/.test(voice.id) ||
      typeof voice.name !== 'string' ||
      typeof voice.file !== 'string'
    ) {
      throw new Error('IndexTTS 音色元数据无效')
    }
    return { id: voice.id, name: voice.name, file: voice.file }
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
