/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { ensureAssetSet } = require('./asset-integrity.js')
const { downloadVerifiedAsset } = require('./download-asset.js')

const ROOT_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'pronunciation-model-assets.json')
const MODEL_DIRECTORY = 'facebook-wav2vec2-lv-60-espeak-cv-ft-int8'
const MODEL_DIR = join(ROOT_DIR, 'externals', 'ai', 'pronunciation', 'model', MODEL_DIRECTORY)
const STATE_PATH = join(
  ROOT_DIR,
  'externals',
  'ai',
  '.setup-verification',
  'pronunciation-model.json'
)
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
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('发音模型摘要清单版本无效')
  if (!/^[a-f0-9]{40}$/.test(manifest.revision || '')) throw new Error('发音模型 revision 无效')
  if (!/^https:\/\//.test(manifest.sourceApi || '')) throw new Error('发音模型 API 地址无效')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('发音模型文件清单为空')
  }
  for (const file of manifest.files) {
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

function modelFileUrl(file, manifest = PINNED_MANIFEST) {
  return `https://huggingface.co/${manifest.sourceModelId}/resolve/${manifest.revision}/${file.path}`
}

async function fetchOfficialMetadata(manifest = PINNED_MANIFEST) {
  const response = await fetch(manifest.sourceApi)
  if (!response.ok) throw new Error(`Hugging Face API 请求失败（HTTP ${response.status}）`)
  return response.json()
}

function assertMetadataMatches(manifest, official) {
  const differences = []
  if (official?.sha !== manifest.revision) {
    differences.push(`revision: ${manifest.revision} -> ${official?.sha || '缺失'}`)
  }
  const siblings = Array.isArray(official?.siblings) ? official.siblings : []
  for (const expected of manifest.files) {
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

async function main(argv = process.argv.slice(2), overrides = {}) {
  const options = parseOptions(argv)
  const manifest = overrides.manifest ?? PINNED_MANIFEST
  validateManifest(manifest)
  if (options.verifyUpstream) {
    const official = await fetchOfficialMetadata(manifest)
    assertMetadataMatches(manifest, official)
    console.log('[pronunciation] official model metadata matches the pinned manifest')
  }

  const assets = manifest.files.map((file) => ({
    ...file,
    url: overrides.urlForFile?.(file) ?? modelFileUrl(file, manifest)
  }))
  const result = await ensureAssetSet({
    boundary: overrides.boundary ?? ROOT_DIR,
    root: overrides.modelDir ?? MODEL_DIR,
    statePath: overrides.statePath ?? STATE_PATH,
    assets,
    exact: true,
    forceHash: options.verify,
    repair: (asset, destination) =>
      downloadVerifiedAsset(
        asset,
        destination,
        `[pronunciation] ${asset.path}`,
        overrides.downloadOptions
      )
  })
  if (result.method === 'fast') console.log('[pronunciation] all assets quickly verified')
  else if (result.repaired > 0) {
    console.log(
      `[pronunciation] ${result.repaired} asset${result.repaired === 1 ? '' : 's'} restored`
    )
  } else console.log('[pronunciation] all assets fully verified')
  return result
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  MODEL_DIRECTORY,
  PINNED_MANIFEST,
  assertMetadataMatches,
  isSafeRelativePath,
  main,
  modelFileUrl,
  parseOptions,
  validateManifest
}
