/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 准备 AI 发音评测的运行时资产。
 *
 * 安装路径（默认，不需要 Python）：
 *
 *   1. 运行时目录已存在且 SHA-256 全部匹配 -> 直接通过，不下载也不导出；
 *   2. 否则按固定清单从受控 GitHub Release 下载 4 个运行时资产并校验 size/SHA-256；
 *   3. `--verify` 强制重新计算哈希；`--verify-upstream` 额外用 Release API
 *      核对已发布资产的元数据。
 *
 * 维护路径（`--export`，需要 Python 3.10+ 与 torch / transformers / onnx / onnxruntime）：
 * 上游（charsiu）没有可直接下载的 ONNX，因此换模型或重新导出时先按固定 revision 与
 * SHA-256 下载两个上游仓库（模型权重 + CMU 音素 tokenizer），再调用
 * `scripts/export-pronunciation-model.py` 导出 fp32 ONNX 并做 INT8 量化，最后按清单
 * 核对产物；产物通过 `scripts/publish-pronunciation-model.mjs` 发布到固定 Release 后，
 * 安装路径才不再需要 Python。
 *
 * 受限网络可用 `LS101_RELEASE_ENDPOINT` 指向 GitHub Release 镜像、
 * `LS101_RELEASE_API_ENDPOINT` 指向 Release API 镜像、`LS101_HF_ENDPOINT`
 * 指向 Hugging Face 镜像，用 `LS101_PYTHON` 指定导出解释器。
 *
 * 缓存位置默认在 `externals/ai/` 下，可用 `LS101_PRONUNCIATION_MODEL_ROOT`
 * （运行时资产）与 `LS101_PRONUNCIATION_SOURCE_ROOT`（上游权重缓存，约 377 MB）
 * 指到仓库内其他目录，例如 `.cache/pronunciation/`。
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash } = require('node:crypto')
const { createReadStream, readFileSync } = require('node:fs')
const { stat } = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const { isAbsolute, join, relative } = require('node:path')
const { ensureAssetSet } = require('./asset-integrity.js')
const { downloadVerifiedAsset } = require('./download-asset.js')

const ROOT_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'pronunciation-model-assets.json')
const DEFAULT_MODEL_ROOT = join(ROOT_DIR, 'externals', 'ai', 'pronunciation', 'model')
const DEFAULT_SOURCE_CACHE_ROOT = join(
  ROOT_DIR,
  'externals',
  'ai',
  '.model-sources',
  'pronunciation'
)
const STATE_ROOT = join(ROOT_DIR, 'externals', 'ai', '.setup-verification')
const RUNTIME_STATE_PATH = join(STATE_ROOT, 'pronunciation-model.json')
const RELEASE_TAG_PREFIX = 'pronunciation-model-v'
const DEFAULT_RELEASE_ENDPOINT = 'https://github.com'
const DEFAULT_RELEASE_API_ENDPOINT = 'https://api.github.com'
const DEFAULT_HF_ENDPOINT = 'https://huggingface.co'
const USER_AGENT = 'cyez-ls101-pronunciation-model'
const PINNED_MANIFEST = readManifest()

class MetadataMismatchError extends Error {}

