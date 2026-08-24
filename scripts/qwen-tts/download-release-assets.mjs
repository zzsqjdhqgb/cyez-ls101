/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assetIntegrity from '../asset-integrity.js'
import assetDownload from '../download-asset.js'

const { assertAssetFile, ensureAssetSet, ensureManagedDirectory } = assetIntegrity
const { downloadVerifiedAsset } = assetDownload
const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()
const defaultExternalRoot = path.join(root, 'externals', 'ai', 'qwen3-tts')
const defaultStateDirectory = path.join(root, 'externals', 'ai', '.setup-verification')

export function loadConfig() {
  return JSON.parse(readFileSync(path.join(root, 'scripts', 'qwen-tts', 'assets.json'), 'utf8'))
}

export function runtimeTarget(platform = process.platform, architecture = process.arch) {
  if (architecture !== 'x64') return null
  if (platform === 'linux') {
    return {
      directory: 'linux-x64',
      dependencies: [],
      licenses: [],
      helpers: {
        cpu: {
          name: 'ls101-qwen-tts-helper-cpu-linux-x64',
          executable: 'ls101-qwen-tts-helper-cpu'
        }
      }
    }
  }
  if (platform === 'win32') {
    return {
      directory: 'win32-x64',
      dependencies: [],
      licenses: [],
      helpers: {
        cpu: {
          name: 'ls101-qwen-tts-helper-cpu-win32-x64.exe',
          executable: 'ls101-qwen-tts-helper-cpu.exe'
        }
      }
    }
  }
  return null
}

export function disabledCudaRuntimeFiles(platform = process.platform) {
  if (platform === 'linux') return ['ls101-qwen-tts-helper-cuda']
  if (platform === 'win32') {
    return [
      'ls101-qwen-tts-helper-cuda.exe',
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'nvJitLink_120_0.dll',
      'LICENSE.NVIDIA-CUDA.html'
    ]
  }
  return []
}

export async function cleanupDisabledCudaRuntimeFiles(
  runtimeDirectory,
  platform = process.platform
) {
  for (const file of disabledCudaRuntimeFiles(platform)) {
    await rm(path.join(runtimeDirectory, file), { force: true }).catch((error) => {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    })
  }
}

export async function cleanupStagedCudaRuntimes(runtimeRoot) {
  await Promise.all([
    cleanupDisabledCudaRuntimeFiles(path.join(runtimeRoot, 'linux-x64'), 'linux'),
    cleanupDisabledCudaRuntimeFiles(path.join(runtimeRoot, 'win32-x64'), 'win32')
  ])
}

export function modelAssetNames() {
  return {
    talker: `qwen3-tts-0.6b-${config.model.quantization}.gguf`,
    tokenizer: 'qwen3-tts-tokenizer-f16.gguf'
  }
}

export function downloadMode(environment = process.env) {
  if (environment.LS101_SKIP_QWEN_TTS_DOWNLOAD === '1') return 'skip'
  if (environment.LS101_QWEN_TTS_RUNTIME_ONLY === '1') return 'runtime-only'
  return 'all'
}

