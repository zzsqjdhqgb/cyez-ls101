/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createServer } = require('node:http')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { afterEach, test } = require('node:test')
const {
  PINNED_MANIFEST,
  assertMetadataMatches,
  downloadVerifiedAsset,
  parseOptions,
  validateContentRange,
  verifyFile
} = require('../download-stt-models.js')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('validates file size and SHA-256', async () => {
  const directory = await temporaryDirectory()
  const path = join(directory, 'model.bin')
  const content = Buffer.from('verified model')
  await writeFile(path, content)

  await verifyFile(path, { size: content.length, sha256: sha256(content) })
  await assert.rejects(
    verifyFile(path, { size: content.length, sha256: '0'.repeat(64) }),
    /SHA-256/
  )
})

test('resumes a partial download and verifies it before publishing', async () => {
  const directory = await temporaryDirectory()
  const destination = join(directory, 'asset.bin')
  const content = Buffer.from('0123456789abcdef')
  await writeFile(`${destination}.part`, content.subarray(0, 5))

  let requestedRange = null
  const server = createServer((request, response) => {
    requestedRange = request.headers.range || null
    response.writeHead(206, {
      'content-length': content.length - 5,
      'content-range': `bytes 5-${content.length - 1}/${content.length}`
    })
    response.end(content.subarray(5))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const address = server.address()
    const asset = {
      filename: 'asset.bin',
      url: `http://127.0.0.1:${address.port}/asset.bin`,
      size: content.length,
      sha256: sha256(content)
    }
    const result = await downloadVerifiedAsset(asset, destination, '[test] asset')
    assert.equal(result.downloaded, true)
    assert.equal(requestedRange, 'bytes=5-')
    assert.deepEqual(await readFile(destination), content)
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('validates range responses and command-line options', () => {
  validateContentRange('bytes 10-19/20', 10, 20)
  assert.throws(() => validateContentRange('bytes 0-19/20', 10, 20), /断点续传响应无效/)
  assert.deepEqual(parseOptions([]), { verify: false, refreshMetadata: false })
  assert.deepEqual(parseOptions(['--verify']), { verify: true, refreshMetadata: false })
  assert.deepEqual(parseOptions(['--refresh-metadata']), {
    verify: false,
    refreshMetadata: true
  })
  assert.throws(() => parseOptions(['--verify', '--refresh-metadata']), /不能与 --refresh-metadata/)
  assert.throws(() => parseOptions(['--unknown']), /未知参数/)
})

test('rejects upstream metadata changes instead of silently trusting them', () => {
  const matching = structuredClone(PINNED_MANIFEST)
  assert.doesNotThrow(() => assertMetadataMatches(PINNED_MANIFEST, matching))

  matching.assets.qwen3Archive.sha256 = '0'.repeat(64)
  assert.throws(
    () => assertMetadataMatches(PINNED_MANIFEST, matching),
    /官方 STT 模型元数据与固定清单不一致/
  )
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'ls101-stt-download-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}
