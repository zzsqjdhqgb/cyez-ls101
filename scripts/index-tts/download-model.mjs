/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Downloads the pinned IndexTTS 2.5 weights and verifies them before they can be packaged.
 *
 * The model is pinned in scripts/index-tts/assets.json by name, size and SHA-256. Hugging Face is tried
 * first, then the ModelScope mirror; either way the digest is checked against the pin, so a mirror that
 * serves different bytes is rejected rather than silently packaged.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '..', '..')
const HF_BASE = 'https://huggingface.co'
const MODELSCOPE_BASE = 'https://www.modelscope.cn'

export function buildSources(assets) {
  const model = assets.model
  const sources = [`${HF_BASE}/${model.repository}/resolve/${model.revision}/${model.file}`]
  if (model.mirror?.repository) {
    const revision = model.mirror.revision ?? 'master'
    sources.push(
      `${MODELSCOPE_BASE}/api/v1/models/${model.mirror.repository}/repo?Revision=${revision}&FilePath=${encodeURIComponent(model.file)}`
    )
  }
  return sources
}

export async function downloadModel(options = {}) {
  const root = options.root ?? defaultRoot
  const assets = JSON.parse(
    await readFile(options.assetsPath ?? path.join(here, 'assets.json'), 'utf8')
  )
  const model = assets.model
  if (
    !model?.file ||
    !Number.isSafeInteger(model.size) ||
    !/^[0-9a-f]{64}$/.test(model.sha256 ?? '')
  ) {
    throw new Error('scripts/index-tts/assets.json 中的模型 pin 不完整（需要 file/size/sha256）')
  }
  const outputPath =
    options.output ?? path.join(root, 'externals/ai/index-tts/models', path.basename(model.file))
  const sources = buildSources(assets)

  if (options.dryRun) {
    return { outputPath, sources, size: model.size, sha256: model.sha256, downloaded: false }
  }

  const existing = await stat(outputPath).catch(() => null)
  if (existing?.isFile()) {
    const digest = await sha256File(outputPath)
    if (existing.size === model.size && digest === model.sha256) {
      return { outputPath, sources, size: model.size, sha256: model.sha256, downloaded: false }
    }
    await rm(outputPath, { force: true })
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  const failures = []
  for (const source of sources) {
    const partialPath = `${outputPath}.part`
    try {
      const response = await fetch(source, { redirect: 'follow' })
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath))
      const info = await stat(partialPath)
      const digest = await sha256File(partialPath)
      if (info.size !== model.size || digest !== model.sha256) {
        throw new Error(`校验失败：size=${info.size} sha256=${digest}`)
      }
      await rename(partialPath, outputPath)
      return { outputPath, sources, size: model.size, sha256: model.sha256, downloaded: true }
    } catch (error) {
      await rm(partialPath, { force: true })
      failures.push(`${source} -> ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`IndexTTS 权重下载失败：\n  ${failures.join('\n  ')}`)
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  await once(stream, 'end')
  return hash.digest('hex')
}

export function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--output') options.output = argv[++index]
    else if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`未知参数：${flag}`)
  }
  return options
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  try {
    const options = parseOptions(process.argv.slice(2))
    if (options.help) {
      console.log(`用法：node scripts/index-tts/download-model.mjs [--output <path>] [--dry-run]`)
      process.exit(0)
    }
    const result = await downloadModel(options)
    if (options.dryRun) {
      console.log(`[index-tts] model pin: ${result.size} B ${result.sha256}`)
      for (const source of result.sources) console.log(`  ${source}`)
      console.log(`[index-tts] destination: ${result.outputPath}`)
    } else {
      console.log(
        `[index-tts] ${result.downloaded ? 'downloaded' : 'already present'}: ${result.outputPath}`
      )
    }
  } catch (error) {
    console.error(`[index-tts] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
