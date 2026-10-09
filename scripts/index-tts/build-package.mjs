/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Zip, ZipPassThrough, strToU8 } from 'fflate'
import { externalRoot, loadConfig, root } from './config.mjs'

const ZIP_LIMIT = 0xffffffff - 1024 * 1024

export function validateReferenceWav(bytes) {
  const fail = () => {
    throw new Error(
      'Reference WAV must contain finite mono/stereo PCM16/24/32 or float32, 8–192 kHz, at most 30 seconds'
    )
  }
  if (
    bytes.length < 44 ||
    bytes.length > 32 * 1024 * 1024 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    fail()
  let format, rate, channels, bits, alignment, data
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) fail()
    const id = bytes.toString('ascii', offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4)
    offset += 8
    if (size > bytes.length - offset) fail()
    if (id === 'fmt ') {
      if (format !== undefined || size < 16) fail()
      format = bytes.readUInt16LE(offset)
      channels = bytes.readUInt16LE(offset + 2)
      rate = bytes.readUInt32LE(offset + 4)
      alignment = bytes.readUInt16LE(offset + 12)
      bits = bytes.readUInt16LE(offset + 14)
      if (
        ![1, 2].includes(channels) ||
        rate < 8000 ||
        rate > 192000 ||
        !((format === 1 && [16, 24, 32].includes(bits)) || (format === 3 && bits === 32)) ||
        alignment !== (channels * bits) / 8 ||
        bytes.readUInt32LE(offset + 8) !== rate * alignment
      )
        fail()
    } else if (id === 'data') {
      if (data) fail()
      data = bytes.subarray(offset, offset + size)
    }
    offset += size + (size % 2)
    if (offset > bytes.length) fail()
  }
  if (!format || !data?.length || data.length % alignment || data.length / alignment > rate * 30)
    fail()
  if (format === 3)
    for (let offset = 0; offset < data.length; offset += 4) {
      const value = data.readFloatLE(offset)
      if (!Number.isFinite(value) || Math.abs(value) > 1) fail()
    }
}

export function parseOptions(argv) {
  const config = loadConfig()
  const options = {
    model: path.join(externalRoot, 'models', config.model.file),
    output: path.join(root, 'dist', `${config.package.id}-${config.package.version}.zip`),
    config
  }
  for (let index = 0; index < argv.length; index += 2) {
    if (!['--model', '--output'].includes(argv[index]) || !argv[index + 1])
      throw new Error('Usage: yarn index-tts:build-package [--model GGUF] [--output ZIP]')
    options[argv[index].slice(2)] = path.resolve(argv[index + 1])
  }
  return options
}

