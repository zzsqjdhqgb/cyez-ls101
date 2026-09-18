/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('node:fs')
const path = require('node:path')

const PNG_DIR = path.join(__dirname, '..', 'resources', 'file-icons')
const ICO_DIR = path.join(__dirname, '..', 'assets', 'file-icons')
const EXTENSIONS = ['cyexam', 'cytmpl', 'cydraft', 'cysubm', 'cygrade']

function createIco(pngPath) {
  const pngData = fs.readFileSync(pngPath)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  const imageOffset = 6 + 16
  entry.writeUInt8(0, 0)
  entry.writeUInt8(0, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngData.length, 8)
  entry.writeUInt32LE(imageOffset, 12)

  return Buffer.concat([header, entry, pngData])
}

function ensureDirectory(directory, boundary) {
  const relative = path.relative(boundary, directory)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe icon output directory: ${directory}`)
  }
  let current = boundary
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const existing = fs.existsSync(current) ? fs.lstatSync(current) : null
    if (existing?.isDirectory() && !existing.isSymbolicLink()) continue
    if (existing) fs.rmSync(current, { recursive: true, force: true })
    fs.mkdirSync(current)
  }
}

function main(options = {}) {
  const prefix = '[icons]'
  const pngDirectory = options.pngDirectory ?? PNG_DIR
  const icoDirectory = options.icoDirectory ?? ICO_DIR
  const boundary = options.boundary ?? path.join(__dirname, '..')

  const source = fs.existsSync(pngDirectory) ? fs.lstatSync(pngDirectory) : null
  if (!source?.isDirectory() || source.isSymbolicLink()) {
    throw new Error(`${prefix} source PNG directory is invalid: ${pngDirectory}`)
  }

  ensureDirectory(icoDirectory, boundary)

  let generated = 0
  let cached = 0
  const expectedOutputs = new Set()

  for (const ext of EXTENSIONS) {
    const pngPath = path.join(pngDirectory, `${ext}.png`)
    const icoPath = path.join(icoDirectory, `${ext}.ico`)
    expectedOutputs.add(`${ext}.ico`)

    const png = fs.existsSync(pngPath) ? fs.lstatSync(pngPath) : null
    if (!png?.isFile() || png.isSymbolicLink()) {
      throw new Error(`${prefix} source PNG is invalid: ${pngPath}`)
    }
    const ico = createIco(pngPath)
    const existing = fs.existsSync(icoPath) ? fs.lstatSync(icoPath) : null
    if (existing?.isFile() && !existing.isSymbolicLink() && fs.readFileSync(icoPath).equals(ico)) {
      cached++
      continue
    }
    if (existing) fs.rmSync(icoPath, { recursive: true, force: true })
    const temporary = `${icoPath}.${process.pid}.tmp`
    try {
      fs.writeFileSync(temporary, ico, { flag: 'wx' })
      fs.renameSync(temporary, icoPath)
    } finally {
      fs.rmSync(temporary, { force: true })
    }
    generated++
  }

  for (const entry of fs.readdirSync(icoDirectory, { withFileTypes: true })) {
    if (!expectedOutputs.has(entry.name)) {
      fs.rmSync(path.join(icoDirectory, entry.name), { recursive: true, force: true })
    }
  }

  const parts = []
  if (generated) parts.push(`${generated} generated`)
  if (cached) parts.push(`${cached} cached`)
  console.log(`${prefix} ${parts.join(', ') || 'nothing to do'}`)
  return { cached, generated }
}

if (require.main === module) main()

module.exports = { EXTENSIONS, createIco, main }
