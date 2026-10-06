/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')
const yauzl = require('yauzl')

let buildPackage
let writeStoreZip
let splitVolumes

/** A tiny but structurally valid mono PCM16 WAV. */
function wavBuffer(frames) {
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVEfmt ', 8, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24)
  buffer.writeUInt32LE(24000 * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)
  return buffer
}

async function sha256(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')
}

function readZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const entries = new Map()
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipfile) => {
      if (error) return reject(error)
      zipfile.on('error', reject)
      zipfile.on('entry', (entry) => {
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError)
          const chunks = []
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zipfile.readEntry()
          })
          stream.on('error', reject)
        })
      })
      zipfile.on('end', () => resolve(entries))
      zipfile.readEntry()
    })
  })
}

describe('index-tts model package builder', () => {
  let directory
  let fixtureRoot

  before(async () => {
    ;({ buildPackage } = await import('../index-tts/build-package.mjs'))
    ;({ writeStoreZip, splitVolumes } = await import('../index-tts/zip64-store.mjs'))

    directory = await mkdtemp(path.join(os.tmpdir(), 'index-tts-package-'))
    fixtureRoot = path.join(directory, 'repo')
    const runtimeDirectory = path.join(fixtureRoot, 'externals/ai/index-tts/runtime/linux-x64')
    const modelsDirectory = path.join(fixtureRoot, 'externals/ai/index-tts/models')
    const voicesDirectory = path.join(fixtureRoot, 'native/index-tts/voices')
    await mkdir(runtimeDirectory, { recursive: true })
    await mkdir(modelsDirectory, { recursive: true })
    await mkdir(voicesDirectory, { recursive: true })

    await writeFile(path.join(modelsDirectory, 'index-tts2_5-f16.gguf'), Buffer.alloc(4096, 7))
    await writeFile(
      path.join(runtimeDirectory, 'ls101-index-tts-helper-cuda'),
      Buffer.from('#!/bin/sh\nexit 0\n')
    )
    await writeFile(path.join(runtimeDirectory, 'libaudiocpp.so.0'), Buffer.alloc(512, 3))
    await writeFile(path.join(voicesDirectory, 'american-man.wav'), wavBuffer(240))
    await writeFile(path.join(voicesDirectory, 'american-woman.wav'), wavBuffer(300))

    await writeFile(
      path.join(directory, 'assets.json'),
      JSON.stringify({
        schemaVersion: 1,
        package: { version: '9.9.9' },
        model: {
          repository: 'audio-cpp/audio.cpp-gguf',
          mirror: { repository: 'HereIsMark/audio.cpp-gguf' },
          revision: 'main',
          file: 'IndexTTS2.5-GGUF/index-tts2_5-f16.gguf',
          quantization: 'f16'
        },
        runtime: { repository: 'https://github.com/0xShug0/audio.cpp.git', revision: 'abc123' },
        voices: [
          {
            id: 'american-man',
            name: 'American English Man',
            file: 'native/index-tts/voices/american-man.wav'
          },
          {
            id: 'american-woman',
            name: 'American English Woman',
            file: 'native/index-tts/voices/american-woman.wav'
          }
        ]
      })
    )
  })

  after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('builds a package the application importer can read', async () => {
    const outputPath = path.join(directory, 'out', 'index-tts.zip')
    const result = await buildPackage({
      root: fixtureRoot,
      assetsPath: path.join(directory, 'assets.json'),
      platform: 'linux-x64',
      output: outputPath,
      noSplit: true
    })

    assert.equal(result.manifest.format, 'ls101.tts-model-package')
    assert.equal(result.manifest.runtime.engine, 'index-tts')
    assert.equal(result.manifest.package.version, '9.9.9')
    assert.deepEqual(
      result.manifest.assets.map((asset) => asset.kind),
      ['runtime-helper', 'runtime-library', 'tts-model', 'voice-reference', 'voice-reference']
    )
    assert.deepEqual(result.manifest.models[0].artifacts['runtime-helper'], [
      'runtime/linux-x64/ls101-index-tts-helper-cuda'
    ])
    assert.equal(result.manifest.models[0].parameters.synthesis.weightType, 'f16')
    assert.equal(result.manifest.voices.length, 2)

    // Every declared digest must match the archived payload.
    const entries = await readZipEntries(outputPath)
    assert.deepEqual(
      [...entries.keys()].sort(),
      [
        'manifest.json',
        'models/index-tts2_5-f16.gguf',
        'runtime/linux-x64/ls101-index-tts-helper-cuda',
        'runtime/linux-x64/libaudiocpp.so.0',
        'voices/american-man.wav',
        'voices/american-woman.wav'
      ].sort()
    )
    for (const asset of result.manifest.assets) {
      const payload = entries.get(asset.path)
      assert.ok(payload, `missing entry ${asset.path}`)
      assert.equal(payload.byteLength, asset.size)
      assert.equal(createHash('sha256').update(payload).digest('hex'), asset.sha256)
    }

    const manifestOnDisk = JSON.parse(entries.get('manifest.json').toString('utf8'))
    assert.deepEqual(manifestOnDisk, result.manifest)
  })

  it('splits the archive into volumes with matching digests', async () => {
    const outputPath = path.join(directory, 'split', 'index-tts.zip')
    const result = await buildPackage({
      root: fixtureRoot,
      assetsPath: path.join(directory, 'assets.json'),
      platform: 'linux-x64',
      output: outputPath,
      volumeBytes: 4096
    })

    const archiveBytes = (await stat(outputPath)).size
    assert.equal(result.volumes.archiveBytes, archiveBytes)
    assert.equal(result.volumes.archiveSha256, await sha256(outputPath))
    assert.ok(result.volumes.parts.length > 1, 'expected more than one volume')

    const reassembled = []
    let total = 0
    for (const [index, part] of result.volumes.parts.entries()) {
      assert.equal(part.index, index)
      const partPath = path.join(path.dirname(outputPath), part.name)
      const payload = await readFile(partPath)
      assert.equal(payload.byteLength, part.size)
      assert.equal(await sha256(partPath), part.sha256)
      assert.ok(part.size <= 4096)
      reassembled.push(payload)
      total += payload.byteLength
    }
    assert.equal(total, archiveBytes)
    assert.equal(
      createHash('sha256').update(Buffer.concat(reassembled)).digest('hex'),
      result.volumes.archiveSha256
    )

    const volumesFile = JSON.parse(
      await readFile(path.join(path.dirname(outputPath), 'index-tts-volumes.json'), 'utf8')
    )
    assert.deepEqual(volumesFile.parts, result.volumes.parts)
  })

  it('fails with a Chinese message when the platform runtime is absent', async () => {
    await assert.rejects(
      () =>
        buildPackage({
          root: fixtureRoot,
          assetsPath: path.join(directory, 'assets.json'),
          platform: 'win32-x64',
          output: path.join(directory, 'missing.zip')
        }),
      /缺少 IndexTTS 运行时/
    )
  })

  it('writes ZIP64 records on demand and stays readable', async () => {
    const payloadPath = path.join(directory, 'payload.bin')
    await writeFile(payloadPath, Buffer.alloc(2048, 9))
    const zipPath = path.join(directory, 'forced64.zip')

    const written = await writeStoreZip({
      outputPath: zipPath,
      entries: [{ name: 'payload.bin', path: payloadPath }],
      forceZip64: true
    })
    assert.equal(written.bytes, (await stat(zipPath)).size)

    const raw = await readFile(zipPath)
    assert.equal(raw.readUInt32LE(0), 0x04034b50)
    assert.ok(
      raw.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])),
      'expected a ZIP64 end-of-central-directory record'
    )
    assert.ok(raw.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])), 'expected a ZIP64 locator')

    const entries = await readZipEntries(zipPath)
    assert.deepEqual(entries.get('payload.bin'), Buffer.alloc(2048, 9))
  })

  it('refuses a non-positive volume size', async () => {
    const source = path.join(directory, 'payload.bin')
    await assert.rejects(
      () => splitVolumes({ archivePath: source, volumeBytes: 0, prefix: 'x' }),
      /分卷大小必须是正整数/
    )
  })
})
