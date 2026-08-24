/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync } = require('node:child_process')
const {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} = require('node:fs')
const { basename, join } = require('node:path')
const {
  assertAssetFile,
  cleanUnexpectedEntries,
  ensureAssetSet,
  recordAssetSetVerification,
  sha256File,
  verifyAssetSet
} = require('./asset-integrity.js')
const { downloadVerifiedAsset, validateContentRange } = require('./download-asset.js')

const ROOT_DIR = join(__dirname, '..')
const STT_ROOT = join(ROOT_DIR, 'externals', 'ai', 'stt')
const STT_DIR = join(ROOT_DIR, 'externals', 'ai', 'stt', 'model')
const DOWNLOAD_DIR = join(ROOT_DIR, 'externals', 'ai', 'stt', 'downloads')
const STATE_DIRECTORY = join(ROOT_DIR, 'externals', 'ai', '.setup-verification')
const RELEASE_BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
const MODEL_DIRECTORY = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'
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
  if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
    throw new Error(`${label} SHA-256 无效`)
  }
  if (file.sourceBlobId !== undefined && !/^[a-f0-9]{40}$/.test(file.sourceBlobId)) {
    throw new Error(`${label} source blob ID 无效`)
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
    const upstreamSha256 = upstream.lfs?.sha256
    const file = { path: upstream.rfilename, size: upstream.size }
    if (upstreamSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(upstreamSha256)) {
        throw new Error(`Hugging Face LFS SHA-256 无效：${pinned.path}`)
      }
      file.sha256 = upstreamSha256
    } else {
      if (!pinned.sourceBlobId || upstream.blobId !== pinned.sourceBlobId) {
        throw new Error(`Hugging Face 普通 Git 资产发生变化：${pinned.path}`)
      }
      file.sha256 = pinned.sha256
      file.sourceBlobId = upstream.blobId
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
  for (const property of ['filename', 'path', 'size', 'sha256', 'sourceBlobId']) {
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

async function verifyFile(path, expected, options = {}) {
  if (!existsSync(path)) throw new Error(`文件不存在：${path}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`不是普通文件：${path}`)
  if (stat.size !== expected.size) {
    throw new Error(`文件大小不匹配：${path}（应为 ${expected.size}，实际为 ${stat.size}）`)
  }
  if (options.hash !== false)
    await assertAssetFile(path, { ...expected, path: expected.path || path })
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
    await verifyFile(join(dir, file.path), file, { hash: options.hash !== false })
  }
}

async function verifyInstalledModel(dir, options = {}) {
  return verifyAssetSet({
    boundary: options.boundary ?? ROOT_DIR,
    root: dir,
    statePath: options.statePath ?? join(STATE_DIRECTORY, 'qwen3-asr-model.json'),
    assets: REQUIRED_MODEL_FILES,
    exact: true,
    forceHash: options.forceHash === true,
    cleanUnexpected: true
  })
}

async function modelIsValid(dir, fullHashVerification = false) {
  const status = await verifyInstalledModel(dir, { forceHash: fullHashVerification })
  return status.valid
}

async function extractVerifiedModel(
  archivePath,
  destination,
  statePath = join(STATE_DIRECTORY, 'qwen3-asr-model.json')
) {
  const extractionRoot = join(STT_DIR, `.extract-${MODEL_DIRECTORY}-${process.pid}`)
  const previousInstallation = `${destination}.previous-${process.pid}`
  rmSync(extractionRoot, { recursive: true, force: true })
  rmSync(previousInstallation, { recursive: true, force: true })
  mkdirSync(extractionRoot, { recursive: true })
  let discardPreviousInstallation = false
  try {
    console.log(`[stt] extracting ${basename(archivePath)}...`)
    execFileSync('tar', ['-xjf', archivePath, '-C', extractionRoot], { stdio: 'inherit' })
    const candidate = join(extractionRoot, MODEL_DIRECTORY)
    cleanupExtractedDir(candidate)
    console.log('[stt] verifying extracted Qwen3 ASR files...')
    await verifyExtractedModel(candidate, { hash: true })
    await cleanUnexpectedEntries(candidate, REQUIRED_MODEL_FILES)

    // Keep the current installation recoverable until the verified replacement is in place.
    let preservedPreviousInstallation = false
    if (existsSync(destination)) {
      try {
        renameSync(destination, previousInstallation)
        preservedPreviousInstallation = true
      } catch (error) {
        if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error
        console.warn('[stt] cannot preserve the invalid previous model directory; removing it')
        rmSync(destination, { recursive: true, force: true })
      }
    }
    try {
      renameSync(candidate, destination)
      await recordAssetSetVerification({
        boundary: ROOT_DIR,
        root: destination,
        statePath,
        assets: REQUIRED_MODEL_FILES,
        exact: true
      })
      discardPreviousInstallation = true
      rmSync(previousInstallation, { recursive: true, force: true })
    } catch (error) {
      if (preservedPreviousInstallation && existsSync(previousInstallation)) {
        rmSync(destination, { recursive: true, force: true })
        renameSync(previousInstallation, destination)
        discardPreviousInstallation = true
      }
      throw error
    }
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
    if (discardPreviousInstallation) {
      rmSync(previousInstallation, { recursive: true, force: true })
    }
  }
}

function parseOptions(argv) {
  const allowed = new Set(['--verify', '--verify-upstream', '--refresh-metadata'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  const verify = argv.includes('--verify')
  const verifyUpstream = argv.includes('--verify-upstream')
  const refreshMetadata = argv.includes('--refresh-metadata')
  if ((verify || verifyUpstream) && refreshMetadata) {
    throw new Error('--refresh-metadata 不能与验证参数同时使用')
  }
  return { verify, verifyUpstream, refreshMetadata }
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

  if (options.verifyUpstream) {
    const official = await fetchOfficialMetadata()
    assertMetadataMatches(PINNED_MANIFEST, official)
    console.log('[stt] official API metadata matches the pinned manifest')
  }

  const downloadableAssets = [
    {
      ...ASSETS.vad,
      path: `model/${ASSETS.vad.filename}`,
      url: `${RELEASE_BASE_URL}/${ASSETS.vad.filename}`,
      label: '[stt] silero_vad'
    },
    {
      ...ASSETS.qwen3Archive,
      path: `downloads/${ASSETS.qwen3Archive.filename}`,
      url: `${RELEASE_BASE_URL}/${ASSETS.qwen3Archive.filename}`,
      label: '[stt] qwen3-asr-0.6B archive'
    }
  ]
  const downloads = await ensureAssetSet({
    boundary: ROOT_DIR,
    root: STT_ROOT,
    statePath: join(STATE_DIRECTORY, 'qwen3-asr-downloads.json'),
    assets: downloadableAssets,
    exact: false,
    forceHash: options.verify,
    repair: (asset, destination) => downloadVerifiedAsset(asset, destination, asset.label)
  })

  const modelDir = join(STT_DIR, MODEL_DIRECTORY)
  const modelStatePath = join(STATE_DIRECTORY, 'qwen3-asr-model.json')
  const installed = await verifyInstalledModel(modelDir, {
    forceHash: options.verify,
    statePath: modelStatePath
  })
  if (installed.valid) {
    console.log(
      `[stt] Qwen3 ASR model ${installed.method === 'fast' ? 'quickly' : 'fully'} verified`
    )
  } else {
    await extractVerifiedModel(
      join(DOWNLOAD_DIR, ASSETS.qwen3Archive.filename),
      modelDir,
      modelStatePath
    )
    console.log('[stt] Qwen3 ASR model restored from the verified archive')
  }

  if (downloads.method === 'fast') console.log('[stt] VAD and archive quickly verified')
  else if (downloads.repaired > 0) {
    console.log(
      `[stt] ${downloads.repaired} source asset${downloads.repaired === 1 ? '' : 's'} restored`
    )
  } else console.log('[stt] VAD and archive fully verified')
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
