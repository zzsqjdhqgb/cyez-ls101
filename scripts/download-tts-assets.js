/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createWriteStream, existsSync, mkdirSync } = require('node:fs')
const { join, dirname } = require('node:path')

const isTTY = process.stdout.isTTY

const BASE_URL = 'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/resolve/main'
const ASSETS_DIR = join(process.cwd(), 'assets')
const FILES = [
  'tokenizer.model',
  'tts_b6369a24.safetensors',
  ...['alba', 'marius', 'javert', 'fantine', 'cosette', 'eponine', 'azelma'].map(
    (v) => `embeddings_v2/${v}.safetensors`
  )
]

async function download(url, dest, label) {
  if (isTTY) process.stdout.write(`${label} `)
  else console.log(`${label}...`)

  mkdirSync(dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  const total = parseInt(res.headers.get('content-length') || '0', 10)
  let received = 0
  const reader = res.body.getReader()
  const writeStream = createWriteStream(dest)
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    writeStream.write(value)
    received += value.length
    if (isTTY && total > 0) {
      process.stdout.write(`\r${label} ${Math.round((received / total) * 100)}%`)
    }
  }
  writeStream.end()
  if (isTTY) process.stdout.write(`\r${label} done\n`)
}

;(async () => {
  const prefix = '[tts]'
  let cached = 0
  let downloaded = 0

  for (const file of FILES) {
    const dest = join(ASSETS_DIR, file)
    if (existsSync(dest)) {
      cached++
      continue
    }
    await download(`${BASE_URL}/${file}`, dest, `${prefix} ${file}`)
    downloaded++
  }

  const parts = []
  if (cached) parts.push(`${cached} cached`)
  if (downloaded) parts.push(`${downloaded} downloaded`)
  if (downloaded === 0 && cached > 0) {
    console.log(`${prefix} all ${cached} files cached`)
  } else {
    console.log(`${prefix} ${parts.join(', ')}`)
  }
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
