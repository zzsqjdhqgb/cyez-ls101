/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { randomUUID } from 'node:crypto'
import { createWriteStream, readFileSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import assetIntegrity from '../asset-integrity.js'
import assetDownload from '../download-asset.js'

const { assertAssetFile, ensureAssetSet, ensureManagedDirectory, sha256File } = assetIntegrity
const { downloadVerifiedAsset } = assetDownload
const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()
const defaultExternalRoot = path.join(root, 'externals', 'ai', 'index-tts')
const defaultStateDirectory = path.join(root, 'externals', 'ai', '.setup-verification')
export const MODEL_PART_BYTES = 1073741824
export const MODEL_FILE_NAME = 'index-tts2_5-q8_0.gguf'

export function loadConfig() {
  return JSON.parse(readFileSync(path.join(root, 'scripts', 'index-tts', 'assets.json'), 'utf8'))
}

export function modelPartPlan(totalBytes = config.model.size, partBytes = MODEL_PART_BYTES) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    throw new Error('IndexTTS 模型分片总数必须是正整数')
  }
  if (!Number.isSafeInteger(partBytes) || partBytes <= 0) {
    throw new Error('IndexTTS 模型分片大小必须是正整数')
  }
  const parts = []
  for (let offset = 0; offset < totalBytes; offset += partBytes) {
    parts.push({
      index: parts.length,
      offset,
      size: Math.min(partBytes, totalBytes - offset)
    })
  }
  return parts
}

export function modelPartName(index) {
  return `${MODEL_FILE_NAME}.part-${String(index + 1).padStart(4, '0')}`
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
          name: 'ls101-index-tts-helper-cpu-linux-x64',
          executable: 'ls101-index-tts-helper-cpu'
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
          name: 'ls101-index-tts-helper-cpu-win32-x64.exe',
          executable: 'ls101-index-tts-helper-cpu.exe'
        }
      }
    }
  }
  return null
}

// CUDA artifacts are published for native runtime development only. Setup
// removes them so packaging never ships a CUDA helper or toolkit DLL, and
// `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` keeps locally built ones for development.
export function disabledCudaRuntimePrefixes(platform = process.platform) {
  if (platform === 'linux') {
    return [
      'ls101-index-tts-helper-cuda',
      'libcublas',
      'libcublasLt',
      'libcudart',
      'libcufft',
      'libnvJitLink',
      'LICENSE.NVIDIA-CUDA.html'
    ]
  }
  if (platform === 'win32') {
    return [
      'ls101-index-tts-helper-cuda',
      'cublas',
      'cublasLt',
      'cudart',
      'cufft',
      'nvJitLink',
      'LICENSE.NVIDIA-CUDA.html'
    ]
  }
  return []
}

export function matchesDisabledCudaRuntimePrefix(name, prefixes) {
  return prefixes.some((prefix) => name.startsWith(prefix))
}

