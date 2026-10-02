/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const {
  PINNED_MANIFEST,
  RELEASE_TAG_PREFIX,
  assertMetadataMatches,
  assertReleaseMetadataMatches,
  exporterArguments,
  inspectRuntimeAssets,
  isSafeRelativePath,
  parseOptions,
  releaseApiUrl,
  releaseAssetUrl,
  sourceDirectory,
  validateManifest
} = require('../download-pronunciation-model.js')

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

test('validates the pinned pronunciation model manifest', () => {
  assert.doesNotThrow(() => validateManifest(PINNED_MANIFEST))
  assert.equal(PINNED_MANIFEST.sources.length, 2)
  assert.equal(PINNED_MANIFEST.release.assets.length, 4)
  assert.equal(
    PINNED_MANIFEST.release.tag,
    `${RELEASE_TAG_PREFIX}${PINNED_MANIFEST.release.version}`
  )
  assert.equal(
    new Set(PINNED_MANIFEST.release.assets.map((asset) => asset.name)).size,
    PINNED_MANIFEST.release.assets.length
  )
  assert.ok(
    PINNED_MANIFEST.release.assets.some((asset) => asset.path === 'onnx/model_quantized.onnx')
  )
  assert.equal(isSafeRelativePath('onnx/model_quantized.onnx'), true)
  assert.equal(isSafeRelativePath('../model.onnx'), false)
  assert.equal(isSafeRelativePath('onnx\\model.onnx'), false)
})

test('rejects invalid release metadata in the manifest', () => {
  const mutate = (patch) => ({ ...PINNED_MANIFEST, ...patch })

  assert.throws(() => validateManifest(mutate({ schemaVersion: 2 })), /清单版本无效/)
  assert.throws(() => validateManifest(mutate({ release: undefined })), /Release 清单缺失/)
  assert.throws(
    () => validateManifest(mutate({ release: { ...PINNED_MANIFEST.release, tag: 'v1.0.0' } })),
    /Release 标签无效/
  )
  assert.throws(
    () =>
      validateManifest(
        mutate({ release: { ...PINNED_MANIFEST.release, repository: 'not-a-repository' } })
      ),
    /Release 仓库无效/
  )
  assert.throws(
    () =>
      validateManifest(
        mutate({
          release: {
            ...PINNED_MANIFEST.release,
            assets: [
              { ...PINNED_MANIFEST.release.assets[0], name: 'nested/name.json' },
              ...PINNED_MANIFEST.release.assets.slice(1)
            ]
          }
        })
      ),
    /Release 资产名无效/
  )
  assert.throws(
    () =>
      validateManifest(
        mutate({
          release: {
            ...PINNED_MANIFEST.release,
            assets: [
              PINNED_MANIFEST.release.assets[0],
              { ...PINNED_MANIFEST.release.assets[1], name: PINNED_MANIFEST.release.assets[0].name }
            ]
          }
        })
      ),
    /Release 资产名重复/
  )
})

test('builds pinned release download and API urls', () => {
  const { release } = PINNED_MANIFEST
  const first = release.assets[0]

  assert.equal(
    releaseAssetUrl(release, first.name),
    `https://github.com/${release.repository}/releases/download/${release.tag}/${first.name}`
  )
  assert.equal(
    releaseAssetUrl(release, 'name with space.onnx', 'https://mirror.example'),
    `https://mirror.example/${release.repository}/releases/download/${release.tag}/name%20with%20space.onnx`
  )
  assert.equal(
    releaseApiUrl(release, 'https://api.example'),
    `https://api.example/repos/${release.repository}/releases/tags/${release.tag}`
  )
})

