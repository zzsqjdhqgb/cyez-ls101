/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
const { PNG } = require('pngjs')
const { EXTENSIONS, main } = require('../generate-icons.js')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('rebuilds an invalid generated icon directory and removes unrelated outputs', async () => {
  const boundary = await mkdtemp(path.join(tmpdir(), 'ls101-icons-'))
  temporaryDirectories.push(boundary)
  const pngDirectory = path.join(boundary, 'resources', 'file-icons')
  const icoDirectory = path.join(boundary, 'assets', 'file-icons')
  await mkdir(pngDirectory, { recursive: true })
  const size = 32
  const sourcePng = PNG.sync.write({
    width: size,
    height: size,
    data: Buffer.alloc(size * size * 4, 255)
  })
  await Promise.all(
    EXTENSIONS.map((extension) =>
      writeFile(path.join(pngDirectory, `${extension}.png`), sourcePng)
    )
  )
  await mkdir(path.dirname(icoDirectory), { recursive: true })
  await writeFile(icoDirectory, 'wrong directory')

  assert.deepEqual(main({ boundary, icoDirectory, pngDirectory }), {
    cached: 0,
    generated: EXTENSIONS.length * 2
  })
  await writeFile(path.join(icoDirectory, 'unrelated.ico'), 'wrong')
  assert.deepEqual(main({ boundary, icoDirectory, pngDirectory }), {
    cached: EXTENSIONS.length * 2,
    generated: 0
  })
  assert.deepEqual(
    (await readdir(icoDirectory)).sort(),
    EXTENSIONS.flatMap((extension) => [`${extension}.ico`, `${extension}.icns`]).sort()
  )
  for (const extension of EXTENSIONS) {
    const icns = await readFile(path.join(icoDirectory, `${extension}.icns`))
    assert.equal(icns.toString('ascii', 0, 4), 'icns')
    assert.equal(icns.readUInt32BE(4), icns.length)
  }
})
