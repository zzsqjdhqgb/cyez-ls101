/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { Zip, ZipPassThrough, strToU8 } from 'fflate'

const MAX_FFLATE_ARCHIVE_BYTES = 0xffffffff - 1024 * 1024
const MAX_PACKAGE_ASSET_BYTES = 10 * 1024 ** 3
const root = path.resolve(import.meta.dirname, '..', '..')
const assetConfig = loadAssetConfig()

function loadAssetConfig() {
  const file = path.join(import.meta.dirname, 'assets.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9_.-]+$/.test(value.modelRelease?.version ?? '') ||
    !/^[a-zA-Z0-9_.-]+$/.test(value.package?.version ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.revision ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.model?.revision ?? '')
  ) {
    throw new Error(`Invalid IndexTTS asset configuration: ${file}`)
  }
  return value
}

export function parseOptions(argv) {
  const options = {
    modelDir: path.join(root, 'externals', 'ai', 'index-tts', 'models'),
    voicesDir: path.join(root, 'native', 'qwen-tts', 'voice-design'),
    voices: [],
    voiceNames: new Map(),
    packageId: assetConfig.package.id,
    packageName: assetConfig.package.name,
    packageVersion: assetConfig.package.version,
    output: null
  }
  const value = (index, flag) => {
    const result = argv[index + 1]
    if (!result || result.startsWith('--')) throw new Error(`${flag} requires a value`)
    return result
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--model-dir') options.modelDir = path.resolve(value(index++, flag))
    else if (flag === '--voices-dir') options.voicesDir = path.resolve(value(index++, flag))
    else if (flag === '--voice') options.voices.push(parseAssignment(value(index++, flag), flag))
    else if (flag === '--voice-name') {
      const [id, name] = parseAssignment(value(index++, flag), flag)
      if (!name.trim()) throw new Error(`Voice name must not be empty: ${id}`)
      options.voiceNames.set(id, name.trim())
    } else if (flag === '--package-id') options.packageId = value(index++, flag)
    else if (flag === '--package-name') options.packageName = value(index++, flag)
    else if (flag === '--version') options.packageVersion = value(index++, flag)
    else if (flag === '--output') options.output = path.resolve(value(index++, flag))
    else throw new Error(`Unknown option: ${flag}`)
  }
  for (const [label, candidate] of [
    ['package ID', options.packageId],
    ['package version', options.packageVersion]
  ]) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(candidate)) throw new Error(`Invalid ${label}: ${candidate}`)
  }
  if (!options.packageName.trim()) throw new Error('Package name must not be empty')
  return options
}