function readManifest() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取发音模型摘要清单：${error.message}`)
  }
  validateManifest(manifest)
  return manifest
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 3) throw new Error('发音模型摘要清单版本无效')
  if (typeof manifest.modelId !== 'string' || !manifest.modelId) {
    throw new Error('发音模型标识无效')
  }
  if (!isSafeRelativePath(manifest.runtimeDirectory)) {
    throw new Error(`发音模型运行时目录无效：${manifest.runtimeDirectory}`)
  }
  if (!isSafeRelativePath(manifest.exporter)) throw new Error('发音模型导出脚本路径无效')
  validateRelease(manifest.release)
  validateFileList(manifest.release.assets, '发音模型运行时清单为空')
  const names = new Set()
  const paths = new Set()
  for (const asset of manifest.release.assets) {
    if (
      typeof asset.name !== 'string' ||
      !isSafeRelativePath(asset.name) ||
      asset.name.includes('/')
    ) {
      throw new Error(`发音模型 Release 资产名无效：${asset.name}`)
    }
    if (names.has(asset.name)) throw new Error(`发音模型 Release 资产名重复：${asset.name}`)
    names.add(asset.name)
    if (paths.has(asset.path)) throw new Error(`发音模型 Release 资产路径重复：${asset.path}`)
    paths.add(asset.path)
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error('发音模型上游清单为空')
  }
  for (const source of manifest.sources) {
    if (!isSafeRelativePath(source.directory)) {
      throw new Error(`发音模型上游目录无效：${source.directory}`)
    }
    if (typeof source.sourceModelId !== 'string' || !source.sourceModelId) {
      throw new Error('发音模型上游标识无效')
    }
    if (!/^[a-f0-9]{40}$/.test(source.revision || '')) throw new Error('发音模型 revision 无效')
    if (!/^https:\/\//.test(source.sourceApi || '')) throw new Error('发音模型 API 地址无效')
    validateFileList(source.files, '发音模型上游文件清单为空')
  }
}

function validateRelease(release) {
  if (!release || typeof release !== 'object') throw new Error('发音模型 Release 清单缺失')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(release.repository || '')) {
    throw new Error(`发音模型 Release 仓库无效：${release.repository}`)
  }
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(release.version || '')) {
    throw new Error(`发音模型 Release 版本无效：${release.version}`)
  }
  if (release.tag !== `${RELEASE_TAG_PREFIX}${release.version}`) {
    throw new Error(`发音模型 Release 标签无效：${release.tag}`)
  }
  if (typeof release.prerelease !== 'boolean') {
    throw new Error('发音模型 Release prerelease 标记无效')
  }
}

function validateFileList(files, emptyMessage) {
  if (!Array.isArray(files) || files.length === 0) throw new Error(emptyMessage)
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) throw new Error(`发音模型文件路径无效：${file.path}`)
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`发音模型文件大小无效：${file.path}`)
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
      throw new Error(`发音模型 SHA-256 无效：${file.path}`)
    }
  }
}

function isSafeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..')
  )
}

function resolveEndpoint(explicit, environmentValue, fallback) {
  const endpoint = explicit ?? environmentValue ?? fallback
  return String(endpoint).replace(/\/+$/, '')
}

function resolveReleaseEndpoint(explicit) {
  return resolveEndpoint(explicit, process.env.LS101_RELEASE_ENDPOINT, DEFAULT_RELEASE_ENDPOINT)
}

function resolveReleaseApiEndpoint(explicit) {
  return resolveEndpoint(
    explicit,
    process.env.LS101_RELEASE_API_ENDPOINT,
    DEFAULT_RELEASE_API_ENDPOINT
  )
}

function resolveHfEndpoint(explicit) {
  return resolveEndpoint(explicit, process.env.LS101_HF_ENDPOINT, DEFAULT_HF_ENDPOINT)
}

// 缓存位置默认在 externals/ 下，可用环境变量指到仓库内其他目录（例如 .cache/）。
// 目录必须留在仓库内：资产完整性校验以仓库根目录为安全边界。
function resolveWorkspaceDirectory(value, label) {
  const absolute = isAbsolute(value) ? value : join(ROOT_DIR, value)
  const relativePath = relative(ROOT_DIR, absolute)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label}必须位于仓库内：${value}`)
  }
  return absolute
}

function resolveModelRoot(explicit) {
  return resolveWorkspaceDirectory(
    explicit ?? process.env.LS101_PRONUNCIATION_MODEL_ROOT ?? DEFAULT_MODEL_ROOT,
    '发音模型运行时目录'
  )
}

function resolveSourceCacheRoot(explicit) {
  return resolveWorkspaceDirectory(
    explicit ?? process.env.LS101_PRONUNCIATION_SOURCE_ROOT ?? DEFAULT_SOURCE_CACHE_ROOT,
    '发音模型上游缓存目录'
  )
}

function releaseAssetUrl(release, name, endpoint = DEFAULT_RELEASE_ENDPOINT) {
  return `${endpoint}/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(name)}`
}

function releaseApiUrl(release, endpoint = DEFAULT_RELEASE_API_ENDPOINT) {
  return `${endpoint}/repos/${release.repository}/releases/tags/${encodeURIComponent(release.tag)}`
}

