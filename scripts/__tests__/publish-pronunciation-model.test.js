/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
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

test('parses publish options and defaults to a dry run', async () => {
  const { parsePublishOptions } = await modulePromise

  assert.deepEqual(parsePublishOptions([]), {
    publish: false,
    updateManifest: false,
    clobber: false,
    help: false
  })
  assert.deepEqual(parsePublishOptions(['--publish', '--clobber']), {
    publish: true,
    updateManifest: false,
    clobber: true,
    help: false
  })
  assert.deepEqual(parsePublishOptions(['--update-manifest']).updateManifest, true)
  assert.throws(() => parsePublishOptions(['--force']), /未知参数/)
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

test('uploads release assets with a JSON Accept header', async () => {
  const { uploadReleaseAsset } = await modulePromise
  const directory = mkdtempSync(path.join(tmpdir(), 'ls101-publish-'))
  const filename = path.join(directory, 'config.json')
  writeFileSync(filename, '{"model":"charsiu"}')

  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ id: 7 }), {
      status: 201,
      headers: { 'content-type': 'application/json' }
    })
  }

  try {
    const result = await uploadReleaseAsset(
      { repository: 'owner/repo' },
      42,
      {
        asset: { name: 'model-config.json', path: 'config.json' },
        filename,
        size: 19,
        sha256: 'a'.repeat(64)
      },
      'https://uploads.example'
    )
    assert.deepEqual(result, { id: 7 })
  } finally {
    globalThis.fetch = originalFetch
    rmSync(directory, { force: true, recursive: true })
  }

  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(
    call.url,
    'https://uploads.example/repos/owner/repo/releases/42/assets?name=model-config.json'
  )
  assert.equal(call.options.method, 'POST')
  // The upload endpoint rejects `Accept: application/octet-stream` with HTTP 415, so the
  // response type stays JSON while the uploaded bytes are described by Content-Type.
  assert.equal(call.options.headers.accept, 'application/vnd.github+json')
  assert.equal(call.options.headers['content-type'], 'application/octet-stream')
})

test('release notes record provenance and immutability', async () => {
  const { releaseNotes } = await modulePromise
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
})
