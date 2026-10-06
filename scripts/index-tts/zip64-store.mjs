/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Minimal streaming ZIP64 writer for "store" (no compression) archives.
 *
 * fflate cannot produce archives above 4 GiB, and the IndexTTS model package is about 5.4 GB, so this
 * writer emits the ZIP64 records itself. Store-only is deliberate: GGUF weights barely compress and
 * skipping deflate keeps the packing pass streaming and fast. The resulting file is read back by the
 * application's existing yauzl-based importer, which understands ZIP64.
 *
 * Every entry is streamed twice: once to compute its CRC-32 and SHA-256, once to write it. Nothing is
 * buffered in memory, so a 5 GB payload costs the same RSS as a 5 MB one.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const EOCD64_SIGNATURE = 0x06064b50
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EXTRA_ID = 0x0001
const UINT32_MAX = 0xffffffff
const UINT16_MAX = 0xffff
const ZIP64_VERSION = 45
const CHUNK_BYTES = 4 * 1024 * 1024

// Fixed timestamp keeps the archive byte-for-byte reproducible: 2026-01-01 00:00:00.
const FIXED_DOS_TIME = 0
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32Update(state, chunk) {
  let value = state
  for (let index = 0; index < chunk.length; index += 1) {
    value = CRC_TABLE[(value ^ chunk[index]) & 0xff] ^ (value >>> 8)
  }
  return value >>> 0
}

/**
 * Streams one file to compute the metadata both the manifest and the archive need.
 * @returns {Promise<{ size: number, sha256: string, crc32: number }>}
 */
export async function hashFile(filePath) {
  const hash = createHash('sha256')
  let crc = 0xffffffff
  let size = 0
  const stream = createReadStream(filePath, { highWaterMark: CHUNK_BYTES })
  stream.on('data', (chunk) => {
    hash.update(chunk)
    crc = crc32Update(crc, chunk)
    size += chunk.length
  })
  await once(stream, 'end')
  return { size, sha256: hash.digest('hex'), crc32: (crc ^ 0xffffffff) >>> 0 }
}

function writeUInt16(buffer, offset, value) {
  buffer.writeUInt16LE(value & UINT16_MAX, offset)
}

function writeUInt32(buffer, offset, value) {
  buffer.writeUInt32LE(value >>> 0, offset)
}

function writeUInt64(buffer, offset, value) {
  buffer.writeBigUInt64LE(BigInt(value), offset)
}

function needsZip64(size, offset, force) {
  return force || size >= UINT32_MAX || offset >= UINT32_MAX
}

function buildZip64Extra(sizes) {
  const fields = []
  if (sizes.uncompressedSize !== undefined) fields.push(sizes.uncompressedSize)
  if (sizes.compressedSize !== undefined) fields.push(sizes.compressedSize)
  if (sizes.localHeaderOffset !== undefined) fields.push(sizes.localHeaderOffset)
  const buffer = Buffer.alloc(4 + fields.length * 8)
  writeUInt16(buffer, 0, ZIP64_EXTRA_ID)
  writeUInt16(buffer, 2, fields.length * 8)
  fields.forEach((value, index) => writeUInt64(buffer, 4 + index * 8, value))
  return buffer
}

/**
 * Writes a store-only ZIP archive.
 *
 * @param {object} options
 * @param {string} options.outputPath
 * @param {{ name: string, path: string }[]} options.entries archive names use "/" separators
 * @param {boolean} [options.forceZip64] emit ZIP64 records even for small archives (test hook)
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{ bytes: number, entries: { name: string, size: number, sha256: string, crc32: number }[] }>}
 */
