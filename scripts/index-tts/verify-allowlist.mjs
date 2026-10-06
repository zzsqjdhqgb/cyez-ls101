/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Release-time gate for the runtime allowlist.
 *
 * The application only executes a package helper whose SHA-256 is compiled into
 * packages/airouter/src/main/index-tts-runtime.ts. Publishing a package without that digest would ship
 * something the app refuses to run, so this check runs in CI before packaging and prints the exact line
 * to add when the digest is missing.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
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

export async function verifyAllowlist(options = {}) {
  const root = options.root ?? defaultRoot
  const platform = options.platform ?? `${process.platform}-${process.arch}`
  const helperName =
    options.helperName ?? `ls101-index-tts-helper-cuda${platform.startsWith('win32') ? '.exe' : ''}`
  const helperPath =
    options.helperPath ?? path.join(root, 'externals/ai/index-tts/runtime', platform, helperName)

  const info = await stat(helperPath).catch(() => null)
  if (!info?.isFile()) throw new Error(`缺少 IndexTTS 运行时：${helperPath}`)
  const digest = await sha256File(helperPath)

  const allowlistSource = await readFile(
    options.allowlistPath ?? path.join(root, ALLOWLIST_FILE),
    'utf8'
  )
  const allowlist = parseAllowlist(allowlistSource)
  const allowed = allowlist[platform.toLowerCase()] ?? []
  return { helperPath, digest, size: info.size, platform, allowed, ok: allowed.includes(digest) }
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
    if (flag === '--platform') options.platform = argv[++index]
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
      console.log('用法：node scripts/index-tts/verify-allowlist.mjs [--platform <key>]')
      process.exit(0)
    }
    const result = await verifyAllowlist(options)
    console.log(`[index-tts] helper ${result.helperPath} (${result.size} B)`)
    console.log(`[index-tts] sha256 ${result.digest}`)
    if (!result.ok) {
      console.error(
        `[index-tts] 该摘要不在应用白名单中（${result.platform}）。请把它加入 ${ALLOWLIST_FILE}：\n` +
          `  '${result.platform}': [\n    '${result.digest}'\n  ]\n` +
          '然后提交并重新运行本工作流；未经白名单的运行时会被应用拒绝执行。'
      )
      process.exit(1)
    }
    console.log('[index-tts] runtime digest is allowlisted')
  } catch (error) {
    console.error(`[index-tts] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
