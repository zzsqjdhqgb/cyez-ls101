/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { externalRoot, loadConfig, root } from './config.mjs'

const GITHUB_ASSET_LIMIT = 2 * 1024 ** 3
const PART_BYTES = 1024 ** 3

export function modelReleaseParts(config) {
  const parts = config.modelRelease.parts
  if (!Array.isArray(parts) || !parts.length)
    throw new Error('No pinned IndexTTS model release parts')
  let total = 0
  return parts.map((part, index) => {
    const name = `${config.model.file}.part-${String(index + 1).padStart(4, '0')}`
    if (
      part.name !== name ||
      !/^[\w.-]+$/.test(name) ||
      !Number.isSafeInteger(part.size) ||
      part.size < 1 ||
      part.size >= GITHUB_ASSET_LIMIT ||
      !/^[a-f0-9]{64}$/.test(part.sha256)
    )
      throw new Error('Invalid pinned IndexTTS model release part')
    total += part.size
    if (index === parts.length - 1 && total !== config.model.size)
      throw new Error('Model release parts size differs')
    return {
      ...part,
      path: part.name,
      url: `https://github.com/${config.modelRelease.repository}/releases/download/${config.modelRelease.tag}/${encodeURIComponent(part.name)}`
    }
  })
}

// GitHub caps individual Release Assets at 2 GiB. Split weights by byte range;
// the local/importable ZIP still contains one canonical GGUF.
export async function splitModelForRelease({
  model,
  outputDirectory,
  config = loadConfig(),
  partSize = PART_BYTES
}) {
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize >= GITHUB_ASSET_LIMIT)
    throw new Error('Invalid release part size')
  if (!/^[\w.-]+$/.test(config.model.file)) throw new Error('Invalid model filename')
  if ((await stat(model)).size !== config.model.size)
    throw new Error('Model release input size differs')
  if (await stat(outputDirectory).catch(() => null))
    throw new Error('Model release output directory already exists')
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  const staging = await mkdtemp(`${outputDirectory}.part-`)
  const hash = createHash('sha256')
  const parts = []
  try {
    for (let start = 0; start < config.model.size; start += partSize) {
      const size = Math.min(partSize, config.model.size - start)
      const name = `${config.model.file}.part-${String(parts.length + 1).padStart(4, '0')}`
      const partHash = createHash('sha256')
      let written = 0
      await pipeline(
        createReadStream(model, { start, end: start + size - 1, highWaterMark: 4 * 1024 * 1024 }),
        new Transform({
          transform(chunk, _encoding, callback) {
            written += chunk.length
            hash.update(chunk)
            partHash.update(chunk)
            callback(null, chunk)
          }
        }),
        createWriteStream(path.join(staging, name), { flags: 'wx' })
      )
      if (written !== size) throw new Error('Truncated model release part')
      parts.push({ name, size, sha256: partHash.digest('hex') })
    }
    if (hash.digest('hex') !== config.model.sha256)
      throw new Error('Model release input integrity differs')
    const manifest = { model: config.model, release: { ...config.modelRelease, parts } }
    await writeFile(
      path.join(staging, 'index-tts-model-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    for (const filename of ['LICENSE.IndexTTS.txt', 'DISCLAIMER.IndexTTS.txt']) {
      await copyFile(
        path.join(root, 'native', 'index-tts', 'licenses', filename),
        path.join(staging, filename)
      )
    }
    await rename(staging, outputDirectory)
    return manifest
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function assembleModelParts({ parts, directory, destination, model }) {
  const temporary = `${destination}.${randomUUID()}.part`
  await mkdir(path.dirname(destination), { recursive: true })
  const hash = createHash('sha256')
  let size = 0
  async function* chunks() {
    for (const part of parts) {
      const partHash = createHash('sha256')
      let partSize = 0
      for await (const chunk of createReadStream(path.join(directory, part.name), {
        highWaterMark: 4 * 1024 * 1024
      })) {
        partSize += chunk.length
        size += chunk.length
        if (partSize > part.size || size > model.size)
          throw new Error('Model part size exceeds limits')
        partHash.update(chunk)
        hash.update(chunk)
        yield chunk
      }
      if (partSize !== part.size || partHash.digest('hex') !== part.sha256)
        throw new Error(`Model part integrity differs: ${part.name}`)
    }
  }
  try {
    await pipeline(Readable.from(chunks()), createWriteStream(temporary, { flags: 'wx' }))
    if (size !== model.size || hash.digest('hex') !== model.sha256)
      throw new Error('Assembled model integrity differs')
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--output')
    throw new Error('Usage: node scripts/index-tts/model-release.mjs --output NEW_DIRECTORY')
  const config = loadConfig()
  splitModelForRelease({
    model: path.join(externalRoot, 'models', config.model.file),
    outputDirectory: path.resolve(args[1]),
    config
  })
    .then((manifest) =>
      console.log(`[index-tts] model release parts: ${JSON.stringify(manifest.release.parts)}`)
    )
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
