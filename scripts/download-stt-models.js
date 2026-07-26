/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createWriteStream, existsSync, mkdirSync, rmSync, unlinkSync } = require('node:fs')
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
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      const ok = writeStream.write(chunk)
      if (ok) {
        resolve()
        return
      }
      const onDrain = () => {
        cleanup()
        resolve()
      }
      const onError = (err) => {
        cleanup()
        reject(err)
      }
      const cleanup = () => {
        writeStream.off('drain', onDrain)
        writeStream.off('error', onError)
      }
      writeStream.once('drain', onDrain)
      writeStream.once('error', onError)
    })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    await write(value)
    received += value.length
    if (isTTY && total > 0) {
      process.stdout.write(`\r${label} ${Math.round((received / total) * 100)}%`)
    }
  }
  await new Promise((resolve, reject) => {
    writeStream.end()
    writeStream.on('finish', resolve)
    writeStream.on('error', reject)
  })
  if (isTTY) process.stdout.write(`\r${label} done\n`)
}

function cleanupExtractedDir(dir) {
  const removeDirs = ['test_wavs']
  const removeFiles = ['encoder.onnx', 'decoder.onnx']

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

  const qwen3AsrDir = join(STT_DIR, 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
  if (existsSync(qwen3AsrDir)) {
    cached++
  } else {
    const tarPath = join(STT_DIR, 'qwen3-asr-0.6B-int8.tar.bz2')
    await download(
      `${BASE_URL}/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2`,
      tarPath,
      `${prefix} qwen3-asr-0.6B`
    )
    downloaded++
    console.log(' extracting...')
    const { execSync } = require('node:child_process')
    execSync(`tar -xjf "${tarPath}" -C "${STT_DIR}"`)
    unlinkSync(tarPath)

    console.log(`${prefix} cleaning up non-quantized models and test wavs...`)
    cleanupExtractedDir(qwen3AsrDir)
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