export async function writeStoreZip(options) {
  const { outputPath, entries, forceZip64 = false } = options
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('ZIP 归档至少需要一个条目')
  }

  const prepared = []
  for (const entry of entries) {
    const info = await stat(entry.path)
    if (!info.isFile()) throw new Error(`ZIP 条目不是文件：${entry.path}`)
    const hashed = await hashFile(entry.path)
    prepared.push({ ...entry, ...hashed })
  }

  const output = createWriteStream(outputPath)
  const central = []
  let offset = 0
  const write = async (chunk) => {
    if (!output.write(chunk)) await once(output, 'drain')
    offset += chunk.length
  }

  try {
    for (const entry of prepared) {
      const nameBytes = Buffer.from(entry.name, 'utf8')
      const zip64 = needsZip64(entry.size, offset, forceZip64)
      const extra = zip64
        ? buildZip64Extra({ uncompressedSize: entry.size, compressedSize: entry.size })
        : Buffer.alloc(0)
      const header = Buffer.alloc(30)
      writeUInt32(header, 0, LOCAL_HEADER_SIGNATURE)
      writeUInt16(header, 4, zip64 ? ZIP64_VERSION : 20)
      writeUInt16(header, 6, 0x0800) // UTF-8 names
      writeUInt16(header, 8, 0) // store
      writeUInt16(header, 10, FIXED_DOS_TIME)
      writeUInt16(header, 12, FIXED_DOS_DATE)
      writeUInt32(header, 14, entry.crc32)
      writeUInt32(header, 18, zip64 ? UINT32_MAX : entry.size)
      writeUInt32(header, 22, zip64 ? UINT32_MAX : entry.size)
      writeUInt16(header, 26, nameBytes.length)
      writeUInt16(header, 28, extra.length)
      const localOffset = offset
      await write(header)
      await write(nameBytes)
      if (extra.length) await write(extra)

      const stream = createReadStream(entry.path, { highWaterMark: CHUNK_BYTES })
      for await (const chunk of stream) await write(chunk)

      central.push({ entry, nameBytes, zip64, localOffset, extra })
    }

    const centralStart = offset
    for (const record of central) {
      const { entry, nameBytes, zip64, localOffset } = record
      const extra = zip64
        ? buildZip64Extra({
            uncompressedSize: entry.size,
            compressedSize: entry.size,
            localHeaderOffset: localOffset
          })
        : Buffer.alloc(0)
      const header = Buffer.alloc(46)
      writeUInt32(header, 0, CENTRAL_HEADER_SIGNATURE)
      writeUInt16(header, 4, zip64 ? ZIP64_VERSION : 20) // version made by
      writeUInt16(header, 6, zip64 ? ZIP64_VERSION : 20) // version needed
      writeUInt16(header, 8, 0x0800)
      writeUInt16(header, 10, 0)
      writeUInt16(header, 12, FIXED_DOS_TIME)
      writeUInt16(header, 14, FIXED_DOS_DATE)
      writeUInt32(header, 16, entry.crc32)
      writeUInt32(header, 20, zip64 ? UINT32_MAX : entry.size)
      writeUInt32(header, 24, zip64 ? UINT32_MAX : entry.size)
      writeUInt16(header, 28, nameBytes.length)
      writeUInt16(header, 30, extra.length)
      writeUInt16(header, 32, 0)
      writeUInt16(header, 34, 0)
      writeUInt16(header, 36, 0)
      writeUInt32(header, 38, 0)
      writeUInt32(header, 42, zip64 ? UINT32_MAX : localOffset)
      await write(header)
      await write(nameBytes)
      if (extra.length) await write(extra)
    }
    const centralSize = offset - centralStart

    const useZip64End = forceZip64 || centralStart >= UINT32_MAX || centralSize >= UINT32_MAX
    if (useZip64End) {
      const eocd64Offset = offset
      const eocd64 = Buffer.alloc(56)
      writeUInt32(eocd64, 0, EOCD64_SIGNATURE)
      writeUInt64(eocd64, 4, 44)
      writeUInt16(eocd64, 12, ZIP64_VERSION)
      writeUInt16(eocd64, 14, ZIP64_VERSION)
      writeUInt32(eocd64, 16, 0)
      writeUInt32(eocd64, 20, 0)
      writeUInt64(eocd64, 24, prepared.length)
      writeUInt64(eocd64, 32, prepared.length)
      writeUInt64(eocd64, 40, centralSize)
      writeUInt64(eocd64, 48, centralStart)
      await write(eocd64)

      const locator = Buffer.alloc(20)
      writeUInt32(locator, 0, EOCD64_LOCATOR_SIGNATURE)
      writeUInt32(locator, 4, 0)
      writeUInt64(locator, 8, eocd64Offset)
      writeUInt32(locator, 16, 1)
      await write(locator)
    }

    const eocd = Buffer.alloc(22)
    writeUInt32(eocd, 0, EOCD_SIGNATURE)
    writeUInt16(eocd, 4, 0)
    writeUInt16(eocd, 6, 0)
    const fitsInUint16 = prepared.length < UINT16_MAX
    writeUInt16(eocd, 8, useZip64End || !fitsInUint16 ? UINT16_MAX : prepared.length)
    writeUInt16(eocd, 10, useZip64End || !fitsInUint16 ? UINT16_MAX : prepared.length)
    writeUInt32(eocd, 12, useZip64End ? UINT32_MAX : centralSize)
    writeUInt32(eocd, 16, useZip64End ? UINT32_MAX : centralStart)
    writeUInt16(eocd, 20, 0)
    await write(eocd)

    output.end()
    await once(output, 'finish')
  } catch (error) {
    output.destroy()
    throw error
  }

  return {
    bytes: offset,
    entries: prepared.map((entry) => ({
      name: entry.name,
      size: entry.size,
      sha256: entry.sha256,
      crc32: entry.crc32
    }))
  }
}

/**
 * Slices an archive into `<prefix>-part-NNN` volumes and returns their digests.
 *
 * GitHub Release rejects assets above 2 GiB, so the archive is cut into byte ranges. The cuts do not
 * change the ZIP structure, which keeps the in-app importer (a single .zip) untouched: the downloader
 * concatenates the volumes and verifies the whole-archive digest before import.
 */
export async function splitVolumes(options) {
  const { archivePath, volumeBytes, prefix, onProgress } = options
  if (!Number.isSafeInteger(volumeBytes) || volumeBytes <= 0) {
    throw new Error('分卷大小必须是正整数')
  }
  const archiveInfo = await stat(archivePath)
  const handle = await open(archivePath, 'r')
  const directory = path.dirname(archivePath)
  const parts = []
  try {
    let index = 0
    let position = 0
    while (position < archiveInfo.size) {
      const length = Math.min(volumeBytes, archiveInfo.size - position)
      const name = `${prefix}-part-${String(index).padStart(3, '0')}`
      const partPath = path.join(directory, name)
      const output = createWriteStream(partPath)
      const hash = createHash('sha256')
      let done = 0
      while (done < length) {
        const chunkBytes = Math.min(CHUNK_BYTES, length - done)
        // A fresh buffer per read: the stream may still hold the previous chunk when write() returns true.
        const buffer = Buffer.allocUnsafe(chunkBytes)
        const { bytesRead } = await handle.read(buffer, 0, chunkBytes, position + done)
        if (bytesRead === 0) throw new Error('读取归档时提前结束')
        const chunk = buffer.subarray(0, bytesRead)
        hash.update(chunk)
        if (!output.write(chunk)) await once(output, 'drain')
        done += bytesRead
        onProgress?.(position + done, archiveInfo.size)
      }
      output.end()
      await once(output, 'finish')
      parts.push({ index, name, path: partPath, size: length, sha256: hash.digest('hex') })
      position += length
      index += 1
    }
  } finally {
    await handle.close()
  }
  return { bytes: archiveInfo.size, parts }
}