function parseAssignment(value, flag) {
  const separator = value.indexOf('=')
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${flag} must use id=value syntax`)
  }
  const id = value.slice(0, separator)
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new Error(`Invalid voice ID: ${id}`)
  return [id, value.slice(separator + 1)]
}

// Reference WAVs are committed under native/qwen-tts/voice-design and recorded
// in assets.json, so the package builder discovers them by extension rather
// than by a separate extraction step (IndexTTS has no .spk-style embeddings).
async function discoverVoices(options) {
  const definitions = options.voices.length
    ? options.voices.map(([id, file]) => [id, path.resolve(file)])
    : (await readdir(options.voicesDir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.wav'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => [
          path.basename(entry.name, '.wav'),
          path.join(options.voicesDir, entry.name)
        ])
  if (!definitions.length) {
    throw new Error(`No reference WAV voices found under ${options.voicesDir}; use --voice id=path`)
  }
  const seen = new Set()
  return Promise.all(
    definitions.map(async ([id, file]) => {
      if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new Error(`Invalid voice ID: ${id}`)
      if (seen.has(id)) throw new Error(`Duplicate voice ID: ${id}`)
      seen.add(id)
      const details = await stat(file).catch(() => null)
      if (!details?.isFile() || details.size < 44 || details.size > 32 * 1024 * 1024) {
        throw new Error(`Reference WAV must be a 44-byte to 32 MiB file: ${file}`)
      }
      const voice = assetConfig.voices.find((candidate) => candidate.id === id)
      return {
        id,
        name: options.voiceNames.get(id) ?? voice?.name ?? displayName(id),
        file,
        languageCodes: voice?.languageCodes ?? ['en'],
        archivePath: `voices/${id}.wav`
      }
    })
  )
}

function displayName(id) {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

async function resolveModels(options) {
  const modelFile = path.join(options.modelDir, 'index-tts2_5-q8_0.gguf')
  if (!(await isFile(modelFile))) {
    throw new Error(`Required GGUF model is missing: ${modelFile}`)
  }
  return { modelFile }
}

async function isFile(file) {
  return stat(file)
    .then((value) => value.isFile())
    .catch(() => false)
}

function createZipWriter(outputPath) {
  const output = createWriteStream(outputPath, { flags: 'wx' })
  let blocked = null
  let created = false
  let rejectDone
  const done = new Promise((resolve, reject) => {
    rejectDone = reject
    output.once('finish', resolve)
    output.once('error', reject)
  })
  output.once('open', () => {
    created = true
  })
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      const reason = error instanceof Error ? error : new Error(String(error))
      rejectDone(reason)
      output.destroy(reason)
      return
    }
    if (chunk.byteLength && !output.write(chunk)) blocked = once(output, 'drain')
    if (final) void Promise.resolve(blocked).then(() => output.end(), rejectDone)
  })
  return {
    zip,
    done,
    waitForDrain: async () => {
      if (blocked) {
        await blocked
        blocked = null
      }
    },
    destroy: (error) => {
      zip.terminate()
      output.destroy(error)
    },
    wasCreated: () => created
  }
}

async function addFile(writer, sourcePath, archivePath, kind) {
  const entry = new ZipPassThrough(archivePath)
  entry.mtime = new Date('1980-01-01T00:00:00.000Z')
  writer.zip.add(entry)
  const digest = createHash('sha256')
  let size = 0
  for await (const chunk of createReadStream(sourcePath, { highWaterMark: 4 * 1024 * 1024 })) {
    await writer.waitForDrain()
    digest.update(chunk)
    size += chunk.byteLength
    entry.push(new Uint8Array(chunk), false)
  }
  entry.push(new Uint8Array(), true)
  await writer.waitForDrain()
  return { path: archivePath, kind, size, sha256: digest.digest('hex') }
}

async function addBytes(writer, bytes, archivePath) {
  const entry = new ZipPassThrough(archivePath)
  entry.mtime = new Date('1980-01-01T00:00:00.000Z')
  writer.zip.add(entry)
  entry.push(bytes, true)
  await writer.waitForDrain()
}

export async function buildPackage(options) {
  const models = await resolveModels(options)
  const voices = await discoverVoices(options)
  const outputPath =
    options.output ??
    path.join(
      root,
      'dist',
      `index-tts-2.5-${assetConfig.model.quantization}-${options.packageVersion}.zip`
    )
  await mkdir(path.dirname(outputPath), { recursive: true })

  const inputs = [models.modelFile, ...voices.map((voice) => voice.file)]
  const inputBytes = (
    await Promise.all(inputs.map(async (file) => (await stat(file)).size))
  ).reduce((total, size) => total + size, 0)
  if (inputBytes > MAX_FFLATE_ARCHIVE_BYTES || inputBytes > MAX_PACKAGE_ASSET_BYTES) {
    throw new Error('IndexTTS package exceeds the ZIP builder size limit; use Q8_0 weights')
  }

  const writer = createZipWriter(outputPath)
  try {
    const modelPath = `models/${path.basename(models.modelFile)}`
    const assets = [await addFile(writer, models.modelFile, modelPath, 'tts-model')]
    for (const voice of voices) {
      assets.push(await addFile(writer, voice.file, voice.archivePath, 'speaker-reference'))
    }
    const manifest = {
      format: 'ls101.tts-model-package',
      formatVersion: 1,
      package: {
        id: options.packageId,
        version: options.packageVersion,
        name: options.packageName,
        description: 'CPU-only IndexTTS 2.5 zero-shot voice cloning with reference-audio voices.'
      },
      runtime: {
        engine: 'index-tts',
        engineApiVersion: 1,
        minimumAppVersion: assetConfig.package.minimumAppVersion
      },
      assets,
      models: [
        {
          id: `index-tts-2.5-${assetConfig.model.quantization}`,
          name: `IndexTTS 2.5 ${assetConfig.model.quantization.toUpperCase()}`,
          languageCodes: ['zh', 'en', 'ja', 'es', 'ar'],
          artifacts: {
            'tts-model': [modelPath]
          },
          parameters: {
            load: { threads: 4, device: 0, lowMemory: true },
            synthesis: { language: 'auto', maxTokens: 1500 }
          }
        }
      ],
      voices: voices.map((voice) => ({
        id: voice.id,
        name: voice.name,
        languageCodes: voice.languageCodes,
        files: [voice.archivePath]
      })),
      extensions: {
        upstream: {
          runtime: assetConfig.runtime.repository
            .replace(/^https:\/\/github\.com\//, '')
            .replace(/\.git$/, ''),
          revision: assetConfig.runtime.revision,
          model: assetConfig.model.id,
          modelRevision: assetConfig.model.revision,
          modelLicense: 'bilibili Model Use License'
        }
      }
    }
    await addBytes(writer, strToU8(`${JSON.stringify(manifest, null, 2)}\n`), 'manifest.json')
    writer.zip.end()
    await writer.done
    return { outputPath, manifest }
  } catch (error) {
    writer.destroy(error instanceof Error ? error : new Error(String(error)))
    await writer.done.catch(() => undefined)
    if (writer.wasCreated()) await rm(outputPath, { force: true })
    throw error
  }
}

async function main() {
  const result = await buildPackage(parseOptions(process.argv.slice(2)))
  console.log(`IndexTTS model package written: ${result.outputPath}`)
  console.log(`Voices: ${result.manifest.voices.map((voice) => voice.id).join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
