/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
const {
  PINNED_MANIFEST,
  main,
  modelFileUrl,
  parseOptions,
  validateManifest
} = require('../download-tts-assets.js')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('pins every Pocket TTS asset to an immutable revision and SHA-256', () => {
  assert.doesNotThrow(() => validateManifest(PINNED_MANIFEST))
  assert.equal(PINNED_MANIFEST.files.length, 9)
  assert.equal(new Set(PINNED_MANIFEST.files.map((file) => file.path)).size, 9)
  for (const file of PINNED_MANIFEST.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    assert.match(modelFileUrl(file), new RegExp(`/resolve/${PINNED_MANIFEST.revision}/`))
    assert.doesNotMatch(modelFileUrl(file), /\/resolve\/main\//)
  }
})

test('supports explicit local and upstream verification without enabling it by default', () => {
  assert.deepEqual(parseOptions([]), { verify: false, verifyUpstream: false })
  assert.deepEqual(parseOptions(['--verify']), { verify: true, verifyUpstream: false })
  assert.deepEqual(parseOptions(['--verify-upstream']), {
    verify: false,
    verifyUpstream: true
  })
  assert.throws(() => parseOptions(['--unknown']), /未知参数/)
})

test('repairs a corrupt cached Pocket TTS asset and then takes the fast path', async () => {
  const boundary = await mkdtemp(path.join(tmpdir(), 'ls101-pocket-tts-'))
  temporaryDirectories.push(boundary)
  const assetsDir = path.join(boundary, 'externals', 'model')
  const statePath = path.join(boundary, 'externals', '.verification', 'pocket.json')
  const contents = {
    'tokenizer.model': Buffer.from('tokenizer'),
    'voices/alba.safetensors': Buffer.from('voice data')
  }
  const manifest = {
    schemaVersion: 1,
    modelId: 'example/pocket-tts',
    revision: 'a'.repeat(40),
    sourceApi: 'https://example.test/api/model',
    files: Object.entries(contents).map(([assetPath, content]) => ({
      remote: assetPath,
      path: assetPath,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex')
    }))
  }
  let requests = 0
  const overrides = {
    assetsDir,
    boundary,
    manifest,
    statePath,
    urlForFile: (file) => `https://example.test/${file.path}`,
    downloadOptions: {
      fetch: async (url) => {
        requests += 1
        const assetPath = new URL(url).pathname.slice(1)
        return new Response(contents[assetPath], {
          headers: { 'content-length': String(contents[assetPath].byteLength) }
        })
      }
    }
  }

  assert.deepEqual(await main([], overrides), { method: 'repaired', repaired: 2 })
  assert.deepEqual(await main([], overrides), { method: 'fast', repaired: 0 })
  await writeFile(path.join(assetsDir, 'tokenizer.model'), 'bad-token')
  assert.deepEqual(await main([], overrides), { method: 'repaired', repaired: 1 })

  assert.equal(requests, 3)
  assert.deepEqual(
    await readFile(path.join(assetsDir, 'tokenizer.model')),
    contents['tokenizer.model']
  )
})
