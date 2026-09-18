/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
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
  await Promise.all(
    EXTENSIONS.map((extension) => writeFile(path.join(pngDirectory, `${extension}.png`), extension))
  )
  await mkdir(path.dirname(icoDirectory), { recursive: true })
  await writeFile(icoDirectory, 'wrong directory')

  assert.deepEqual(main({ boundary, icoDirectory, pngDirectory }), {
    cached: 0,
    generated: EXTENSIONS.length
  })
  await writeFile(path.join(icoDirectory, 'unrelated.ico'), 'wrong')
  assert.deepEqual(main({ boundary, icoDirectory, pngDirectory }), {
    cached: EXTENSIONS.length,
    generated: 0
  })
  assert.deepEqual(
    (await readdir(icoDirectory)).sort(),
    EXTENSIONS.map((extension) => `${extension}.ico`).sort()
  )
})