// Like Qwen, stream stored ZIP entries with backpressure, fixed timestamps and
// integrity checking; never buffer multi-gigabyte weights in memory.
export async function buildPackage(options) {
  const config = options.config ?? loadConfig()
  const files = [
    {
      source: options.model,
      path: `models/${config.model.file}`,
      kind: 'tts-model',
      size: config.model.size,
      sha256: config.model.sha256
    }
  ]
  const voices = []
  const ids = new Set()
  for (const voice of config.voices) {
    if (!/^[\w.-]+$/.test(voice.id) || ids.has(voice.id))
      throw new Error('Invalid or duplicate IndexTTS voice ID')
    ids.add(voice.id)
    const source = path.resolve(root, voice.file)
    const details = await stat(source)
    if (!details.isFile() || details.size > 32 * 1024 * 1024)
      throw new Error('Reference WAV exceeds size limit')
    const bytes = await readFile(source)
    validateReferenceWav(bytes)
    if (createHash('sha256').update(bytes).digest('hex') !== voice.sha256)
      throw new Error(`Reference WAV digest differs: ${voice.id}`)
    const archivePath = `voices/${voice.id}.wav`
    files.push({
      source,
      path: archivePath,
      kind: 'speaker-reference',
      size: bytes.length,
      sha256: voice.sha256
    })
    const provenance = JSON.parse(await readFile(path.resolve(root, voice.provenance), 'utf8'))
    if (provenance.source?.audio?.sha256 !== voice.sha256 || !voice.license)
      throw new Error(`Invalid voice provenance: ${voice.id}`)
    voices.push({
      id: voice.id,
      name: voice.name,
      languageCodes: voice.languageCodes,
      files: [archivePath]
    })
    files.push({
      source: path.resolve(root, voice.provenance),
      path: `provenance/${voice.id}.json`,
      kind: 'provenance'
    })
  }
  if (!voices.length) throw new Error('IndexTTS requires at least one reference voice')
  for (const name of ['LICENSE.IndexTTS.txt', 'DISCLAIMER.IndexTTS.txt', 'LICENSE.audio-cpp.txt']) {
    files.push({
      source: path.join(root, 'native', 'index-tts', 'licenses', name),
      path: `licenses/${name}`,
      kind: 'license'
    })
  }
  let total = 0
  for (const file of files) {
    const details = await stat(file.source)
    if (!details.isFile() || (file.size !== undefined && file.size !== details.size))
      throw new Error(`Asset size differs: ${file.source}`)
    total += details.size
  }
  if (total > ZIP_LIMIT)
    throw new Error('IndexTTS package exceeds 4 GiB ZIP limit; use the pinned Q8_0 model')
  await mkdir(path.dirname(options.output), { recursive: true })
  const temporary = `${options.output}.${randomUUID()}.part`
  const output = createWriteStream(temporary, { flags: 'wx' })
  const done = once(output, 'finish')
  void done.catch(() => undefined)
  let blocked, failure
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failure = error
      output.destroy(error)
      return
    }
    if (chunk.length && !output.write(chunk)) {
      blocked = once(output, 'drain')
      void blocked.catch(() => undefined)
    }
    if (final)
      void Promise.resolve(blocked).then(
        () => output.end(),
        (error) => output.destroy(error)
      )
  })
  output.on('error', (error) => {
    failure = error
  })
  const drain = async () => {
    if (blocked) {
      await blocked
      blocked = null
    }
    if (failure) throw failure
  }
  const addBytes = async (bytes, filename) => {
    const entry = new ZipPassThrough(filename)
    entry.mtime = new Date('1980-01-01T00:00:00Z')
    zip.add(entry)
    entry.push(bytes, true)
    await drain()
  }
  try {
    const assets = []
    for (const file of files) {
      const entry = new ZipPassThrough(file.path)
      entry.mtime = new Date('1980-01-01T00:00:00Z')
      zip.add(entry)
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of createReadStream(file.source, { highWaterMark: 4 * 1024 * 1024 })) {
        await drain()
        hash.update(chunk)
        size += chunk.length
        entry.push(chunk, false)
      }
      entry.push(new Uint8Array(), true)
      await drain()
      const sha256 = hash.digest('hex')
      if (
        (file.sha256 && sha256 !== file.sha256) ||
        (file.size !== undefined && size !== file.size)
      )
        throw new Error(`Asset integrity differs: ${file.path}`)
      assets.push({ path: file.path, kind: file.kind, size, sha256 })
    }
    const manifest = {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: {
        id: config.package.id,
        version: config.package.version,
        name: config.package.name,
        description:
          'IndexTTS 2.5 with per-request reference voices. Any modifications made to the original model in this Derivative Work are not endorsed, warranted, or guaranteed by the original right-holder of the original model, and the original right-holder disclaims all liability related to this Derivative Work.'
      },
      runtime: {
        engine: 'index-tts',
        engineApiVersion: 1,
        minimumAppVersion: config.package.minimumAppVersion
      },
      assets,
      models: [
        {
          id: config.package.id,
          name: config.package.name,
          languageCodes: ['zh', 'en'],
          artifacts: { 'tts-model': [files[0].path] },
          parameters: {
            load: { threads: 4, device: 0, lowMemory: true },
            synthesis: { language: 'auto', maxTokens: 1500 }
          }
        }
      ],
      voices,
      extensions: {
        upstream: {
          runtime: config.runtime.repository,
          runtimeRevision: config.runtime.revision,
          model: config.model.id,
          modelRevision: config.model.revision,
          ggufRepository: config.model.ggufRepository,
          ggufRevision: config.model.ggufRevision
        },
        voices: config.voices.map(({ id, license }) => ({
          id,
          license,
          provenance: `provenance/${id}.json`
        }))
      }
    }
    await addBytes(strToU8(`${JSON.stringify(manifest, null, 2)}\n`), 'manifest.json')
    zip.end()
    await done
    await rename(temporary, options.output)
    return { outputPath: options.output, manifest }
  } catch (error) {
    zip.terminate()
    output.destroy(error)
    await done.catch(() => undefined)
    await rm(temporary, { force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildPackage(parseOptions(process.argv.slice(2)))
    .then(({ outputPath }) => console.log(`[index-tts] model package written: ${outputPath}`))
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