function githubHeaders(accept) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return {
    accept,
    'user-agent': USER_AGENT,
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

function releaseDownloadOptions() {
  return { headers: () => githubHeaders('application/octet-stream') }
}

function parseOptions(argv) {
  const allowed = new Set(['--verify', '--verify-upstream', '--export'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  return {
    verify: argv.includes('--verify'),
    verifyUpstream: argv.includes('--verify-upstream'),
    export: argv.includes('--export')
  }
}

async function sha256File(path) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  return digest.digest('hex')
}

async function inspectRuntimeAssets(manifest, runtimeDir) {
  const missing = []
  const mismatched = []
  for (const asset of manifest.release.assets) {
    const path = join(runtimeDir, asset.path)
    const details = await stat(path).catch(() => null)
    if (!details?.isFile()) {
      missing.push(asset)
      continue
    }
    const sha256 = await sha256File(path)
    if (details.size !== asset.size || sha256 !== asset.sha256) {
      mismatched.push({ ...asset, actualSize: details.size, actualSha256: sha256 })
    }
  }
  return { missing, mismatched }
}

function runtimeAssets(manifest, urlFor) {
  return manifest.release.assets.map((asset) => ({
    path: asset.path,
    size: asset.size,
    sha256: asset.sha256,
    name: asset.name,
    url: urlFor(asset)
  }))
}

async function ensureRuntimeAssets(manifest, options) {
  const endpoint = resolveReleaseEndpoint(options.endpoint)
  return ensureAssetSet({
    boundary: ROOT_DIR,
    root: options.runtimeDir,
    statePath: RUNTIME_STATE_PATH,
    assets: runtimeAssets(manifest, (asset) =>
      releaseAssetUrl(manifest.release, asset.name, endpoint)
    ),
    exact: true,
    forceHash: options.verify === true,
    repair: (asset, destination) =>
      downloadVerifiedAsset(asset, destination, `[pronunciation] ${asset.name}`, {
        ...releaseDownloadOptions(),
        ...options.downloadOptions
      })
  })
}

async function fetchRelease(release, endpoint = DEFAULT_RELEASE_API_ENDPOINT) {
  const response = await fetch(releaseApiUrl(release, endpoint), {
    headers: githubHeaders('application/vnd.github+json')
  })
  if (response.status === 404) {
    throw new MetadataMismatchError(`发音模型 Release 不存在：${release.repository}@${release.tag}`)
  }
  if (!response.ok) throw new Error(`发音模型 Release API 请求失败（HTTP ${response.status}）`)
  return response.json()
}

function assertReleaseMetadataMatches(manifest, official) {
  const release = manifest.release
  const assets = Array.isArray(official?.assets) ? official.assets : []
  const differences = []
  if (official?.tag_name && official.tag_name !== release.tag) {
    differences.push(`tag: ${release.tag} -> ${official.tag_name}`)
  }
  for (const pinned of release.assets) {
    const actual = assets.find((candidate) => candidate?.name === pinned.name)
    if (!actual) {
      differences.push(`${pinned.name}: 缺失`)
      continue
    }
    if (actual.size !== pinned.size) {
      differences.push(`${pinned.name}.size: ${pinned.size} -> ${actual.size}`)
    }
    const digest = typeof actual.digest === 'string' ? actual.digest.replace(/^sha256:/, '') : ''
    if (digest && digest !== pinned.sha256) {
      differences.push(`${pinned.name}.sha256: ${pinned.sha256} -> ${digest}`)
    }
  }
  if (differences.length > 0) {
    throw new MetadataMismatchError(
      `发音模型 Release 元数据与固定清单不一致：\n- ${differences.join('\n- ')}`
    )
  }
}

function withHfEndpoint(url, endpoint) {
  return endpoint === DEFAULT_HF_ENDPOINT ? url : url.replace(DEFAULT_HF_ENDPOINT, endpoint)
}

function modelFileUrl(source, file, endpoint = DEFAULT_HF_ENDPOINT) {
  return withHfEndpoint(
    `${DEFAULT_HF_ENDPOINT}/${source.sourceModelId}/resolve/${source.revision}/${file.path}`,
    endpoint
  )
}

async function fetchOfficialMetadata(source, endpoint = DEFAULT_HF_ENDPOINT) {
  const response = await fetch(withHfEndpoint(source.sourceApi, endpoint))
  if (!response.ok) throw new Error(`Hugging Face API 请求失败（HTTP ${response.status}）`)
  return response.json()
}

function assertMetadataMatches(source, official) {
  const differences = []
  if (official?.sha !== source.revision) {
    differences.push(`revision: ${source.revision} -> ${official?.sha || '缺失'}`)
  }
  const siblings = Array.isArray(official?.siblings) ? official.siblings : []
  for (const expected of source.files) {
    const actual = siblings.find((file) => file.rfilename === expected.path)
    if (!actual) {
      differences.push(`${expected.path}: 缺失`)
      continue
    }
    if (actual.size !== expected.size) {
      differences.push(`${expected.path}.size: ${expected.size} -> ${actual.size}`)
    }
    if (actual.lfs?.sha256 && actual.lfs.sha256 !== expected.sha256) {
      differences.push(`${expected.path}.sha256: ${expected.sha256} -> ${actual.lfs.sha256}`)
    }
  }
  if (differences.length > 0) {
    throw new MetadataMismatchError(
      `官方发音模型元数据与固定清单不一致：\n- ${differences.join('\n- ')}`
    )
  }
}

async function verifyUpstreamMetadata(manifest, endpoint) {
  for (const source of manifest.sources) {
    const official = await fetchOfficialMetadata(source, endpoint)
    assertMetadataMatches(source, official)
    console.log(`[pronunciation] ${source.sourceModelId} 官方元数据与固定清单一致`)
  }
}

async function ensureSources(manifest, options) {
  const endpoint = resolveHfEndpoint(options.endpoint)
  for (const source of manifest.sources) {
    const assets = source.files.map((file) => ({
      ...file,
      url: options.urlForFile?.(source, file) ?? modelFileUrl(source, file, endpoint)
    }))
    const result = await ensureAssetSet({
      boundary: ROOT_DIR,
      root: options.sourceRootFor(source),
      statePath: join(STATE_ROOT, `pronunciation-source-${source.directory}.json`),
      assets,
      exact: true,
      forceHash: options.verify,
      repair: (asset, destination) =>
        downloadVerifiedAsset(
          asset,
          destination,
          `[pronunciation] ${source.sourceModelId}/${asset.path}`,
          options.downloadOptions
        )
    })
    if (result.repaired > 0) {
      console.log(`[pronunciation] ${source.sourceModelId} 恢复 ${result.repaired} 个上游文件`)
    }
  }
}

function sourceDirectory(manifest, directory) {
  const source = manifest.sources.find((candidate) => candidate.directory === directory)
  if (!source) throw new Error(`发音模型上游清单缺少 ${directory} 目录`)
  return source
}

function exporterArguments({ manifest, sourceRootFor, runtimeDir }) {
  return [
    join(ROOT_DIR, manifest.exporter),
    '--model-dir',
    sourceRootFor(sourceDirectory(manifest, 'model')),
    '--tokenizer-dir',
    sourceRootFor(sourceDirectory(manifest, 'tokenizer')),
    '--output',
    runtimeDir
  ]
}

function buildRuntimeAssets({ manifest, sourceRootFor, runtimeDir, python }) {
  console.log('[pronunciation] 正在从上游权重导出 ONNX 运行时资产（需要 Python 与 torch）')
  execFileSync(python, exporterArguments({ manifest, sourceRootFor, runtimeDir }), {
    stdio: 'inherit'
  })
}

async function exportRuntimeAssets({ manifest, options, runtimeDir, overrides }) {
  const sourceRootFor =
    overrides.sourceRootFor ??
    ((source) => join(resolveSourceCacheRoot(overrides.sourceRoot), source.directory))
  const python = overrides.python ?? process.env.LS101_PYTHON ?? 'python3'

  await ensureSources(manifest, {
    sourceRootFor,
    endpoint: overrides.hfEndpoint,
    verify: options.verify,
    downloadOptions: overrides.downloadOptions
  })
  if (options.verifyUpstream) {
    await verifyUpstreamMetadata(manifest, resolveHfEndpoint(overrides.hfEndpoint))
  }
  buildRuntimeAssets({ manifest, sourceRootFor, runtimeDir, python })

  const after = await inspectRuntimeAssets(manifest, runtimeDir)
  if (after.missing.length > 0) {
    throw new Error(
      `导出后仍缺少运行时资产：${after.missing.map((asset) => asset.path).join(', ')}`
    )
  }
  for (const asset of after.mismatched) {
    const message =
      `导出资产与固定清单不一致：${asset.path}（实际 ${asset.actualSize} B / ` +
      `${asset.actualSha256.slice(0, 12)}…，期望 ${asset.size} B / ${asset.sha256.slice(0, 12)}…；` +
      '导出工具链差异或文本换行符被转换都会导致）'
    if (options.verify) throw new Error(message)
    console.warn(`[pronunciation] 警告：${message}`)
  }
  console.log(
    '[pronunciation] 运行时资产导出完成；发布前请运行 node scripts/publish-pronunciation-model.mjs'
  )
  return { method: 'exported', repaired: after.mismatched.length }
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const options = { ...parseOptions(argv), ...overrides }
  const manifest = overrides.manifest ?? PINNED_MANIFEST
  validateManifest(manifest)
  const runtimeDir =
    overrides.runtimeDir ?? join(resolveModelRoot(overrides.modelRoot), manifest.runtimeDirectory)

  if (options.export) {
    return exportRuntimeAssets({ manifest, options, runtimeDir, overrides })
  }

  const result = await ensureRuntimeAssets(manifest, {
    runtimeDir,
    endpoint: overrides.releaseEndpoint,
    verify: options.verify,
    downloadOptions: overrides.downloadOptions
  }).catch((error) => {
    if (/HTTP 404/.test(error.message)) {
      throw new Error(
        `${error.message}\n发音模型 Release "${manifest.release.tag}" 还没有发布对应资产；维护者需要先运行 node scripts/publish-pronunciation-model.mjs --publish。`
      )
    }
    throw error
  })
  const after = await inspectRuntimeAssets(manifest, runtimeDir)
  if (after.missing.length > 0 || after.mismatched.length > 0) {
    throw new Error(
      `发音模型运行时资产校验失败：${[...after.missing, ...after.mismatched]
        .map((asset) => asset.path)
        .join(', ')}`
    )
  }
  if (options.verifyUpstream) {
    const release = await fetchRelease(
      manifest.release,
      resolveReleaseApiEndpoint(overrides.apiEndpoint)
    )
    assertReleaseMetadataMatches(manifest, release)
    console.log(`[pronunciation] Release ${manifest.release.tag} 资产与固定清单一致`)
  }
  if (result.repaired > 0) {
    console.log(`[pronunciation] 从 Release 恢复 ${result.repaired} 个运行时资产`)
  }
  console.log(`[pronunciation] 运行时资产已与固定清单一致（${manifest.release.tag}）`)
  return { method: result.repaired > 0 ? 'downloaded' : result.method, repaired: result.repaired }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_HF_ENDPOINT,
  DEFAULT_MODEL_ROOT,
  DEFAULT_SOURCE_CACHE_ROOT,
  DEFAULT_RELEASE_API_ENDPOINT,
  DEFAULT_RELEASE_ENDPOINT,
  MANIFEST_PATH,
  PINNED_MANIFEST,
  RELEASE_TAG_PREFIX,
  RUNTIME_STATE_PATH,
  assertMetadataMatches,
  assertReleaseMetadataMatches,
  exporterArguments,
  fetchRelease,
  inspectRuntimeAssets,
  isSafeRelativePath,
  main,
  modelFileUrl,
  parseOptions,
  releaseApiUrl,
  releaseAssetUrl,
  resolveHfEndpoint,
  resolveModelRoot,
  resolveReleaseApiEndpoint,
  resolveReleaseEndpoint,
  resolveSourceCacheRoot,
  runtimeAssets,
  sourceDirectory,
  validateManifest
}
