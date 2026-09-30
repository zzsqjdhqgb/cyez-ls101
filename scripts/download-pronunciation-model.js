/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 准备 AI 发音评测的运行时资产。
 *
 * 上游（charsiu）没有可直接下载的 ONNX，因此运行时资产由钉住的源权重在本地导出：
 *
 *   1. 运行时目录已存在且 SHA-256 全部匹配 -> 直接通过，不下载也不导出；
 *   2. 否则下载并校验两个上游仓库（模型权重 + CMU 音素 tokenizer），
 *      再调用 scripts/export-pronunciation-model.py 导出 fp32 ONNX 并做 INT8 量化；
 *   3. 导出后再次按清单核对运行时资产。
 *
 * 因此只有缺少运行时资产时才需要 Python 3.10+ 与 torch / transformers / onnx / onnxruntime；
 * 受限网络可用 LS101_HF_ENDPOINT 指向镜像，用 LS101_PYTHON 指定解释器。
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash } = require('node:crypto')
const { createReadStream, readFileSync } = require('node:fs')
const { stat } = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { ensureAssetSet } = require('./asset-integrity.js')
const { downloadVerifiedAsset } = require('./download-asset.js')

const ROOT_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'pronunciation-model-assets.json')
const MODEL_ROOT = join(ROOT_DIR, 'externals', 'ai', 'pronunciation', 'model')
const SOURCE_CACHE_ROOT = join(ROOT_DIR, 'externals', 'ai', '.model-sources', 'pronunciation')
const STATE_ROOT = join(ROOT_DIR, 'externals', 'ai', '.setup-verification')
const DEFAULT_HF_ENDPOINT = 'https://huggingface.co'
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
  if (!manifest || manifest.schemaVersion !== 2) throw new Error('发音模型摘要清单版本无效')
  if (typeof manifest.modelId !== 'string' || !manifest.modelId) {
    throw new Error('发音模型标识无效')
  }
  if (!isSafeRelativePath(manifest.runtimeDirectory)) {
    throw new Error(`发音模型运行时目录无效：${manifest.runtimeDirectory}`)
  }
  if (!isSafeRelativePath(manifest.exporter)) throw new Error('发音模型导出脚本路径无效')
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
  validateFileList(manifest.runtime, '发音模型运行时清单为空')
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

function resolveEndpoint(explicit) {
  const endpoint = explicit ?? process.env.LS101_HF_ENDPOINT ?? DEFAULT_HF_ENDPOINT
  return endpoint.replace(/\/+$/, '')
}

function withEndpoint(url, endpoint) {
  return endpoint === DEFAULT_HF_ENDPOINT ? url : url.replace(DEFAULT_HF_ENDPOINT, endpoint)
}

function modelFileUrl(source, file, endpoint = DEFAULT_HF_ENDPOINT) {
  return withEndpoint(
    `${DEFAULT_HF_ENDPOINT}/${source.sourceModelId}/resolve/${source.revision}/${file.path}`,
    endpoint
  )
}

async function fetchOfficialMetadata(source, endpoint = DEFAULT_HF_ENDPOINT) {
  const response = await fetch(withEndpoint(source.sourceApi, endpoint))
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

function parseOptions(argv) {
  const allowed = new Set(['--verify', '--verify-upstream'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  return {
    verify: argv.includes('--verify'),
    verifyUpstream: argv.includes('--verify-upstream')
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
  for (const asset of manifest.runtime) {
    const path = join(runtimeDir, asset.path)
    const details = await stat(path).catch(() => null)
    if (!details?.isFile()) {
      missing.push(asset)
      continue
    }
    if (details.size !== asset.size || (await sha256File(path)) !== asset.sha256) {
      mismatched.push(asset)
    }
  }
  return { missing, mismatched }
}

function buildRuntimeAssets({ manifest, sourceRootFor, runtimeDir, endpoint, python }) {
  const sourceDir = (directory) => sourceRootFor({ directory })
  console.log('[pronunciation] 正在从上游权重导出 ONNX 运行时资产（需要 Python 与 torch）')
  execFileSync(
    python,
    [
      join(ROOT_DIR, manifest.exporter),
      '--model-dir',
      sourceDir('model'),
      '--tokenizer-dir',
      sourceDir('tokenizer'),
      '--output',
      runtimeDir
    ],
    { stdio: 'inherit' }
  )
  void endpoint
}

async function verifyUpstreamMetadata(manifest, endpoint) {
  for (const source of manifest.sources) {
    const official = await fetchOfficialMetadata(source, endpoint)
    assertMetadataMatches(source, official)
    console.log(`[pronunciation] ${source.sourceModelId} 官方元数据与固定清单一致`)
  }
}

async function ensureSources(manifest, options) {
  const endpoint = resolveEndpoint(options.endpoint)
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

async function main(argv = process.argv.slice(2), overrides = {}) {
  const options = { ...parseOptions(argv), ...overrides }
  const manifest = overrides.manifest ?? PINNED_MANIFEST
  validateManifest(manifest)
  const runtimeDir = overrides.runtimeDir ?? join(MODEL_ROOT, manifest.runtimeDirectory)
  const sourceRootFor =
    overrides.sourceRootFor ?? ((source) => join(SOURCE_CACHE_ROOT, source.directory))
  const python = overrides.python ?? process.env.LS101_PYTHON ?? 'python3'

  const runtime = await inspectRuntimeAssets(manifest, runtimeDir)
  if (runtime.missing.length === 0 && runtime.mismatched.length === 0) {
    if (options.verifyUpstream) {
      await verifyUpstreamMetadata(manifest, resolveEndpoint(overrides.endpoint))
    }
    console.log('[pronunciation] 运行时资产已与固定清单一致，无需重新导出')
    return { method: 'fast', repaired: 0 }
  }

  await ensureSources(manifest, { ...options, sourceRootFor, endpoint: overrides.endpoint })
  if (options.verifyUpstream) {
    await verifyUpstreamMetadata(manifest, resolveEndpoint(overrides.endpoint))
  }
  buildRuntimeAssets({
    manifest,
    sourceRootFor,
    runtimeDir,
    endpoint: resolveEndpoint(overrides.endpoint),
    python
  })

  const after = await inspectRuntimeAssets(manifest, runtimeDir)
  if (after.missing.length > 0) {
    throw new Error(
      `导出后仍缺少运行时资产：${after.missing.map((asset) => asset.path).join(', ')}`
    )
  }
  for (const asset of after.mismatched) {
    const message = `导出资产与固定 SHA-256 不一致（可能是导出工具链版本差异）：${asset.path}`
    if (options.verify) throw new Error(message)
    console.warn(`[pronunciation] 警告：${message}`)
  }
  console.log('[pronunciation] 运行时资产导出完成')
  return { method: 'exported', repaired: after.mismatched.length }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  DEFAULT_HF_ENDPOINT,
  MANIFEST_PATH,
  MODEL_ROOT,
  PINNED_MANIFEST,
  assertMetadataMatches,
  inspectRuntimeAssets,
  isSafeRelativePath,
  main,
  modelFileUrl,
  parseOptions,
  resolveEndpoint,
  validateManifest
}
