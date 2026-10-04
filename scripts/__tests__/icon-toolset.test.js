/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdtemp, readdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { afterEach, test } = require('node:test')
const { PNG } = require('pngjs')

const execFileAsync = promisify(execFile)
const TOOL = path.join(__dirname, '..', 'icon-toolset', 'icon-tool.js')
const SOURCE_SIZE = 512

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

/** Source image with a gradient and a fully transparent corner, so alpha handling is exercised. */
async function createSourcePng() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-icon-tool-'))
  temporaryDirectories.push(directory)
  const data = Buffer.allocUnsafe(SOURCE_SIZE * SOURCE_SIZE * 4)
  for (let y = 0; y < SOURCE_SIZE; y++) {
    for (let x = 0; x < SOURCE_SIZE; x++) {
      const offset = (y * SOURCE_SIZE + x) * 4
      const transparent = x < SOURCE_SIZE / 4 && y < SOURCE_SIZE / 4
      data[offset] = x % 256
      data[offset + 1] = y % 256
      data[offset + 2] = 128
      data[offset + 3] = transparent ? 0 : 255
    }
  }
  const source = path.join(directory, 'icon.png')
  await writeFile(source, PNG.sync.write({ width: SOURCE_SIZE, height: SOURCE_SIZE, data }))
  return { directory, source }
}

function runTool(source, format, outDir) {
  return execFileAsync(process.execPath, [
    TOOL,
    `--input=${source}`,
    `--format=${format}`,
    `--out=${outDir}`
  ])
}

function readIcoFrames(buffer) {
  const count = buffer.readUInt16LE(4)
  const frames = []
  for (let index = 0; index < count; index++) {
    const offset = 6 + index * 16
    const dataOffset = buffer.readUInt32LE(offset + 12)
    const length = buffer.readUInt32LE(offset + 8)
    frames.push({
      width: buffer.readUInt8(offset) || 256,
      height: buffer.readUInt8(offset + 1) || 256,
      png: buffer.subarray(dataOffset, dataOffset + length)
    })
  }
  return frames
}

test('emits the upstream ICO frame set with decodable PNG frames', async () => {
  const { directory, source } = await createSourcePng()
  const outDir = path.join(directory, 'ico')
  const { stdout } = await runTool(source, 'ico', outDir)
  assert.match(stdout, /Done: ico/)

  const frames = readIcoFrames(await readFile(path.join(outDir, 'icon.ico')))
  assert.deepEqual(
    frames.map((frame) => frame.width),
    [16, 24, 32, 48, 64, 128, 256]
  )
  for (const frame of frames) {
    assert.equal(frame.width, frame.height)
    const decoded = PNG.sync.read(frame.png)
    assert.equal(decoded.width, frame.width)
    assert.equal(decoded.height, frame.height)
  }
})

test('resizes to the requested dimensions and preserves transparent pixels', async () => {
  const { directory, source } = await createSourcePng()
  const outDir = path.join(directory, 'ico')
  await runTool(source, 'ico', outDir)

  const largest = readIcoFrames(await readFile(path.join(outDir, 'icon.ico'))).at(-1)
  const decoded = PNG.sync.read(largest.png)
  const corner = decoded.data[3]
  const centre =
    (Math.floor(decoded.height / 2) * decoded.width + Math.floor(decoded.width / 2)) * 4
  assert.equal(corner, 0, 'transparent source corner must stay fully transparent')
  assert.equal(decoded.data[centre + 3], 255, 'opaque source pixels must stay fully opaque')
})

test('emits a self-consistent ICNS container', async () => {
  const { directory, source } = await createSourcePng()
  const outDir = path.join(directory, 'icns')
  await runTool(source, 'icns', outDir)

  const buffer = await readFile(path.join(outDir, 'icon.icns'))
  assert.equal(buffer.toString('ascii', 0, 4), 'icns')
  assert.equal(buffer.readUInt32BE(4), buffer.length)

  const types = []
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const osType = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32BE(offset + 4)
    assert.ok(length >= 8, `invalid ICNS entry length for ${osType}`)
    assert.equal(
      buffer
        .subarray(offset + 8, offset + 16)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      true
    )
    types.push(osType)
    offset += length
  }
  assert.equal(offset, buffer.length)
  // A 512px source cannot fill the 1024px slots.
  assert.deepEqual(types, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic11', 'ic12', 'ic13'])
})

test('emits the freedesktop PNG set', async () => {
  const { directory, source } = await createSourcePng()
  const outDir = path.join(directory, 'set')
  await runTool(source, 'set', outDir)

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512]
  assert.deepEqual(
    (await readdir(outDir)).sort((a, b) => parseInt(a) - parseInt(b)),
    sizes.map((size) => `${size}x${size}.png`)
  )
  for (const size of sizes) {
    const decoded = PNG.sync.read(await readFile(path.join(outDir, `${size}x${size}.png`)))
    assert.equal(decoded.width, size)
    assert.equal(decoded.height, size)
  }
})

test('rejects unsupported formats and inputs', async () => {
  const { directory, source } = await createSourcePng()
  await assert.rejects(runTool(source, 'bmp', path.join(directory, 'bmp')), /Invalid format "bmp"/)
  await assert.rejects(
    runTool(path.join(directory, 'icon.svg'), 'ico', path.join(directory, 'svg')),
    /Input file not found/
  )
  await writeFile(path.join(directory, 'icon.svg'), '<svg/>')
  await assert.rejects(
    runTool(path.join(directory, 'icon.svg'), 'ico', path.join(directory, 'svg2')),
    /SVG input is not supported/
  )
})