test('rejects pronunciation release metadata changes', () => {
  const pinned = PINNED_MANIFEST.release
  const official = {
    tag_name: pinned.tag,
    assets: pinned.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: `sha256:${asset.sha256}`
    }))
  }
  assert.doesNotThrow(() => assertReleaseMetadataMatches(PINNED_MANIFEST, official))

  const wrongSize = structuredClone(official)
  wrongSize.assets[0].size += 1
  assert.throws(
    () => assertReleaseMetadataMatches(PINNED_MANIFEST, wrongSize),
    /Release 元数据与固定清单不一致/
  )

  const wrongDigest = structuredClone(official)
  wrongDigest.assets[1].digest = `sha256:${'0'.repeat(64)}`
  assert.throws(
    () => assertReleaseMetadataMatches(PINNED_MANIFEST, wrongDigest),
    /Release 元数据与固定清单不一致/
  )

  const missing = structuredClone(official)
  missing.assets.pop()
  assert.throws(
    () => assertReleaseMetadataMatches(PINNED_MANIFEST, missing),
    /Release 元数据与固定清单不一致/
  )
})

test('rejects pronunciation model upstream metadata changes', () => {
  const source = PINNED_MANIFEST.sources[0]
  const official = {
    sha: source.revision,
    siblings: source.files.map((file) => ({
      rfilename: file.path,
      size: file.size,
      ...(file.path.endsWith('.bin') ? { lfs: { sha256: file.sha256 } } : {})
    }))
  }
  assert.doesNotThrow(() => assertMetadataMatches(source, official))
  official.siblings[0].size += 1
  assert.throws(() => assertMetadataMatches(source, official), /元数据与固定清单不一致/)
})

test('inspects runtime assets against a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pronunciation-assets-'))
  try {
    const config = Buffer.from('{"model":"test"}\n')
    const weights = Buffer.from('weights')
    const manifest = {
      release: {
        assets: [
          { name: 'config.json', path: 'config.json', size: config.length, sha256: sha256(config) },
          {
            name: 'model_quantized.onnx',
            path: 'onnx/model_quantized.onnx',
            size: weights.length,
            sha256: sha256(weights)
          }
        ]
      }
    }

    const empty = await inspectRuntimeAssets(manifest, root)
    assert.deepEqual(
      empty.missing.map((asset) => asset.path),
      ['config.json', 'onnx/model_quantized.onnx']
    )
    assert.deepEqual(empty.mismatched, [])

    await writeFile(join(root, 'config.json'), config)
    await mkdir(join(root, 'onnx'), { recursive: true })
    await writeFile(join(root, 'onnx', 'model_quantized.onnx'), 'tampered')

    const partial = await inspectRuntimeAssets(manifest, root)
    assert.deepEqual(partial.missing, [])
    assert.deepEqual(
      partial.mismatched.map((asset) => asset.path),
      ['onnx/model_quantized.onnx']
    )

    await writeFile(join(root, 'onnx', 'model_quantized.onnx'), weights)
    const complete = await inspectRuntimeAssets(manifest, root)
    assert.deepEqual(complete.missing, [])
    assert.deepEqual(complete.mismatched, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('builds the exporter command from the manifest sources', () => {
  const args = exporterArguments({
    manifest: PINNED_MANIFEST,
    sourceRootFor: (source) => `/sources/${source.directory}`,
    runtimeDir: '/runtime-output'
  })

  assert.ok(args[0].endsWith(PINNED_MANIFEST.exporter))
  assert.deepEqual(args.slice(1), [
    '--model-dir',
    '/sources/model',
    '--tokenizer-dir',
    '/sources/tokenizer',
    '--output',
    '/runtime-output'
  ])
  assert.equal(
    sourceDirectory(PINNED_MANIFEST, 'tokenizer').sourceModelId,
    'charsiu/tokenizer_en_cmu'
  )
  assert.throws(() => sourceDirectory({ sources: [] }, 'model'), /缺少 model 目录/)
})

test('only accepts pronunciation downloader options', () => {
  assert.deepEqual(parseOptions([]), { verify: false, verifyUpstream: false, export: false })
  assert.deepEqual(parseOptions(['--verify']), {
    verify: true,
    verifyUpstream: false,
    export: false
  })
  assert.deepEqual(parseOptions(['--verify-upstream']), {
    verify: false,
    verifyUpstream: true,
    export: false
  })
  assert.deepEqual(parseOptions(['--export']), {
    verify: false,
    verifyUpstream: false,
    export: true
  })
  assert.throws(() => parseOptions(['--refresh']), /未知参数/)
})
