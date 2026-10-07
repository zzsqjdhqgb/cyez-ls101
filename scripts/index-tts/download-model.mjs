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

export const USAGE =
  '用法：node scripts/index-tts/download-model.mjs [--output <path>] [--dry-run] [--help]'

/**
 * Percent-encodes a URL path segment by segment, so a repository, revision or file name containing
 * `#`, `?`, `%` or a space can never change the shape of the request.
 *
 * A `.`/`..` segment is rejected rather than encoded: `encodeURIComponent` leaves the dots alone and
 * the URL parser would then silently collapse the path into a different resource.
 */
export function encodeUrlPath(value) {
  return String(value)
    .split('/')
    .map((segment) => {
      if (segment === '.' || segment === '..') {
        throw new Error(`下载地址中的路径段非法（不能是 . 或 ..）：${value}`)
      }
      return encodeURIComponent(segment)
    })
    .join('/')
}

/** Appends encoded path segments to `base`, keeping any path prefix `base` already carries. */
function urlWithPath(base, segments) {
  const url = new URL(base)
  const prefix = url.pathname.replace(/\/+$/, '')
  url.pathname = `${prefix}/${segments.map(encodeUrlPath).join('/')}`
  return url
}

/** `https://huggingface.co/<repository>/resolve/<revision>/<file>`, every segment encoded. */
export function buildHuggingFaceUrl(model, base = HF_BASE) {
  return urlWithPath(base, [model.repository, 'resolve', model.revision, model.file]).toString()
}

/** ModelScope mirror URL; the whole file path travels in the `FilePath` query value. */
export function buildModelScopeUrl(mirror, file, base = MODELSCOPE_BASE) {
  const url = urlWithPath(base, ['api', 'v1', 'models', mirror.repository, 'repo'])
  url.searchParams.set('Revision', mirror.revision ?? 'master')
  url.searchParams.set('FilePath', file)
  return url.toString()
}

export function buildSources(assets, options = {}) {
  const model = assets.model
  const sources = [buildHuggingFaceUrl(model, options.huggingFaceBase ?? HF_BASE)]
  if (model.mirror?.repository) {
    sources.push(
      buildModelScopeUrl(model.mirror, model.file, options.mirrorBase ?? MODELSCOPE_BASE)
    )
  }
  return sources
}

/** True only when a file's size and SHA-256 both match the assets.json pin. */
export function matchesPin(model, size, sha256) {
  return size === model.size && String(sha256).toLowerCase() === model.sha256
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
  const sources = buildSources(assets, options)

  if (options.dryRun) {
    return { outputPath, sources, size: model.size, sha256: model.sha256, downloaded: false }
  }

  const existing = await stat(outputPath).catch(() => null)
  if (existing?.isFile()) {
    const digest = await sha256File(outputPath)
    if (matchesPin(model, existing.size, digest)) {
      return { outputPath, sources, size: model.size, sha256: model.sha256, downloaded: false }
    }
    // A cached file that no longer matches the pin must never be reused.
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
      if (!matchesPin(model, info.size, digest)) {
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

/** Reads the value of an option, refusing a missing value or another option as the value. */
function readOptionValue(argv, index, flag) {
  const value = argv[index + 1]
  if (value === undefined || value === '' || value.startsWith('--') || value === '-h') {
    throw new Error(`${flag} 缺少取值，取值不能为空，也不能是另一个选项。\n${USAGE}`)
  }
  return value
}

export function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--output') {
      options.output = readOptionValue(argv, index, flag)
      index += 1
    } else if (flag === '--dry-run') options.dryRun = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`未知参数：${flag}\n${USAGE}`)
  }
  return options
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  try {
    const options = parseOptions(process.argv.slice(2))
    if (options.help) {
      console.log(USAGE)
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
