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

function pngToIco(pngPath, icoPath) {
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

  const ico = Buffer.concat([header, entry, pngData])
  fs.writeFileSync(icoPath, ico)
}

function main() {
  const prefix = '[icons]'

  if (!fs.existsSync(PNG_DIR)) {
    console.log(`${prefix} no source PNG directory, skip`)
    return
  }

  fs.mkdirSync(ICO_DIR, { recursive: true })

  let generated = 0
  let missing = 0

  for (const ext of EXTENSIONS) {
    const pngPath = path.join(PNG_DIR, `${ext}.png`)
    const icoPath = path.join(ICO_DIR, `${ext}.ico`)

    if (!fs.existsSync(pngPath)) {
      missing++
      continue
    }
    pngToIco(pngPath, icoPath)
    generated++
  }

  const parts = []
  if (generated) parts.push(`${generated} generated`)
  if (missing) parts.push(`${missing} missing PNG`)
  console.log(`${prefix} ${parts.join(', ') || 'nothing to do'}`)
}

main()
