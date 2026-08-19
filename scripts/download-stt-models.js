/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} = require('node:fs')
const { once } = require('node:events')
const { finished } = require('node:stream/promises')
const { basename, dirname, join } = require('node:path')

const isTTY = process.stdout.isTTY
const ROOT_DIR = process.cwd()
const STT_DIR = join(ROOT_DIR, 'externals', 'ai', 'stt', 'model')
const DOWNLOAD_DIR = join(ROOT_DIR, 'externals', 'ai', 'stt', 'downloads')
const RELEASE_BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const MODEL_DIRECTORY = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'
const MODEL_MARKER = '.source-verification.json'
const MANIFEST_PATH = join(__dirname, 'stt-model-assets.json')
const PINNED_MANIFEST = readManifest()
const ASSETS = PINNED_MANIFEST.assets
const REQUIRED_MODEL_FILES = PINNED_MANIFEST.modelFiles

class MetadataMismatchError extends Error {}

function readManifest() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 STT 模型摘要清单：${error.message}`)
  }
  validateManifest(manifest)
  return manifest
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('STT 模型摘要清单版本无效')
  if (!isHttpUrl(manifest.sources?.githubReleaseApi)) throw new Error('GitHub API 地址无效')
  if (!isHttpUrl(manifest.sources?.huggingFaceModelApi))
    throw new Error('Hugging Face API 地址无效')
  for (const key of ['vad', 'qwen3Archive']) validateFileMetadata(manifest.assets?.[key], key)
  if (!Array.isArray(manifest.modelFiles) || manifest.modelFiles.length === 0) {
    throw new Error('STT 模型文件清单为空')
  }
  for (const file of manifest.modelFiles) validateFileMetadata(file, file?.path || 'model file')
}

function validateFileMetadata(file, label) {
  const name = file?.filename || file?.path
  if (typeof name !== 'string' || name.length === 0) throw new Error(`${label} 文件名无效`)
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(`${label} 文件大小无效`)
  if (file.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.sha256)) {
    throw new Error(`${label} SHA-256 无效`)
  }
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https:\/\//.test(value)
}

async function fetchOfficialMetadata() {
  const [githubRelease, huggingFaceModel] = await Promise.all([
    fetchJson(PINNED_MANIFEST.sources.githubReleaseApi, 'GitHub Release API', {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cyez-ls101-stt-model-verifier'
    }),
    fetchJson(PINNED_MANIFEST.sources.huggingFaceModelApi, 'Hugging Face API')
  ])
  return officialMetadataFromResponses(githubRelease, huggingFaceModel)
}

async function fetchJson(url, label, headers) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${label} 请求失败（HTTP ${response.status}）`)
  return response.json()
}

function officialMetadataFromResponses(githubRelease, huggingFaceModel) {
  const githubAssets = Array.isArray(githubRelease?.assets) ? githubRelease.assets : []
  const huggingFaceFiles = Array.isArray(huggingFaceModel?.siblings)
    ? huggingFaceModel.siblings
    : []
  const assets = Object.fromEntries(
    Object.entries(ASSETS).map(([key, pinned]) => {
      const upstream = githubAssets.find((asset) => asset.name === pinned.filename)
      if (!upstream) throw new Error(`GitHub Release 缺少资产：${pinned.filename}`)
      const digest = /^sha256:([a-f0-9]{64})$/.exec(upstream.digest || '')
      if (!digest) throw new Error(`GitHub Release 未提供 SHA-256：${pinned.filename}`)
      return [key, { filename: upstream.name, size: upstream.size, sha256: digest[1] }]
    })
  )
  const modelFiles = REQUIRED_MODEL_FILES.map((pinned) => {
    const upstream = huggingFaceFiles.find((file) => file.rfilename === pinned.path)
    if (!upstream) throw new Error(`Hugging Face 模型缺少文件：${pinned.path}`)
    const file = { path: upstream.rfilename, size: upstream.size }
    if (pinned.sha256) {
      if (!/^[a-f0-9]{64}$/.test(upstream.lfs?.sha256 || '')) {
        throw new Error(`Hugging Face 未提供 LFS SHA-256：${pinned.path}`)
      }
      file.sha256 = upstream.lfs.sha256
    }
    return file
  })
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: { ...PINNED_MANIFEST.sources },
    assets,
    modelFiles
  }
  validateManifest(manifest)
  return manifest
}

function assertMetadataMatches(pinned, official) {
  const differences = []
  for (const key of Object.keys(pinned.assets)) {
    compareFileMetadata(`assets.${key}`, pinned.assets[key], official.assets[key], differences)
  }
  for (const expected of pinned.modelFiles) {
    const actual = official.modelFiles.find((file) => file.path === expected.path)
    compareFileMetadata(`modelFiles.${expected.path}`, expected, actual, differences)
  }
  if (differences.length > 0) {
    throw new MetadataMismatchError(
      `官方 STT 模型元数据与固定清单不一致：\n- ${differences.join(
        '\n- '
      )}\n请审查上游变更后显式运行 node scripts/download-stt-models.js --refresh-metadata`
    )
  }
}

