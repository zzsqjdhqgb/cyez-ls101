/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  PINNED_MANIFEST,
  assertMetadataMatches,
  isSafeRelativePath,
  parseOptions,
  validateManifest
} = require('../download-pronunciation-model.js')

test('validates the pinned pronunciation model manifest', () => {
  assert.doesNotThrow(() => validateManifest(PINNED_MANIFEST))
  assert.equal(isSafeRelativePath('onnx/model_quantized.onnx'), true)
  assert.equal(isSafeRelativePath('../model.onnx'), false)
  assert.equal(isSafeRelativePath('onnx\\model.onnx'), false)
})

test('rejects pronunciation model metadata changes', () => {
  const official = {
    sha: PINNED_MANIFEST.revision,
    siblings: PINNED_MANIFEST.files.map((file) => ({
      rfilename: file.path,
      size: file.size,
      ...(file.path.endsWith('.onnx') ? { lfs: { sha256: file.sha256 } } : {})
    }))
  }
  assert.doesNotThrow(() => assertMetadataMatches(PINNED_MANIFEST, official))
  official.siblings[0].size += 1
  assert.throws(() => assertMetadataMatches(PINNED_MANIFEST, official), /元数据与固定清单不一致/)
})

test('only accepts pronunciation downloader verification option', () => {
  assert.deepEqual(parseOptions([]), { verify: false })
  assert.deepEqual(parseOptions(['--verify']), { verify: true })
  assert.throws(() => parseOptions(['--refresh']), /未知参数/)
})
