/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createWriteStream, existsSync, mkdirSync, rmSync, unlinkSync } = require('node:fs')
const { readFile, writeFile } = require('node:fs/promises')
const { join, dirname } = require('node:path')

const isTTY = process.stdout.isTTY

const BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const STT_DIR = join(process.cwd(), 'assets', 'stt')

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

function cleanupExtractedDir(dir) {
  const removeDirs = ['test_wavs']
  const removeFiles = ['small.en-encoder.onnx', 'small.en-decoder.onnx']

  for (const name of removeDirs) {
    const p = join(dir, name)
    if (existsSync(p)) rmSync(p, { recursive: true, force: true })
  }
  for (const name of removeFiles) {
    const p = join(dir, name)
    if (existsSync(p)) unlinkSync(p)
  }
}

;(async () => {
  const prefix = '[stt]'
  let cached = 0
  let downloaded = 0

  const vadDest = join(STT_DIR, 'silero_vad.onnx')
  if (existsSync(vadDest)) {
    cached++
  } else {
    await download(`${BASE_URL}/silero_vad.onnx`, vadDest, `${prefix} silero_vad`)
    downloaded++
  }

  const whisperDir = join(STT_DIR, 'sherpa-onnx-whisper-small.en')
  if (existsSync(whisperDir)) {
    cached++
  } else {
    const tarPath = join(STT_DIR, 'whisper-small.en.tar.bz2')
    await download(
      `${BASE_URL}/sherpa-onnx-whisper-small.en.tar.bz2`,
      tarPath,
      `${prefix} whisper-small.en`
    )
    downloaded++
    process.stdout.write(`${prefix} extracting...`)
    const { extract } = await import('archive-wasm')
    const fileData = await readFile(tarPath)
    for (const entry of extract(fileData)) {
      const targetPath = join(STT_DIR, entry.path)
      if (entry.type === 'DIRECTORY') {
        mkdirSync(targetPath, { recursive: true })
      } else if (entry.type === 'FILE') {
        mkdirSync(dirname(targetPath), { recursive: true })
        await writeFile(targetPath, Buffer.from(entry.data))
      }
    }
    unlinkSync(tarPath)
    console.log(' done')

    console.log(`${prefix} cleaning up non-quantized models and test wavs...`)
    cleanupExtractedDir(whisperDir)
  }

  const parts = []
  if (cached) parts.push(`${cached} cached`)
  if (downloaded) parts.push(`${downloaded} downloaded`)
  if (downloaded === 0 && cached > 0) {
    console.log(`${prefix} all models cached`)
  } else {
    console.log(`${prefix} ${parts.join(', ')}`)
  }
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