function compareFileMetadata(label, expected, actual, differences) {
  if (!actual) {
    differences.push(`${label} 缺失`)
    return
  }
  for (const property of ['filename', 'path', 'size', 'sha256']) {
    if (expected[property] !== actual[property]) {
      differences.push(`${label}.${property}: ${expected[property]} -> ${actual[property]}`)
    }
  }
}

function writeManifest(manifest) {
  const temporaryPath = `${MANIFEST_PATH}.${process.pid}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`)
    renameSync(temporaryPath, MANIFEST_PATH)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function assetUrl(asset) {
  return asset.url || `${RELEASE_BASE_URL}/${asset.filename}`
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function verifyFile(path, expected, options = {}) {
  if (!existsSync(path)) throw new Error(`文件不存在：${path}`)
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`不是普通文件：${path}`)
  if (stat.size !== expected.size) {
    throw new Error(`文件大小不匹配：${path}（应为 ${expected.size}，实际为 ${stat.size}）`)
  }
  if (expected.sha256 && options.hash !== false) {
    const actual = await sha256File(path)
    if (actual !== expected.sha256) {
      throw new Error(`SHA-256 不匹配：${path}（应为 ${expected.sha256}，实际为 ${actual}）`)
    }
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

async function downloadVerifiedAsset(asset, destination, label) {
  mkdirSync(dirname(destination), { recursive: true })

  if (existsSync(destination)) {
    try {
      await verifyFile(destination, asset)
      console.log(`${label} verified (${asset.sha256})`)
      return { downloaded: false, path: destination }
    } catch (error) {
      console.warn(`${label} cached file is invalid: ${error.message}`)
      unlinkSync(destination)
    }
  }

  const partialPath = `${destination}.part`
  let offset = existsSync(partialPath) ? statSync(partialPath).size : 0
  if (offset > asset.size) {
    console.warn(`${label} partial file is too large; restarting download`)
    unlinkSync(partialPath)
    offset = 0
  }

  if (offset === asset.size) {
    try {
      await verifyFile(partialPath, asset)
      renameSync(partialPath, destination)
      console.log(`${label} verified (${asset.sha256})`)
      return { downloaded: true, path: destination }
    } catch (error) {
      console.warn(`${label} completed partial file is invalid: ${error.message}`)
      unlinkSync(partialPath)
      offset = 0
    }
  }

  const headers = offset > 0 ? { Range: `bytes=${offset}-` } : undefined
  if (offset > 0) console.log(`${label} resuming at ${formatBytes(offset)}...`)
  else console.log(`${label} downloading ${formatBytes(asset.size)}...`)

  const response = await fetch(assetUrl(asset), { headers })
  if (!response.ok) throw new Error(`下载失败：${assetUrl(asset)}（HTTP ${response.status}）`)
  if (!response.body) throw new Error(`下载响应没有内容：${assetUrl(asset)}`)

  const append = offset > 0 && response.status === 206
  if (offset > 0 && !append) {
    console.warn(`${label} server did not accept the range request; restarting download`)
    unlinkSync(partialPath)
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
    await verifyFile(partialPath, asset)
  } catch (error) {
    unlinkSync(partialPath)
    throw error
  }
  renameSync(partialPath, destination)
  console.log(`${label} verified (${asset.sha256})`)
  return { downloaded: true, path: destination }
}

function validateContentRange(value, offset, total) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '')
  if (!match || Number(match[1]) !== offset || Number(match[3]) !== total) {
    throw new Error(`断点续传响应无效：${value || '缺少 Content-Range'}`)
  }
}

function cleanupExtractedDir(dir) {
  for (const name of ['test_wavs']) {
    const path = join(dir, name)
    if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  }
  for (const name of ['encoder.onnx', 'decoder.onnx']) {
    const path = join(dir, name)
    if (existsSync(path)) unlinkSync(path)
  }
}

async function verifyExtractedModel(dir, options = {}) {
  for (const file of REQUIRED_MODEL_FILES) {
    await verifyFile(join(dir, file.path), file, { hash: options.hash === true })
  }
}

function hasVerificationMarker(dir) {
  const path = join(dir, MODEL_MARKER)
  if (!existsSync(path)) return false
  try {
    const marker = JSON.parse(readFileSync(path, 'utf8'))
    return (
      marker.schemaVersion === 1 &&
      marker.archive === ASSETS.qwen3Archive.filename &&
      marker.archiveSha256 === ASSETS.qwen3Archive.sha256
    )
  } catch {
    return false
  }
}

