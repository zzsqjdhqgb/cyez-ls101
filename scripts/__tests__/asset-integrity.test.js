/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
const { ensureAssetSet, verifyAssetSet } = require('../asset-integrity.js')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('uses file fingerprints after one complete hash verification', async () => {
  const fixture = await createFixture()
  let repairs = 0

  const first = await ensureFixture(fixture, async (asset, destination) => {
    repairs += 1
    await writeFile(destination, fixture.contents[asset.path])
  })
  const second = await ensureFixture(fixture, async () => {
    repairs += 1
  })

  assert.deepEqual(first, { method: 'repaired', repaired: 2 })
  assert.deepEqual(second, { method: 'fast', repaired: 0 })
  assert.equal(repairs, 2)
})

test('detects same-size changes and restores the damaged asset', async () => {
  const fixture = await createFixture()
  await ensureFixture(fixture, (asset, destination) =>
    writeFile(destination, fixture.contents[asset.path])
  )
  await writeFile(path.join(fixture.root, 'model.bin'), Buffer.from('BAD model'))

  const repaired = []
  const result = await ensureFixture(fixture, async (asset, destination) => {
    repaired.push(asset.path)
    await writeFile(destination, fixture.contents[asset.path])
  })

  assert.deepEqual(result, { method: 'repaired', repaired: 1 })
  assert.deepEqual(repaired, ['model.bin'])
  assert.deepEqual(await readFile(path.join(fixture.root, 'model.bin')), Buffer.from('the model'))
})

test('rebuilds a managed directory that was replaced by an unrelated file', async () => {
  const fixture = await createFixture()
  await ensureFixture(fixture, (asset, destination) =>
    writeFile(destination, fixture.contents[asset.path])
  )
  await rm(fixture.root, { recursive: true })
  await writeFile(fixture.root, 'not a model directory')

  const result = await ensureFixture(fixture, (asset, destination) =>
    writeFile(destination, fixture.contents[asset.path])
  )

  assert.deepEqual(result, { method: 'repaired', repaired: 2 })
  assert.equal((await stat(fixture.root)).isDirectory(), true)
  assert.deepEqual((await readdir(fixture.root)).sort(), ['model.bin', 'voices'])
})

test('removes unexpected files from an otherwise valid managed tree', async () => {
  const fixture = await createFixture()
  await ensureFixture(fixture, (asset, destination) =>
    writeFile(destination, fixture.contents[asset.path])
  )
  await writeFile(path.join(fixture.root, 'voices', 'wrong.bin'), 'wrong')

  const result = await ensureFixture(fixture, () => {
    throw new Error('valid assets must not be downloaded again')
  })

  assert.deepEqual(result, { method: 'full', repaired: 0 })
  assert.deepEqual(await readdir(path.join(fixture.root, 'voices')), ['voice.bin'])
})

test('a corrupt verification state falls back to hashes instead of trusting the cache', async () => {
  const fixture = await createFixture()
  await ensureFixture(fixture, (asset, destination) =>
    writeFile(destination, fixture.contents[asset.path])
  )
  await writeFile(fixture.statePath, '{not json')

  const status = await verifyAssetSet({
    boundary: fixture.boundary,
    root: fixture.root,
    statePath: fixture.statePath,
    assets: fixture.assets,
    exact: true
  })

  assert.equal(status.valid, true)
  assert.equal(status.method, 'full')
  assert.deepEqual(status.invalidAssets, [])
  assert.deepEqual(status.unexpectedPaths, [])
  assert.equal(JSON.parse(await readFile(fixture.statePath, 'utf8')).schemaVersion, 1)
})

async function createFixture() {
  const boundary = await mkdtemp(path.join(tmpdir(), 'ls101-asset-integrity-'))
  temporaryDirectories.push(boundary)
  const root = path.join(boundary, 'generated', 'model')
  const statePath = path.join(boundary, 'generated', '.verification', 'model.json')
  const contents = {
    'model.bin': Buffer.from('the model'),
    'voices/voice.bin': Buffer.from('the voice')
  }
  const assets = Object.entries(contents).map(([assetPath, content]) => ({
    path: assetPath,
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex')
  }))
  return { assets, boundary, contents, root, statePath }
}

function ensureFixture(fixture, repair) {
  return ensureAssetSet({
    boundary: fixture.boundary,
    root: fixture.root,
    statePath: fixture.statePath,
    assets: fixture.assets,
    exact: true,
    repair
  })
}