export function parseOptions(argv) {
  const allowed = new Set(['--verify', '--verify-upstream'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  return {
    verify: argv.includes('--verify'),
    verifyUpstream: argv.includes('--verify-upstream')
  }
}

export function selectRuntimeReleaseAssets(release, target = runtimeTarget()) {
  validateRelease(release, config.runtimeRelease)
  const assets = Array.isArray(release.assets) ? release.assets : []
  if (!target) throw new Error('当前平台没有 Qwen TTS 原生运行时')
  return {
    helpers: Object.fromEntries(
      Object.entries(target.helpers).map(([backend, helper]) => [
        backend,
        findReleaseAsset(assets, helper.name)
      ])
    ),
    dependencies: target.dependencies.map((dependency) =>
      findReleaseAsset(assets, dependency.name)
    ),
    licenses: target.licenses.map((license) => findReleaseAsset(assets, license.name)),
    manifest: findReleaseAsset(assets, 'qwen-tts-runtime-manifest.json')
  }
}

export function selectModelReleaseAssets(release) {
  validateRelease(release, config.modelRelease)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const modelNames = modelAssetNames()
  return {
    models: {
      talker: findReleaseAsset(assets, modelNames.talker),
      tokenizer: findReleaseAsset(assets, modelNames.tokenizer)
    },
    manifest: findReleaseAsset(assets, 'qwen-tts-model-manifest.json')
  }
}

export function pinnedRuntimeReleaseAssets(target = runtimeTarget()) {
  if (!target) throw new Error('当前平台没有 Qwen TTS 原生运行时')
  return {
    helpers: Object.fromEntries(
      Object.entries(target.helpers).map(([backend, helper]) => [
        backend,
        findPinnedAsset(config.runtimeRelease, helper.name)
      ])
    ),
    dependencies: target.dependencies.map((dependency) =>
      findPinnedAsset(config.runtimeRelease, dependency.name)
    ),
    licenses: target.licenses.map((license) =>
      findPinnedAsset(config.runtimeRelease, license.name)
    ),
    manifest: findPinnedAsset(config.runtimeRelease, 'qwen-tts-runtime-manifest.json')
  }
}

export function pinnedModelReleaseAssets() {
  const modelNames = modelAssetNames()
  return {
    models: {
      talker: findPinnedAsset(config.modelRelease, modelNames.talker),
      tokenizer: findPinnedAsset(config.modelRelease, modelNames.tokenizer)
    },
    manifest: findPinnedAsset(config.modelRelease, 'qwen-tts-model-manifest.json')
  }
}

function validateRelease(release, expected) {
  if (
    !release ||
    release.tag_name !== expected.tag ||
    release.draft ||
    release.prerelease !== expected.prerelease
  ) {
    throw new Error(`Qwen TTS Release 无效：${expected.tag}`)
  }
}

function findReleaseAsset(assets, name) {
  const asset = assets.find((candidate) => candidate?.name === name)
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Qwen TTS Release 缺少有效资产：${name}`)
  }
  if (
    typeof asset.browser_download_url !== 'string' ||
    !asset.browser_download_url.startsWith('https://')
  ) {
    throw new Error(`Qwen TTS Release 资产下载地址无效：${name}`)
  }
  const digest = typeof asset.digest === 'string' ? asset.digest : ''
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`Qwen TTS Release 资产缺少 SHA-256 digest：${name}`)
  }
  return {
    name,
    size: asset.size,
    digest: digest.slice('sha256:'.length),
    url: asset.browser_download_url
  }
}

function findPinnedAsset(release, name) {
  const assets = Array.isArray(release.assets) ? release.assets : []
  const asset = assets.find((candidate) => candidate?.name === name)
  if (
    !asset ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
  ) {
    throw new Error(`Qwen TTS 固定资产无效：${name}`)
  }
  return {
    name,
    size: asset.size,
    digest: asset.sha256,
    url: `https://github.com/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(name)}`
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok) throw new Error(`Qwen TTS Release API 请求失败（HTTP ${response.status}）`)
  return response.json()
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'cyez-ls101-qwen-tts',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

function githubDownloadHeaders() {
  return { ...githubHeaders(), accept: 'application/octet-stream' }
}

async function verifyUpstreamMetadata(target, downloadDirectory, boundary) {
  const [runtimeRelease, modelRelease] = await Promise.all([
    fetchRelease(config.runtimeRelease),
    fetchRelease(config.modelRelease)
  ])
  assertSelectedAssetsMatch(
    selectRuntimeReleaseAssets(runtimeRelease, target),
    pinnedRuntimeReleaseAssets(target),
    'runtime'
  )
  assertSelectedAssetsMatch(
    selectModelReleaseAssets(modelRelease),
    pinnedModelReleaseAssets(),
    'model'
  )
  await ensureManagedDirectory(downloadDirectory, boundary)
  await Promise.all([
    writeMetadataCache(path.join(downloadDirectory, 'runtime-release-api.json'), runtimeRelease),
    writeMetadataCache(path.join(downloadDirectory, 'model-release-api.json'), modelRelease)
  ])
}

async function writeMetadataCache(filename, value) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    })
    await rm(filename, { recursive: true, force: true })
    await rename(temporary, filename)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function fetchRelease(release) {
  return fetchJson(
    `https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`
  )
}

function assertSelectedAssetsMatch(actual, expected, label) {
  const actualAssets = flattenSelectedAssets(actual)
  const expectedAssets = flattenSelectedAssets(expected)
  if (actualAssets.length !== expectedAssets.length) {
    throw new Error(`Qwen TTS ${label} Release 资产数量与固定清单不一致`)
  }
  for (const pinned of expectedAssets) {
    const upstream = actualAssets.find((asset) => asset.name === pinned.name)
    if (
      !upstream ||
      upstream.size !== pinned.size ||
      upstream.digest !== pinned.digest ||
      upstream.url !== pinned.url
    ) {
      throw new Error(`Qwen TTS ${label} Release 资产与固定清单不一致：${pinned.name}`)
    }
  }
}

function flattenSelectedAssets(selected) {
  return [
    ...Object.values(selected.helpers ?? {}),
    ...Object.values(selected.models ?? {}),
    ...(selected.dependencies ?? []),
    ...(selected.licenses ?? []),
    selected.manifest
  ].filter(Boolean)
}

function managedAsset(asset, assetPath, mode) {
  return {
    path: assetPath,
    size: asset.size,
    sha256: asset.digest,
    url: asset.url,
    name: asset.name,
    ...(mode === undefined ? {} : { mode })
  }
}

async function ensureDownloadedAssets({
  assets,
  boundary,
  exact,
  forceHash,
  root: assetRoot,
  statePath
}) {
  return ensureAssetSet({
    boundary,
    root: assetRoot,
    statePath,
    assets,
    exact,
    forceHash,
    repair: (asset, destination) =>
      downloadVerifiedAsset(asset, destination, `[qwen-tts] ${asset.name}`, {
        headers: githubDownloadHeaders
      })
  })
}

