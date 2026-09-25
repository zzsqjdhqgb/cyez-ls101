/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Pure-JS replacement for electron-builder's `icons@1.1.0` toolset icon-tool.js.
 *
 * Why this exists: the upstream tool rasterizes and resizes icons with libvips compiled to
 * WebAssembly (vips.wasm). That module imports `env.memory` as a *shared* WebAssembly.Memory
 * with `min == max == 16384` pages, i.e. exactly 1 GiB. `shared` imports must match the
 * declared limits exactly, so the size cannot be configured down (lowering INITIAL_MEMORY
 * fails with "memory import has N pages which is smaller than the declared initial of 16384"),
 * and the whole GiB is touched during libvips start-up. On machines with a tight commit limit
 * the child process aborts with "Committing semi space failed. Allocation failed - JavaScript
 * heap out of memory" before it converts anything.
 *
 * This implementation uses pngjs (a devDependency of this repository) plus a premultiplied
 * area-average resampler, so peak memory tracks the source image (a few MiB) instead of a
 * fixed 1 GiB, while producing the same ICO/ICNS container layout as upstream.
 *
 * Wire it up by pointing electron-builder at this directory (see build.js):
 *   ELECTRON_BUILDER_ICONS_TOOLSET_DIR=<absolute path to this directory>
 *
 * CLI (identical to upstream):
 *   node icon-tool.js --input=<path> --format=<icns|ico|set> --out=<dir>
 *
 * Supported inputs: .png, .icns (largest embedded PNG frame). SVG input requires the upstream
 * wasm rasterizer and is rejected explicitly rather than producing a wrong icon.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('node:fs')
const path = require('node:path')

/** Resolves pngjs from the repository even when this toolset is copied elsewhere. */
function loadPngjs() {
  try {
    return require('pngjs')
  } catch {
    /* fall back to walking up from the toolset and the working directory */
  }
  for (const start of [__dirname, process.cwd()]) {
    let current = start
    for (;;) {
      const candidate = path.join(current, 'node_modules', 'pngjs')
      if (fs.existsSync(candidate)) return require(candidate)
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  throw new Error('pngjs could not be resolved; it is required by the icon tool')
}

const { PNG } = loadPngjs()

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const ICNS_ENTRIES = [
  { osType: 'icp4', size: 16 },
  { osType: 'icp5', size: 32 },
  { osType: 'icp6', size: 64 },
  { osType: 'ic07', size: 128 },
  { osType: 'ic08', size: 256 },
  { osType: 'ic09', size: 512 },
  { osType: 'ic10', size: 1024 },
  { osType: 'ic11', size: 32 },
  { osType: 'ic12', size: 64 },
  { osType: 'ic13', size: 512 },
  { osType: 'ic14', size: 1024 }
]
const ICNS_SKIP_TYPES = new Set(['info', 'TOC ', 'icnV', 'name'])
const ICNS_PREFERRED_TYPES = ['ic10', 'ic09', 'ic14', 'ic08', 'ic13']
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const VALID_FORMATS = ['icns', 'ico', 'set']

/**
 * Area-average downscale of straight-alpha RGBA data. Colours are premultiplied so fully
 * transparent pixels cannot bleed into their neighbours.
 */
function resize(image, targetWidth, targetHeight) {
  const { width: sourceWidth, height: sourceHeight, data } = image
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return { width: targetWidth, height: targetHeight, data: Buffer.from(data) }
  }
  const out = Buffer.allocUnsafe(targetWidth * targetHeight * 4)
  const scaleX = sourceWidth / targetWidth
  const scaleY = sourceHeight / targetHeight
  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const y0 = targetY * scaleY
    const y1 = Math.min(sourceHeight, (targetY + 1) * scaleY)
    const firstY = Math.floor(y0)
    const lastY = Math.max(firstY + 1, Math.ceil(y1))
    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const x0 = targetX * scaleX
      const x1 = Math.min(sourceWidth, (targetX + 1) * scaleX)
      const firstX = Math.floor(x0)
      const lastX = Math.max(firstX + 1, Math.ceil(x1))
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let weightSum = 0
      for (let y = firstY; y < lastY; y++) {
        const weightY = Math.min(y + 1, y1) - Math.max(y, y0)
        if (weightY <= 0) continue
        const rowOffset = y * sourceWidth
        for (let x = firstX; x < lastX; x++) {
          const weightX = Math.min(x + 1, x1) - Math.max(x, x0)
          if (weightX <= 0) continue
          const weight = weightX * weightY
          const offset = (rowOffset + x) * 4
          const pixelAlpha = data[offset + 3]
          red += data[offset] * pixelAlpha * weight
          green += data[offset + 1] * pixelAlpha * weight
          blue += data[offset + 2] * pixelAlpha * weight
          alpha += pixelAlpha * weight
          weightSum += weight
        }
      }
      const offset = (targetY * targetWidth + targetX) * 4
      if (weightSum === 0 || alpha === 0) {
        out[offset] = 0
        out[offset + 1] = 0
        out[offset + 2] = 0
        out[offset + 3] = 0
        continue
      }
      out[offset] = Math.round(red / alpha)
      out[offset + 1] = Math.round(green / alpha)
      out[offset + 2] = Math.round(blue / alpha)
      out[offset + 3] = Math.round(alpha / weightSum)
    }
  }
  return { width: targetWidth, height: targetHeight, data: out }
}