function writeVerificationMarker(dir) {
  writeFileSync(
    join(dir, MODEL_MARKER),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        archive: ASSETS.qwen3Archive.filename,
        archiveSha256: ASSETS.qwen3Archive.sha256,
        verifiedFiles: REQUIRED_MODEL_FILES.filter((file) => file.sha256).map((file) => ({
          path: file.path,
          sha256: file.sha256
        }))
      },
      null,
      2
    )}\n`
  )
}

async function modelIsValid(dir, fullHashVerification) {
  if (!hasVerificationMarker(dir)) return false
  try {
    await verifyExtractedModel(dir, { hash: fullHashVerification })
    return true
  } catch (error) {
    console.warn(`[stt] installed Qwen3 ASR model is invalid: ${error.message}`)
    return false
  }
}

async function extractVerifiedModel(archivePath, destination) {
  const extractionRoot = join(STT_DIR, `.extract-${MODEL_DIRECTORY}-${process.pid}`)
  const previousInstallation = `${destination}.previous-${process.pid}`
  rmSync(extractionRoot, { recursive: true, force: true })
  rmSync(previousInstallation, { recursive: true, force: true })
  mkdirSync(extractionRoot, { recursive: true })
  try {
    console.log(`[stt] extracting ${basename(archivePath)}...`)
    execFileSync('tar', ['-xjf', archivePath, '-C', extractionRoot], { stdio: 'inherit' })
    const candidate = join(extractionRoot, MODEL_DIRECTORY)
    cleanupExtractedDir(candidate)
    console.log('[stt] verifying extracted Qwen3 ASR files...')
    await verifyExtractedModel(candidate, { hash: true })
    writeVerificationMarker(candidate)

    // Keep the current installation recoverable until the verified replacement is in place.
    if (existsSync(destination)) {
      try {
        renameSync(destination, previousInstallation)
      } catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error
        console.warn('[stt] cannot preserve the invalid previous model directory; removing it')
        rmSync(destination, { recursive: true, force: true })
      }
    }
    try {
      renameSync(candidate, destination)
      rmSync(previousInstallation, { recursive: true, force: true })
    } catch (error) {
      if (existsSync(previousInstallation) && !existsSync(destination)) {
        renameSync(previousInstallation, destination)
      }
      throw error
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
    rmSync(previousInstallation, { recursive: true, force: true })
  }
}

function parseOptions(argv) {
  const allowed = new Set(['--verify', '--refresh-metadata'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  const verify = argv.includes('--verify')
  const refreshMetadata = argv.includes('--refresh-metadata')
  if (verify && refreshMetadata) throw new Error('--verify 不能与 --refresh-metadata 同时使用')
  return { verify, refreshMetadata }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  if (options.refreshMetadata) {
    const official = await fetchOfficialMetadata()
    writeManifest(official)
    console.log(`[stt] refreshed pinned metadata: ${MANIFEST_PATH}`)
    console.log('[stt] review the manifest diff before committing it')
    return
  }

  try {
    const official = await fetchOfficialMetadata()
    assertMetadataMatches(PINNED_MANIFEST, official)
    console.log('[stt] official API metadata matches the pinned manifest')
  } catch (error) {
    if (error instanceof MetadataMismatchError) throw error
    console.warn(`[stt] official metadata unavailable; using pinned manifest: ${error.message}`)
  }
  mkdirSync(STT_DIR, { recursive: true })

  const vad = await downloadVerifiedAsset(
    ASSETS.vad,
    join(STT_DIR, ASSETS.vad.filename),
    '[stt] silero_vad'
  )
  const archive = await downloadVerifiedAsset(
    ASSETS.qwen3Archive,
    join(DOWNLOAD_DIR, ASSETS.qwen3Archive.filename),
    '[stt] qwen3-asr-0.6B archive'
  )

  const modelDir = join(STT_DIR, MODEL_DIRECTORY)
  const installed = await modelIsValid(modelDir, options.verify)
  if (installed) {
    console.log(`[stt] Qwen3 ASR model verified${options.verify ? ' with full hashes' : ''}`)
  } else {
    await extractVerifiedModel(archive.path, modelDir)
    console.log('[stt] Qwen3 ASR model installed and verified')
  }

  const downloaded = Number(vad.downloaded) + Number(archive.downloaded)
  console.log(
    downloaded === 0
      ? '[stt] all assets cached and verified'
      : `[stt] ${downloaded} asset${downloaded === 1 ? '' : 's'} downloaded and verified`
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  ASSETS,
  PINNED_MANIFEST,
  REQUIRED_MODEL_FILES,
  assertMetadataMatches,
  downloadVerifiedAsset,
  fetchOfficialMetadata,
  modelIsValid,
  officialMetadataFromResponses,
  parseOptions,
  sha256File,
  validateContentRange,
  verifyFile
}
