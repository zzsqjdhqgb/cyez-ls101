/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Release-time gate for the runtime allowlist.
 *
 * The application refuses to execute a packaged helper unless every runtime asset — the helper AND
 * the shared libraries it loads from its own directory — has its SHA-256 compiled into
 * packages/airouter/src/main/index-tts-runtime.ts. Checking only the helper would let a package ship
 * a trojanised libaudiocpp/CUDA library next to a byte-identical helper.
 *
 * This scans the staged runtime directory (exactly the set build-package.mjs ships) and fails with a
 * ready-to-paste allowlist block when anything is missing.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '..', '..')
const ALLOWLIST_FILE = 'packages/airouter/src/main/index-tts-runtime.ts'

export function parseAllowlist(source) {
  const platformKeys = {}
  const body = source.slice(source.indexOf('INDEX_TTS_HELPER_SHA256'))
  const entryPattern = /'([a-z0-9]+-[a-z0-9]+)'\s*:\s*\[([^\]]*)\]/gi
  for (const match of body.matchAll(entryPattern)) {
    platformKeys[match[1].toLowerCase()] = [...match[2].matchAll(/'([0-9a-f]{64})'/gi)].map(
      (digest) => digest[1].toLowerCase()
    )
  }
  return platformKeys
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  stream.on('data', (chunk) => hash.update(chunk))
  await once(stream, 'end')
  return hash.digest('hex')
}

/**
 * Verifies every file in the staged runtime directory against the app allowlist.
 * @returns {Promise<{ platform: string, directory: string, assets: object[], ok: boolean }>}
 */
export async function verifyAllowlist(options = {}) {
  const root = options.root ?? defaultRoot
  const platform = options.platform ?? `${process.platform}-${process.arch}`
  const directory =
    options.runtimeDirectory ?? path.join(root, 'externals/ai/index-tts/runtime', platform)

  const names = await readdir(directory).catch(() => null)
  if (!names) throw new Error(`缺少 IndexTTS 运行时目录：${directory}`)
  const allowlistSource = await readFile(
    options.allowlistPath ?? path.join(root, ALLOWLIST_FILE),
    'utf8'
  )
  const allowed = new Set(
    (parseAllowlist(allowlistSource)[platform.toLowerCase()] ?? []).map((digest) =>
      digest.toLowerCase()
    )
  )

  const assets = []
  for (const name of [...names].sort()) {
    const assetPath = path.join(directory, name)
    const info = await stat(assetPath).catch(() => null)
    if (!info?.isFile()) continue
    const digest = await sha256File(assetPath)
    assets.push({
      name,
      assetPath,
      size: info.size,
      digest,
      allowed: allowed.has(digest.toLowerCase())
    })
  }
  if (assets.length === 0) throw new Error(`运行期目录为空：${directory}`)
  return { platform, directory, assets, ok: assets.every((asset) => asset.allowed) }
}

/** Markdown for a CI step summary: every runtime digest plus the allowlist block to paste. */
export function formatReport(result) {
  const block = [
    '```ts',
    'export const INDEX_TTS_HELPER_SHA256: Record<string, readonly string[]> = {',
    `  '${result.platform}': [`,
    ...result.assets.map((asset) => `    '${asset.digest}', // ${asset.name}`),
    '  ]',
    '}',
    '```'
  ].join('\n')
  return [
    `## IndexTTS runtime digests (${result.platform})`,
    '',
    `- directory: \`${result.directory}\``,
    `- allowlisted: ${result.ok ? 'yes' : 'no'} (${result.assets.filter((a) => a.allowed).length}/${result.assets.length})`,
    '',
    '| file | bytes | sha256 | allowlisted |',
    '| --- | --- | --- | --- |',
    ...result.assets.map(
      (asset) =>
        `| ${asset.name} | ${asset.size} | \`${asset.digest}\` | ${asset.allowed ? 'yes' : 'no'} |`
    ),
    '',
    'Add to `packages/airouter/src/main/index-tts-runtime.ts` (then rebuild the app):',
    '',
    block,
    ''
  ].join('\n')
}

export function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--platform') options.platform = argv[++index]
    else if (flag === '--report') options.report = true
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
      console.log(
        '用法：node scripts/index-tts/verify-allowlist.mjs [--platform <key>] [--report]\n' +
          '  校验 externals/ai/index-tts/runtime/<platform>/ 下每个运行时文件是否都在应用白名单中\n' +
          '  --report  只输出摘要与白名单片段（供 CI 汇总），不因未白名单而失败'
      )
      process.exit(0)
    }
    const result = await verifyAllowlist(options)
    if (options.report) {
      console.log(formatReport(result))
      process.exit(0)
    }
    console.log(`[index-tts] runtime directory ${result.directory}`)
    for (const asset of result.assets) {
      console.log(`[index-tts]   ${asset.allowed ? 'ok  ' : 'MISS'} ${asset.name} ${asset.digest}`)
    }
    if (!result.ok) {
      console.error(
        `[index-tts] 有运行时资产不在应用白名单中（${result.platform}）。请确认 ${ALLOWLIST_FILE} 包含：\n${formatReport(result)}`
      )
      process.exit(1)
    }
    console.log('[index-tts] every runtime asset is allowlisted')
  } catch (error) {
    console.error(`[index-tts] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
