/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const modulePromise = import('../publish-pronunciation-model.mjs')

function pinnedManifest() {
  const sha256 = 'a'.repeat(64)
  const other = 'b'.repeat(64)
  return {
    modelId: 'charsiu/en_w2v2_ctc_libris_and_cv',
    runtimeDirectory: 'charsiu-en_w2v2_ctc_libris_and_cv-int8',
    exporter: 'scripts/export-pronunciation-model.py',
    sources: [
      {
        directory: 'model',
        sourceModelId: 'charsiu/en_w2v2_ctc_libris_and_cv',
        revision: '70f5061463f2927a27236d7e9d309cf0fd5282b3'
      }
    ],
    release: {
      repository: 'zzsqjdhqgb/cyez-ls101',
      version: '1.0.0',
      tag: 'pronunciation-model-v1.0.0',
      prerelease: true,
      assets: [
        { name: 'model-config.json', path: 'config.json', size: 10, sha256 },
        { name: 'model-onnx.onnx', path: 'onnx/model_quantized.onnx', size: 20, sha256: other }
      ]
    }
  }
}

function writeRuntimeFile(runtime, relativePath, body) {
  const filename = path.join(runtime, relativePath)
  mkdirSync(path.dirname(filename), { recursive: true })
  writeFileSync(filename, body)
  const buffer = readFileSync(filename)
  return {
    filename,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex')
  }
}

test('parses options and defaults to a read-only check', async () => {
  const { parsePublishOptions } = await modulePromise

  assert.deepEqual(parsePublishOptions([]), {
    stage: null,
    notes: null,
    updateManifest: false,
    help: false
  })
  assert.deepEqual(parsePublishOptions(['--stage', '/tmp/out', '--notes', '/tmp/notes.md']), {
    stage: '/tmp/out',
    notes: '/tmp/notes.md',
    updateManifest: false,
    help: false
  })
  assert.equal(parsePublishOptions(['--update-manifest']).updateManifest, true)
  assert.throws(() => parsePublishOptions(['--force']), /未知参数/)
  assert.throws(() => parsePublishOptions(['--stage']), /需要一个路径参数/)
  assert.throws(() => parsePublishOptions(['--notes', '--help']), /需要一个路径参数/)
})

test('plans uploads against the pinned release urls', async () => {
  const { planUploads } = await modulePromise
  const manifest = pinnedManifest()
  const files = manifest.release.assets.map((asset, index) => ({
    asset,
    filename: `/tmp/${asset.name}`,
    size: asset.size,
    sha256: index === 0 ? 'c'.repeat(64) : asset.sha256
  }))

  const plan = planUploads(manifest, files, 'https://mirror.example')
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ['model-config.json', 'model-onnx.onnx']
  )
  assert.equal(
    plan[0].url,
    'https://mirror.example/zzsqjdhqgb/cyez-ls101/releases/download/pronunciation-model-v1.0.0/model-config.json'
  )
  assert.equal(plan[0].sha256, 'c'.repeat(64))
})

test('applies local hashes to the manifest without touching other assets', async () => {
  const { applyLocalHashes } = await modulePromise
  const manifest = pinnedManifest()
  const files = [
    {
      asset: manifest.release.assets[0],
      filename: '/tmp/model-config.json',
      size: 12,
      sha256: 'd'.repeat(64)
    }
  ]

  const { manifest: updated, changes } = applyLocalHashes(manifest, files)
  assert.equal(changes.length, 1)
  assert.match(changes[0], /config\.json/)
  assert.equal(updated.release.assets[0].size, 12)
  assert.equal(updated.release.assets[0].sha256, 'd'.repeat(64))
  assert.equal(updated.release.assets[1].sha256, 'b'.repeat(64))
  // The original manifest object must not be mutated.
  assert.equal(manifest.release.assets[0].size, 10)

  const unchanged = applyLocalHashes(updated, [
    {
      asset: updated.release.assets[0],
      filename: '/tmp/model-config.json',
      size: 12,
      sha256: 'd'.repeat(64)
    }
  ])
  assert.deepEqual(unchanged.changes, [])
})

test('stages assets under their published names and re-verifies every copy', async () => {
  const { stageReleaseAssets } = await modulePromise
  const root = mkdtempSync(path.join(tmpdir(), 'ls101-stage-'))
  const runtime = path.join(root, 'runtime')
  const stage = path.join(root, 'stage')

  try {
    const config = writeRuntimeFile(runtime, 'config.json', '{"model":"charsiu"}')
    const onnx = writeRuntimeFile(runtime, 'onnx/model_quantized.onnx', 'weights')

    const files = [
      {
        asset: { name: 'model-config.json', path: 'config.json', ...config },
        ...config
      },
      {
        asset: { name: 'model-onnx.onnx', path: 'onnx/model_quantized.onnx', ...onnx },
        ...onnx
      }
    ]

    const staged = await stageReleaseAssets(files, stage)
    assert.deepEqual(
      staged.map((filename) => path.basename(filename)),
      ['model-config.json', 'model-onnx.onnx']
    )
    // The published name is what `gh release create` will use, so the bytes must land there.
    assert.equal(readFileSync(path.join(stage, 'model-config.json'), 'utf8'), '{"model":"charsiu"}')
    assert.equal(readFileSync(path.join(stage, 'model-onnx.onnx'), 'utf8'), 'weights')
    // Runtime file names must not leak into the staging directory.
    assert.equal(existsSync(path.join(stage, 'config.json')), false)

    // A staged copy that no longer matches the pinned digest must fail loudly.
    await assert.rejects(
      () =>
        stageReleaseAssets(
          [{ ...files[0], asset: { ...files[0].asset, sha256: 'f'.repeat(64) } }],
          path.join(root, 'bad-stage')
        ),
      /暂存文件与清单不一致/
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})

test('release notes record provenance and immutability', async () => {
  const { releaseNotes, writeReleaseNotes } = await modulePromise
  const manifest = pinnedManifest()
  const files = manifest.release.assets.map((asset) => ({
    asset,
    filename: `/tmp/${asset.name}`,
    size: asset.size,
    sha256: asset.sha256
  }))

  const notes = releaseNotes(manifest, files)
  assert.match(notes, /charsiu\/en_w2v2_ctc_libris_and_cv/)
  assert.match(notes, /70f5061463f2927a27236d7e9d309cf0fd5282b3/)
  assert.match(notes, /scripts\/export-pronunciation-model\.py/)
  assert.match(notes, /model-onnx\.onnx/)
  assert.match(notes, /不可变/)

  const root = mkdtempSync(path.join(tmpdir(), 'ls101-notes-'))
  try {
    const notesPath = path.join(root, 'nested', 'notes.md')
    await writeReleaseNotes(manifest, files, notesPath)
    assert.equal(readFileSync(notesPath, 'utf8'), notes)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
