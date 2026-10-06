/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')
const yauzl = require('yauzl')

let buildPackage
let writeStoreZip
let splitVolumes
let needsZip64EndOfCentralDirectory

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
    ;({ writeStoreZip, splitVolumes, needsZip64EndOfCentralDirectory } =
      await import('../index-tts/zip64-store.mjs'))

    directory = await mkdtemp(path.join(os.tmpdir(), 'index-tts-package-'))
    fixtureRoot = path.join(directory, 'repo')
    const runtimeDirectory = path.join(fixtureRoot, 'externals/ai/index-tts/runtime/linux-x64')
    const modelsDirectory = path.join(fixtureRoot, 'externals/ai/index-tts/models')
    const voicesDirectory = path.join(fixtureRoot, 'native/index-tts/voices')
    const licensesDirectory = path.join(fixtureRoot, 'thirdparty-licenses')
    await mkdir(runtimeDirectory, { recursive: true })
    await mkdir(modelsDirectory, { recursive: true })
    await mkdir(voicesDirectory, { recursive: true })
    await mkdir(licensesDirectory, { recursive: true })

    const modelBytes = Buffer.alloc(4096, 7)
    const manVoiceBytes = wavBuffer(240)
    const womanVoiceBytes = wavBuffer(300)
    const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')

    await writeFile(path.join(modelsDirectory, 'index-tts2_5-f16.gguf'), modelBytes)
    await writeFile(
      path.join(runtimeDirectory, 'ls101-index-tts-helper-cuda'),
      Buffer.from('#!/bin/sh\nexit 0\n')
    )
    await writeFile(path.join(runtimeDirectory, 'libaudiocpp.so.0'), Buffer.alloc(512, 3))
    await writeFile(path.join(voicesDirectory, 'american-man.wav'), manVoiceBytes)
    await writeFile(path.join(voicesDirectory, 'american-woman.wav'), womanVoiceBytes)
    await writeFile(
      path.join(licensesDirectory, 'LICENSE.bilibili-index-tts.txt'),
      Buffer.from('bilibili Model Use License Agreement (fixture)\n')
    )
    await writeFile(
      path.join(licensesDirectory, 'LICENSE.bilibili-index-tts.zh.txt'),
      Buffer.from('bilibili 模型使用许可协议（测试夹具）\n')
    )
    await writeFile(
      path.join(licensesDirectory, 'DISCLAIMER.bilibili-index-tts.txt'),
      Buffer.from('TTS 语音合成技术免责声明（测试夹具）\n')
    )

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
          quantization: 'f16',
          size: modelBytes.byteLength,
          sha256: digest(modelBytes)
        },
        runtime: { repository: 'https://github.com/0xShug0/audio.cpp.git', revision: 'abc123' },
        voices: [
          {
            id: 'american-man',
            name: 'American English Man',
            file: 'native/index-tts/voices/american-man.wav',
            size: manVoiceBytes.byteLength,
            sha256: digest(manVoiceBytes)
          },
          {
            id: 'american-woman',
            name: 'American English Woman',
            file: 'native/index-tts/voices/american-woman.wav',
            size: womanVoiceBytes.byteLength,
            sha256: digest(womanVoiceBytes)
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
      [
        'runtime-helper',
        'runtime-library',
        'tts-model',
        'voice-reference',
        'voice-reference',
        'license',
        'license',
        'license'
      ]
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
        'licenses/DISCLAIMER.bilibili-index-tts.txt',
        'licenses/LICENSE.bilibili-index-tts.txt',
        'licenses/LICENSE.bilibili-index-tts.zh.txt',
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

    // §3.4(b) of the bilibili licence: the agreement travels inside the archive and next to it, so
    // the release job can attach it without unpacking the ZIP.
    const licenseAssets = result.manifest.assets.filter((asset) => asset.kind === 'license')
    assert.deepEqual(licenseAssets.map((asset) => asset.path).sort(), [
      'licenses/DISCLAIMER.bilibili-index-tts.txt',
      'licenses/LICENSE.bilibili-index-tts.txt',
      'licenses/LICENSE.bilibili-index-tts.zh.txt'
    ])
    for (const asset of licenseAssets) {
      const copied = await readFile(path.join(result.licenseDirectory, path.basename(asset.path)))
      assert.equal(createHash('sha256').update(copied).digest('hex'), asset.sha256)
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

  it('fails with a Chinese message when a licence file is missing', async () => {
    const partialRoot = path.join(directory, 'partial-repo')
    await cp(fixtureRoot, partialRoot, { recursive: true })
    await rm(path.join(partialRoot, 'thirdparty-licenses/DISCLAIMER.bilibili-index-tts.txt'))

    await assert.rejects(
      () =>
        buildPackage({
          root: partialRoot,
          assetsPath: path.join(directory, 'assets.json'),
          platform: 'linux-x64',
          output: path.join(directory, 'missing-license.zip'),
          noSplit: true
        }),
      /缺少许可与免责声明文件：.*DISCLAIMER\.bilibili-index-tts\.txt/
    )
  })

  it('refuses a file that no longer matches its assets.json pin', async () => {
    const pinned = JSON.parse(await readFile(path.join(directory, 'assets.json'), 'utf8'))
    const build = (assetsPath, output) =>
      buildPackage({
        root: fixtureRoot,
        assetsPath,
        platform: 'linux-x64',
        output: path.join(directory, output),
        noSplit: true
      })

    const modelMismatchPath = path.join(directory, 'assets-model-mismatch.json')
    await writeFile(
      modelMismatchPath,
      JSON.stringify({ ...pinned, model: { ...pinned.model, sha256: '0'.repeat(64) } })
    )
    await assert.rejects(
      () => build(modelMismatchPath, 'pin-model.zip'),
      /权重文件与 assets\.json 的 pin 不一致/
    )

    const voiceMismatchPath = path.join(directory, 'assets-voice-mismatch.json')
    await writeFile(
      voiceMismatchPath,
      JSON.stringify({
        ...pinned,
        voices: [{ ...pinned.voices[0], size: pinned.voices[0].size + 1 }, pinned.voices[1]]
      })
    )
    await assert.rejects(
      () => build(voiceMismatchPath, 'pin-voice.zip'),
      /参考音色与 assets\.json 的 pin 不一致/
    )
  })

  it('refuses an entry whose bytes changed between the hashing pass and the writing pass', async () => {
    const smallPath = path.join(directory, 'growing-small.bin')
    const grownPath = path.join(directory, 'growing-large.bin')
    await writeFile(smallPath, Buffer.alloc(64, 1))
    await writeFile(grownPath, Buffer.alloc(96, 2))

    // writeStoreZip hashes every entry before it writes any of them: stat() and hashFile() read the
    // path twice, then the spread into the write plan reads it a third time. Switching to a larger
    // file on that third read models a source file that grew after the hashing pass.
    let pathReads = 0
    const entry = { name: 'growing.bin' }
    Object.defineProperty(entry, 'path', {
      enumerable: true,
      get: () => (pathReads++ < 2 ? smallPath : grownPath)
    })

    await assert.rejects(
      () => writeStoreZip({ outputPath: path.join(directory, 'growing.zip'), entries: [entry] }),
      /归档写入字节数与校验值不一致：growing\.bin/
    )
  })

  it('requires the ZIP64 EOCD as soon as an EOCD field overflows', async () => {
    assert.equal(needsZip64EndOfCentralDirectory(0xffff, 0, 0), false)
    assert.equal(needsZip64EndOfCentralDirectory(0x10000, 0, 0), true)
    assert.equal(needsZip64EndOfCentralDirectory(6, 0xffffffff, 0), true)
    assert.equal(needsZip64EndOfCentralDirectory(6, 0, 0xffffffff), true)
    assert.equal(needsZip64EndOfCentralDirectory(6, 0, 0, true), true)
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