export async function cleanupDisabledCudaRuntimeFiles(
  runtimeDirectory,
  platform = process.platform
) {
  const prefixes = disabledCudaRuntimePrefixes(platform)
  const entries = await readdir(runtimeDirectory).catch((error) => {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  })
  for (const name of entries) {
    if (!matchesDisabledCudaRuntimePrefix(name, prefixes)) continue
    await rm(path.join(runtimeDirectory, name), { force: true }).catch((error) => {
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

export function downloadMode(environment = process.env) {
  if (environment.LS101_SKIP_INDEX_TTS_DOWNLOAD === '1') return 'skip'
  if (environment.LS101_INDEX_TTS_RUNTIME_ONLY === '1') return 'runtime-only'
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
  if (!target) throw new Error('当前平台没有 IndexTTS 原生运行时')
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
    manifest: findReleaseAsset(assets, 'index-tts-runtime-manifest.json')
  }
}

export function selectModelReleaseAssets(release) {
  validateRelease(release, config.modelRelease)
  const assets = Array.isArray(release.assets) ? release.assets : []
  return {
    parts: modelPartPlan().map((_part, index) => findReleaseAsset(assets, modelPartName(index))),
    manifest: findReleaseAsset(assets, 'index-tts-model-manifest.json')
  }
}

export function pinnedRuntimeReleaseAssets(target = runtimeTarget()) {
  if (!target) throw new Error('当前平台没有 IndexTTS 原生运行时')
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
    manifest: findPinnedAsset(config.runtimeRelease, 'index-tts-runtime-manifest.json')
  }
}

export function pinnedModelReleaseParts() {
  return modelPartPlan().map((_part, index) =>
    findPinnedPart(config.modelRelease, modelPartName(index))
  )
}

function findPinnedPart(release, name) {
  const parts = Array.isArray(release.parts) ? release.parts : []
  const part = parts.find((candidate) => candidate?.name === name)
  if (
    !part ||
    !Number.isSafeInteger(part.size) ||
    part.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(part.sha256 || '')
  ) {
    throw new Error(`IndexTTS 固定模型分片无效：${name}`)
  }
  return {
    name,
    size: part.size,
    digest: part.sha256,
    url: `https://github.com/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(name)}`
  }
}

function validateRelease(release, expected) {
  if (
    !release ||
    release.tag_name !== expected.tag ||
    release.draft ||
    release.prerelease !== expected.prerelease
  ) {
    throw new Error(`IndexTTS Release 无效：${expected.tag}`)
  }
}

function findReleaseAsset(assets, name) {
  const asset = assets.find((candidate) => candidate?.name === name)
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`IndexTTS Release 缺少有效资产：${name}`)
  }
  if (
    typeof asset.browser_download_url !== 'string' ||
    !asset.browser_download_url.startsWith('https://')
  ) {
    throw new Error(`IndexTTS Release 资产下载地址无效：${name}`)
  }
  const digest = typeof asset.digest === 'string' ? asset.digest : ''
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`IndexTTS Release 资产缺少 SHA-256 digest：${name}`)
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
    throw new Error(`IndexTTS 固定资产无效：${name}`)
  }
  return {
    name,
    size: asset.size,
    digest: asset.sha256,
    url: `https://github.com/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(name)}`
  }
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`IndexTTS 上游元数据请求失败（HTTP ${response.status}）：${url}`)
  }
  return response.json()
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return {
    accept: 'application/vnd.github+json',
    'user-agent': 'cyez-ls101-index-tts',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

function githubDownloadHeaders() {
  return { ...githubHeaders(), accept: 'application/octet-stream' }
}

async function fetchRelease(release) {
  return fetchJson(
    `https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`,
    githubHeaders()
  )
}

async function fetchUpstreamModelTree() {
  const url = `https://huggingface.co/api/models/${config.model.ggufRepository}/tree/${config.model.ggufRevision}/${path.posix.dirname(config.model.upstreamPath)}`
  return fetchJson(url)
}

function findUpstreamModelBlob(tree) {
  if (!Array.isArray(tree)) throw new Error('IndexTTS 上游模型目录响应无效')
  const entry = tree.find(
    (candidate) => candidate?.type === 'file' && candidate?.path === config.model.upstreamPath
  )
  const blob = entry?.lfs ?? entry
  if (!blob || blob?.size !== config.model.size || !/^[a-f0-9]{64}$/.test(`${blob?.oid ?? ''}`)) {
    throw new Error('IndexTTS 上游模型与 assets.json 固定的尺寸或 SHA-256 不一致')
  }
  if (blob.oid !== config.model.sha256) {
    throw new Error('IndexTTS 上游模型与 assets.json 固定的 SHA-256 不一致')
  }
  return blob
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

async function verifyUpstreamMetadata(target, downloadDirectory, boundary) {
  const [runtimeRelease, modelTree] = await Promise.all([
    fetchRelease(config.runtimeRelease),
    fetchUpstreamModelTree()
  ])
  findUpstreamModelBlob(modelTree)
  if (config.runtimeRelease.published) {
    assertSelectedAssetsMatch(
      selectRuntimeReleaseAssets(runtimeRelease, target),
      pinnedRuntimeReleaseAssets(target),
      'runtime'
    )
  }
  const caches = [
    writeMetadataCache(path.join(downloadDirectory, 'runtime-release-api.json'), runtimeRelease),
    writeMetadataCache(path.join(downloadDirectory, 'hf-model-tree-api.json'), modelTree)
  ]
  if (config.modelRelease.published) {
    const modelRelease = await fetchRelease(config.modelRelease)
    assertSelectedAssetsMatch(
      { parts: selectModelReleaseAssets(modelRelease).parts },
      { parts: pinnedModelReleaseParts() },
      'model'
    )
    caches.push(
      writeMetadataCache(path.join(downloadDirectory, 'model-release-api.json'), modelRelease)
    )
  }
  await ensureManagedDirectory(downloadDirectory, boundary)
  await Promise.all(caches)
}

function assertSelectedAssetsMatch(actual, expected, label) {
  const actualAssets = [
    ...(actual.parts ?? []),
    ...(actual.helpers ? Object.values(actual.helpers) : []),
    ...(actual.dependencies ?? []),
    ...(actual.licenses ?? []),
    actual.manifest
  ].filter(Boolean)
  const expectedAssets = [
    ...(expected.parts ?? []),
    ...(expected.helpers ? Object.values(expected.helpers) : []),
    ...(expected.dependencies ?? []),
    ...(expected.licenses ?? []),
    expected.manifest
  ].filter(Boolean)
  if (actualAssets.length !== expectedAssets.length) {
    throw new Error(`IndexTTS ${label} Release 资产数量与固定清单不一致`)
  }
  for (const pinned of expectedAssets) {
    const upstream = actualAssets.find((asset) => asset.name === pinned.name)
    if (
      !upstream ||
      upstream.size !== pinned.size ||
      upstream.digest !== pinned.digest ||
      upstream.url !== pinned.url
    ) {
      throw new Error(`IndexTTS ${label} Release 资产与固定清单不一致：${pinned.name}`)
    }
  }
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

export function upstreamModelAsset() {
  return {
    name: MODEL_FILE_NAME,
    size: config.model.size,
    sha256: config.model.sha256,
    url: `https://huggingface.co/${config.model.ggufRepository}/resolve/${config.model.ggufRevision}/${config.model.upstreamPath}`
  }
}

// Concatenates the downloaded parts back into the single GGUF, verifying each
// part hash and the merged size before the caller checks the whole-file hash.
export async function mergeModelParts(sources, destination, expected) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.part`
  const output = createWriteStream(temporary, { flags: 'wx' })
  const outputFinished = finished(output)
  let written = 0
  try {
    for (const part of sources) {
      const handle = await open(part.path, 'r')
      try {
        const hash = await import('node:crypto').then(({ createHash }) => createHash('sha256'))
        const buffer = Buffer.alloc(4 * 1024 * 1024)
        let position = 0
        while (position < part.size) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            Math.min(buffer.byteLength, part.size - position),
            position
          )
          if (bytesRead <= 0) throw new Error(`IndexTTS 模型分片读取失败：${part.path}`)
          hash.update(buffer.subarray(0, bytesRead))
          if (!output.write(buffer.subarray(0, bytesRead))) await once(output, 'drain')
          position += bytesRead
          written += bytesRead
        }
        if (position !== part.size) throw new Error(`IndexTTS 模型分片大小不符：${part.path}`)
        if (hash.digest('hex') !== part.sha256) {
          throw new Error(`IndexTTS 模型分片 SHA-256 不符：${part.path}`)
        }
      } finally {
        await handle.close()
      }
    }
    output.end()
    await outputFinished
    if (written !== expected.size) {
      throw new Error(`IndexTTS 模型合并后大小不符：${written}（应为 ${expected.size}）`)
    }
    await assertAssetFile(temporary, expected)
    await rm(destination, { recursive: true, force: true })
    await rename(temporary, destination)
  } catch (error) {
    output.destroy()
    await outputFinished.catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return destination
}

async function ensureRuntimePublished({
  target,
  platform,
  boundary,
  commandOptions,
  releaseDirectory,
  runtimeDirectory,
  stateDirectory
}) {
  const runtimeAssets = pinnedRuntimeReleaseAssets(target)
  const runtimeCacheAssets = [
    ...Object.values(runtimeAssets.helpers),
    ...runtimeAssets.dependencies,
    ...runtimeAssets.licenses,
    runtimeAssets.manifest
  ].filter(Boolean)
  await ensureDownloadedAssets({
    assets: runtimeCacheAssets.map((asset) => managedAsset(asset, asset.name)),
    boundary,
    exact: false,
    forceHash: commandOptions.verify,
    root: releaseDirectory,
    statePath: path.join(stateDirectory, `index-tts-runtime-cache-${target.directory}.json`)
  })
  const stagedRuntimeAssets = Object.entries(runtimeAssets.helpers).map(([backend, asset]) => {
    const helper = target.helpers[backend]
    return {
      ...managedAsset(asset, helper.executable, platform === 'win32' ? undefined : 0o755),
      source: path.join(releaseDirectory, asset.name)
    }
  })
  const stagedRuntime = await ensureAssetSet({
    boundary,
    root: runtimeDirectory,
    statePath: path.join(stateDirectory, `index-tts-runtime-${target.directory}.json`),
    assets: stagedRuntimeAssets,
    exact: true,
    forceHash: commandOptions.verify,
    repair: (asset, destination) => copyVerifiedAsset(asset.source, destination, asset)
  })
  logAssetSet('staged runtime', stagedRuntime)
}

// Before the runtime Release exists, only a locally built helper can satisfy
// setup. It is validated against build-cpu.json (which records the pinned
// upstream revisions) and its hash is logged for backfilling assets.json.
async function ensureRuntimeLocalBuild(runtimeDirectory, target) {
  const executable = path.join(runtimeDirectory, target.helpers.cpu.executable)
  const executableStats = await stat(executable).catch(() => null)
  if (!executableStats?.isFile() || executableStats.size < 1024 * 1024) {
    throw new Error(
      'IndexTTS 原生运行时 Release 尚未发布：请先运行 yarn index-tts:build-runtime 构建本地 helper，' +
        '或从 feature 分支 workflow_dispatch 运行 IndexTTS Assets 工作流发布 ' +
        `${config.runtimeRelease.tag} 并回填 assets.json`
    )
  }
  const metadataPath = path.join(runtimeDirectory, 'build-cpu.json')
  let metadata
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
  } catch {
    throw new Error(
      `本地 IndexTTS runtime 缺少构建元数据：${metadataPath}；请重新执行 yarn index-tts:build-runtime`
    )
  }
  if (
    metadata.sourceCommit !== config.runtime.revision ||
    metadata.ggmlRevision !== config.runtime.ggmlRevision
  ) {
    throw new Error(
      '本地 IndexTTS runtime 与 assets.json 固定的上游版本不一致；请重新执行 yarn index-tts:build-runtime'
    )
  }
  const hash = await sha256File(executable)
  console.log(
    `[index-tts] 使用本地构建 helper：${executable}（${executableStats.size} 字节，sha256=${hash}）`
  )
}

async function ensureModel({
  boundary,
  commandOptions,
  releaseDirectory,
  modelDirectory,
  stateDirectory
}) {
  const expected = {
    path: MODEL_FILE_NAME,
    size: config.model.size,
    sha256: config.model.sha256
  }
  const models = await ensureAssetSet({
    boundary,
    root: modelDirectory,
    statePath: path.join(stateDirectory, 'index-tts-models.json'),
    assets: [expected],
    exact: true,
    forceHash: commandOptions.verify,
    repair: async (asset, destination) => {
      if (!config.modelRelease.published) {
        const upstream = upstreamModelAsset()
        await downloadVerifiedAsset(upstream, destination, `[index-tts] ${upstream.name}`)
        return
      }
      const parts = pinnedModelReleaseParts()
      const partCache = await ensureDownloadedAssets({
        assets: parts.map((part) => managedAsset(part, part.name)),
        boundary,
        exact: false,
        forceHash: commandOptions.verify,
        root: releaseDirectory,
        statePath: path.join(stateDirectory, 'index-tts-model-parts.json')
      })
      if (partCache.repaired === 0) console.log('[index-tts] 模型分片缓存校验通过')
      await mergeModelParts(
        parts.map((part) => ({
          path: path.join(releaseDirectory, part.name),
          size: part.size,
          sha256: part.digest
        })),
        destination,
        asset
      )
    }
  })
  logAssetSet('models', models)
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
      downloadVerifiedAsset(asset, destination, `[index-tts] ${asset.name}`, {
        headers: githubDownloadHeaders
      })
  })
}

export async function main(options = {}) {
  const environment = options.environment ?? process.env
  const mode = downloadMode(environment)
  if (mode === 'skip') {
    console.log('[index-tts] download skipped by LS101_SKIP_INDEX_TTS_DOWNLOAD')
    return
  }

  const commandOptions = parseOptions(options.arguments ?? [])
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const target = runtimeTarget(platform, architecture)
  if (!target) {
    console.warn(
      `[index-tts] 当前平台 ${platform}/${architecture} 没有已发布的 CPU helper，跳过下载`
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
    console.log('[index-tts] official release metadata matches the pinned manifests')
  }

  if (config.runtimeRelease.published) {
    await ensureRuntimePublished({
      target,
      platform,
      boundary,
      commandOptions,
      releaseDirectory,
      runtimeDirectory,
      stateDirectory
    })
  } else {
    await ensureRuntimeLocalBuild(runtimeDirectory, target)
  }
  await cleanupStagedCudaRuntimes(runtimeRoot)

  if (mode === 'runtime-only') {
    console.log('[index-tts] model verification skipped in runtime-only mode')
    return
  }

  await ensureModel({ boundary, commandOptions, releaseDirectory, modelDirectory, stateDirectory })
}

function logAssetSet(label, result) {
  if (result.method === 'fast') console.log(`[index-tts] ${label} quickly verified`)
  else if (result.repaired > 0) console.log(`[index-tts] ${label}: ${result.repaired} restored`)
  else console.log(`[index-tts] ${label} fully verified`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main({ arguments: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
