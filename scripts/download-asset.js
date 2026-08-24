/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createWriteStream } = require('node:fs')
const { once } = require('node:events')
const { finished } = require('node:stream/promises')
const { dirname } = require('node:path')
const { lstat, mkdir, rename, rm } = require('node:fs/promises')
const { assertAssetFile } = require('./asset-integrity.js')

const isTTY = process.stdout.isTTY

async function downloadVerifiedAsset(asset, destination, label, options = {}) {
  await mkdir(dirname(destination), { recursive: true })

  const existing = await lstat(destination).catch(() => null)
  if (existing) {
    try {
      await assertAssetFile(destination, asset)
      console.log(`${label} verified (${asset.sha256})`)
      return { downloaded: false, path: destination }
    } catch (error) {
      console.warn(`${label} cached file is invalid: ${error.message}`)
      await rm(destination, { recursive: true, force: true })
    }
  }

  const partialPath = `${destination}.part`
  let partial = await lstat(partialPath).catch(() => null)
  if (partial && (!partial.isFile() || partial.isSymbolicLink())) {
    await rm(partialPath, { recursive: true, force: true })
    partial = null
  }
  let offset = partial?.size ?? 0
  if (offset > asset.size) {
    console.warn(`${label} partial file is too large; restarting download`)
    await rm(partialPath, { force: true })
    offset = 0
  }

  if (offset === asset.size) {
    try {
      await assertAssetFile(partialPath, asset)
      await rename(partialPath, destination)
      console.log(`${label} verified (${asset.sha256})`)
      return { downloaded: true, path: destination }
    } catch (error) {
      console.warn(`${label} completed partial file is invalid: ${error.message}`)
      await rm(partialPath, { force: true })
      offset = 0
    }
  }

  const requestHeaders = {
    ...(typeof options.headers === 'function' ? options.headers(offset) : options.headers),
    ...(offset > 0 ? { Range: `bytes=${offset}-` } : {})
  }
  if (offset > 0) console.log(`${label} resuming at ${formatBytes(offset)}...`)
  else console.log(`${label} downloading ${formatBytes(asset.size)}...`)

  const fetchImplementation = options.fetch ?? fetch
  const response = await fetchImplementation(asset.url, { headers: requestHeaders })
  if (!response.ok) throw new Error(`下载失败：${asset.url}（HTTP ${response.status}）`)
  if (!response.body) throw new Error(`下载响应没有内容：${asset.url}`)

  const append = offset > 0 && response.status === 206
  if (offset > 0 && !append) {
    console.warn(`${label} server did not accept the range request; restarting download`)
    await rm(partialPath, { force: true })
    offset = 0
  }
  if (response.status === 206) {
    validateContentRange(response.headers.get('content-range'), offset, asset.size)
  }

  const output = createWriteStream(partialPath, { flags: append ? 'a' : 'w' })
  const outputFinished = finished(output)
  const reportProgress = createProgressReporter(label, asset.size)
  let received = offset
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!output.write(value)) await once(output, 'drain')
      received += value.byteLength
      reportProgress(received)
    }
    output.end()
    await outputFinished
  } catch (error) {
    output.destroy()
    await outputFinished.catch(() => undefined)
    throw error
  }
  if (isTTY) process.stdout.write('\n')

  try {
    await assertAssetFile(partialPath, asset)
  } catch (error) {
    await rm(partialPath, { force: true })
    throw error
  }
  await rename(partialPath, destination)
  console.log(`${label} verified (${asset.sha256})`)
  return { downloaded: true, path: destination }
}

function validateContentRange(value, offset, total) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '')
  if (
    !match ||
    Number(match[1]) !== offset ||
    Number(match[2]) !== total - 1 ||
    Number(match[3]) !== total
  ) {
    throw new Error(`断点续传响应无效：${value || '缺少 Content-Range'}`)
  }
}

function createProgressReporter(label, total) {
  let lastPercent = -1
  return (received) => {
    if (!isTTY || total <= 0) return
    const percent = Math.min(100, Math.floor((received / total) * 100))
    if (percent === lastPercent && received < total) return
    lastPercent = percent
    process.stdout.write(`\r${label} ${percent}% (${formatBytes(received)}/${formatBytes(total)})`)
  }
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

module.exports = { downloadVerifiedAsset, formatBytes, validateContentRange }
