/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import process from 'node:process'
import { Zip, ZipPassThrough, strToU8 } from 'fflate'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'externals', 'ai', 'stt', 'model')
const modelDirectory = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25'

export async function buildAsrModelPackage({
  sourceDir = sourceRoot,
  output = process.env.LS101_ASR_PACKAGE_OUTPUT
    ? path.resolve(process.env.LS101_ASR_PACKAGE_OUTPUT)
    : path.join(root, 'dist', 'qwen3-asr-0.6b-int8-1.0.0.zip'),
  minimumAppVersion = '0.3.1'
} = {}) {
  const modelDir = path.join(sourceDir, modelDirectory)
  const inputs = [
    ['model/conv_frontend.onnx', path.join(modelDir, 'conv_frontend.onnx'), 'asr-model'],
    ['model/encoder.int8.onnx', path.join(modelDir, 'encoder.int8.onnx'), 'asr-model'],
    ['model/decoder.int8.onnx', path.join(modelDir, 'decoder.int8.onnx'), 'asr-model'],
    ['model/silero_vad.onnx', path.join(sourceDir, 'silero_vad.onnx'), 'voice-activity-model']
  ]
  const tokenizerFiles = (await readdir(path.join(modelDir, 'tokenizer'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => [
      `model/tokenizer/${entry.name}`,
      path.join(modelDir, 'tokenizer', entry.name),
      'speech-tokenizer'
    ])
  if (!tokenizerFiles.length) throw new Error('Qwen3 ASR tokenizer directory is empty')
  inputs.push(...tokenizerFiles)
  for (const [, file] of inputs) {
    const details = await stat(file).catch(() => null)
    if (!details?.isFile() || details.size === 0) throw new Error(`Missing ASR asset: ${file}`)
  }

  await mkdir(path.dirname(output), { recursive: true })
  const writer = createZipWriter(output)
  try {
    const assets = []
    for (const [archivePath, file, kind] of inputs) {
      assets.push(await addFile(writer, file, archivePath, kind))
    }
    const manifest = {
      format: 'ls101.asr-model-package',
      formatVersion: 1,
      package: {
        id: 'qwen3-asr-0.6b-int8',
        version: '1.0.0',
        name: 'Qwen3 ASR 0.6B Int8',
        description: 'CPU-only Qwen3 ASR 0.6B Int8 with Silero VAD.'
      },
      runtime: { engine: 'qwen3-asr', engineApiVersion: 1, minimumAppVersion },
      assets,
      models: [
        {
          id: 'qwen3-asr-0.6b-int8',
          name: 'Qwen3 ASR 0.6B Int8',
          languageCodes: ['zh', 'en'],
          artifacts: {
            convFrontend: ['model/conv_frontend.onnx'],
            encoder: ['model/encoder.int8.onnx'],
            decoder: ['model/decoder.int8.onnx'],
            tokenizer: tokenizerFiles.map(([archivePath]) => archivePath),
            vad: ['model/silero_vad.onnx']
          },
          parameters: { threads: 2, provider: 'cpu' }
        }
      ]
    }
    await addBytes(writer, strToU8(`${JSON.stringify(manifest, null, 2)}\n`), 'manifest.json')
    writer.zip.end()
    await writer.done
    return { outputPath: output, manifest }
  } catch (error) {
    writer.destroy(error instanceof Error ? error : new Error(String(error)))
    await writer.done.catch(() => undefined)
    if (writer.wasCreated()) await rm(output, { force: true })
    throw error
  }
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

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildAsrModelPackage()
    .then(({ outputPath }) => console.log(`[asr] model package written: ${outputPath}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
