/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { ensureAssetSet, isSafeAssetPath } = require('./asset-integrity.js')
const { downloadVerifiedAsset } = require('./download-asset.js')

const ROOT_DIR = path.resolve(__dirname, '..')
const MANIFEST_PATH = path.join(__dirname, 'pocket-tts-assets.json')
const ASSETS_DIR = path.join(ROOT_DIR, 'externals', 'ai', 'pocket-tts', 'model')
const STATE_PATH = path.join(ROOT_DIR, 'externals', 'ai', '.setup-verification', 'pocket-tts.json')
const PINNED_MANIFEST = readManifest()

function readManifest() {
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 Pocket TTS 资产清单：${error.message}`)
  }
  validateManifest(manifest)
  return manifest
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) throw new Error('Pocket TTS 资产清单版本无效')
  if (typeof manifest.modelId !== 'string' || !manifest.modelId.includes('/')) {
    throw new Error('Pocket TTS 模型 ID 无效')
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.revision || '')) {
    throw new Error('Pocket TTS revision 无效')
  }
  if (!/^https:\/\//.test(manifest.sourceApi || '')) throw new Error('Pocket TTS API 地址无效')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Pocket TTS 资产清单为空')
  }
  for (const file of manifest.files) {
    if (!isSafeAssetPath(file.remote) || !isSafeAssetPath(file.path)) {
      throw new Error(`Pocket TTS 资产路径无效：${file?.path}`)
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`Pocket TTS 资产大小无效：${file.path}`)
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256 || '')) {
      throw new Error(`Pocket TTS 资产 SHA-256 无效：${file.path}`)
    }
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

function modelFileUrl(file, manifest = PINNED_MANIFEST) {
  const remote = file.remote.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${remote}`
}

async function verifyUpstreamMetadata(manifest = PINNED_MANIFEST) {
  const response = await fetch(manifest.sourceApi)
  if (!response.ok) throw new Error(`Pocket TTS API 请求失败（HTTP ${response.status}）`)
  const official = await response.json()
  if (official?.sha !== manifest.revision) {
    throw new Error(`Pocket TTS 官方 revision 与固定清单不一致：${official?.sha || '缺失'}`)
  }
  const siblings = Array.isArray(official?.siblings) ? official.siblings : []
  for (const expected of manifest.files) {
    const actual = siblings.find((file) => file.rfilename === expected.remote)
    if (!actual || actual.size !== expected.size || actual.lfs?.sha256 !== expected.sha256) {
      throw new Error(`Pocket TTS 官方资产与固定清单不一致：${expected.remote}`)
    }
  }
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const options = parseOptions(argv)
  const manifest = overrides.manifest ?? PINNED_MANIFEST
  validateManifest(manifest)
  if (options.verifyUpstream) {
    await (overrides.verifyUpstream ?? verifyUpstreamMetadata)(manifest)
    console.log('[pocket-tts] official metadata matches the pinned manifest')
  }

  const assets = manifest.files.map((file) => ({
    ...file,
    url: overrides.urlForFile?.(file) ?? modelFileUrl(file, manifest)
  }))
  const result = await ensureAssetSet({
    boundary: overrides.boundary ?? ROOT_DIR,
    root: overrides.assetsDir ?? ASSETS_DIR,
    statePath: overrides.statePath ?? STATE_PATH,
    assets,
    exact: true,
    forceHash: options.verify,
    repair: (asset, destination) =>
      downloadVerifiedAsset(
        asset,
        destination,
        `[pocket-tts] ${asset.path}`,
        overrides.downloadOptions
      )
  })

  if (result.method === 'fast') {
    console.log(`[pocket-tts] all ${assets.length} assets quickly verified`)
  } else if (result.repaired > 0) {
    console.log(`[pocket-tts] ${result.repaired} asset${result.repaired === 1 ? '' : 's'} restored`)
  } else {
    console.log(`[pocket-tts] all ${assets.length} assets fully verified`)
  }
  return result
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  PINNED_MANIFEST,
  main,
  modelFileUrl,
  parseOptions,
  validateManifest,
  verifyUpstreamMetadata
}