export async function copyVerifiedAsset(source, destination, asset) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.part`
  try {
    await copyFile(source, temporary)
    if (asset.mode !== undefined) await chmod(temporary, asset.mode)
    await assertAssetFile(temporary, asset)
    await rm(destination, { recursive: true, force: true })
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export async function main(options = {}) {
  const environment = options.environment ?? process.env
  const mode = downloadMode(environment)
  if (mode === 'skip') {
    console.log('[qwen-tts] download skipped by LS101_SKIP_QWEN_TTS_DOWNLOAD')
    return
  }

  const commandOptions = parseOptions(options.arguments ?? [])
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const target = runtimeTarget(platform, architecture)
  if (!target) {
    console.warn(
      `[qwen-tts] 当前平台 ${platform}/${architecture} 没有已发布的 CPU helper，跳过下载`
    )
    return
  }

  const boundary = options.boundary ?? root
  const externalRoot = options.externalRoot ?? defaultExternalRoot
  const downloadDirectory = options.downloadDirectory ?? path.join(externalRoot, 'downloads')
  const releaseDirectory = path.join(downloadDirectory, 'releases')
  const runtimeRoot = options.runtimeRoot ?? path.join(externalRoot, 'runtime')
  const runtimeDirectory = path.join(runtimeRoot, target.directory)
  const modelDirectory = options.modelDirectory ?? path.join(externalRoot, 'models')
  const stateDirectory = options.stateDirectory ?? defaultStateDirectory

  if (commandOptions.verifyUpstream) {
    await verifyUpstreamMetadata(target, downloadDirectory, boundary)
    console.log('[qwen-tts] official release metadata matches the pinned manifests')
  }

  const runtimeAssets = pinnedRuntimeReleaseAssets(target)
  const runtimeCacheAssets = flattenSelectedAssets(runtimeAssets).map((asset) =>
    managedAsset(asset, asset.name)
  )
  const runtimeCache = await ensureDownloadedAssets({
    assets: runtimeCacheAssets,
    boundary,
    exact: false,
    forceHash: commandOptions.verify,
    root: releaseDirectory,
    statePath: path.join(stateDirectory, `qwen-tts-runtime-cache-${target.directory}.json`)
  })

  const stagedRuntimeAssets = [
    ...Object.entries(runtimeAssets.helpers).map(([backend, asset]) => {
      const helper = target.helpers[backend]
      return {
        ...managedAsset(asset, helper.executable, platform === 'win32' ? undefined : 0o755),
        source: path.join(releaseDirectory, asset.name)
      }
    }),
    ...[...runtimeAssets.dependencies, ...runtimeAssets.licenses].map((asset) => {
      const targetFile = [...target.dependencies, ...target.licenses].find(
        (candidate) => candidate.name === asset.name
      )
      if (!targetFile) throw new Error(`Qwen TTS Release 缺少运行时文件：${asset.name}`)
      return {
        ...managedAsset(asset, targetFile.file),
        source: path.join(releaseDirectory, asset.name)
      }
    })
  ]
  const stagedRuntime = await ensureAssetSet({
    boundary,
    root: runtimeDirectory,
    statePath: path.join(stateDirectory, `qwen-tts-runtime-${target.directory}.json`),
    assets: stagedRuntimeAssets,
    exact: true,
    forceHash: commandOptions.verify,
    repair: (asset, destination) => copyVerifiedAsset(asset.source, destination, asset)
  })
  await cleanupStagedCudaRuntimes(runtimeRoot)
  logAssetSet('runtime cache', runtimeCache)
  logAssetSet('staged runtime', stagedRuntime)

  if (mode === 'runtime-only') {
    console.log('[qwen-tts] model verification skipped in runtime-only mode')
    return
  }

  const modelAssets = pinnedModelReleaseAssets()
  const modelFiles = Object.values(modelAssets.models).map((asset) =>
    managedAsset(asset, asset.name)
  )
  const models = await ensureDownloadedAssets({
    assets: modelFiles,
    boundary,
    exact: true,
    forceHash: commandOptions.verify,
    root: modelDirectory,
    statePath: path.join(stateDirectory, 'qwen-tts-models.json')
  })
  const modelManifest = await ensureDownloadedAssets({
    assets: [managedAsset(modelAssets.manifest, modelAssets.manifest.name)],
    boundary,
    exact: false,
    forceHash: commandOptions.verify,
    root: releaseDirectory,
    statePath: path.join(stateDirectory, 'qwen-tts-model-manifest.json')
  })
  logAssetSet('models', models)
  logAssetSet('model manifest', modelManifest)
}

function logAssetSet(label, result) {
  if (result.method === 'fast') console.log(`[qwen-tts] ${label} quickly verified`)
  else if (result.repaired > 0) console.log(`[qwen-tts] ${label}: ${result.repaired} restored`)
  else console.log(`[qwen-tts] ${label} fully verified`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main({ arguments: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