function resizeToPng(image, size) {
  const resized = resize(image, size, size)
  return PNG.sync.write(resized, {
    colorType: 6,
    inputColorType: 6,
    bitDepth: 8,
    inputHasAlpha: true
  })
}

function decodePng(buffer) {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: png.data }
}

function packIco(frames) {
  const header = Buffer.allocUnsafe(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  let offset = 6 + frames.length * 16
  const directory = frames.map(({ size, png }) => {
    const entry = Buffer.allocUnsafe(16)
    const dimension = size === 256 ? 0 : size
    entry.writeUInt8(dimension, 0)
    entry.writeUInt8(dimension, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })

  return Buffer.concat([header, ...directory, ...frames.map((frame) => frame.png)])
}

function packIcns(frames) {
  const chunks = frames.flatMap(({ osType, png }) => {
    const header = Buffer.allocUnsafe(8)
    Buffer.from(osType, 'ascii').copy(header, 0)
    header.writeUInt32BE(8 + png.length, 4)
    return [header, png]
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.allocUnsafe(8)
  Buffer.from('icns', 'ascii').copy(header, 0)
  header.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([header, body])
}

function extractLargestPngFromIcns(data) {
  const typeMap = new Map()
  let offset = 8
  while (offset + 8 <= data.length) {
    const osType = data.toString('ascii', offset, offset + 4)
    const entryLength = data.readUInt32BE(offset + 4)
    if (entryLength < 8) break
    if (!ICNS_SKIP_TYPES.has(osType)) {
      typeMap.set(osType, { offset: offset + 8, length: entryLength - 8 })
    }
    offset += entryLength
  }
  for (const osType of ICNS_PREFERRED_TYPES) {
    const entry = typeMap.get(osType)
    if (!entry) continue
    const payload = data.subarray(entry.offset, entry.offset + entry.length)
    if (payload.length >= 8 && payload.subarray(0, 8).equals(PNG_MAGIC)) return payload
  }
  return null
}

function createIco(image, outDir) {
  const frames = ICO_SIZES.map((size) => ({ size, png: resizeToPng(image, size) }))
  fs.writeFileSync(path.join(outDir, 'icon.ico'), packIco(frames))
}

function createIcns(image, outDir) {
  const sourceSize = Math.max(image.width, image.height)
  const entries = ICNS_ENTRIES.filter((entry) => entry.size <= sourceSize)
  const pngBySize = new Map()
  for (const size of new Set(entries.map((entry) => entry.size))) {
    pngBySize.set(size, resizeToPng(image, size))
  }
  const frames = entries.map(({ osType, size }) => ({ osType, png: pngBySize.get(size) }))
  fs.writeFileSync(path.join(outDir, 'icon.icns'), packIcns(frames))
}

function createLinuxSet(image, outDir) {
  for (const size of LINUX_SIZES) {
    fs.writeFileSync(path.join(outDir, `${size}x${size}.png`), resizeToPng(image, size))
  }
}

function parseArgs(argv) {
  const args = {}
  for (const argument of argv) {
    const match = argument.match(/^--([^=]+)=(.*)$/)
    if (match) args[match[1]] = match[2]
  }
  return args
}

function decodeInput(input) {
  const extension = path.extname(input).toLowerCase()
  if (extension === '.png') return decodePng(fs.readFileSync(input))
  if (extension === '.icns') {
    const extracted = extractLargestPngFromIcns(fs.readFileSync(input))
    if (!extracted) throw new Error('Could not extract a PNG frame from ICNS file')
    return decodePng(extracted)
  }
  if (extension === '.svg') {
    throw new Error(
      'SVG input is not supported by the pure-JS icon tool; provide a PNG or ICNS source'
    )
  }
  throw new Error(`Unsupported input format "${extension}". Supported: .png, .icns`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const input = args['input']
  const format = args['format']
  const outDir = args['out']

  if (!input || !format || !outDir) {
    console.error('Usage: node icon-tool.js --input=<path> --format=<icns|ico|set> --out=<dir>')
    process.exit(1)
  }
  if (!VALID_FORMATS.includes(format)) {
    console.error(`Invalid format "${format}". Valid formats: ${VALID_FORMATS.join(', ')}`)
    process.exit(1)
  }
  if (!fs.existsSync(input)) {
    console.error(`Input file not found: ${input}`)
    process.exit(1)
  }

  const image = decodeInput(input)
  fs.mkdirSync(outDir, { recursive: true })

  if (format === 'icns') createIcns(image, outDir)
  else if (format === 'ico') createIco(image, outDir)
  else createLinuxSet(image, outDir)

  console.log(`Done: ${format} -> ${outDir}`)
}

try {
  main()
} catch (error) {
  console.error('Error:', (error && error.message) || String(error))
  process.exit(1)
}
