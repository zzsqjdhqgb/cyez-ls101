/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { once } from 'node:events'
import { Zip, ZipPassThrough, strToU8 } from 'fflate'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(
  root,
  'externals',
  'ai',
  'pronunciation',
  'model',
  'facebook-wav2vec2-lv-60-espeak-cv-ft-int8'
)
const files = [
  ['config.json', 'model/config.json', 'model-config'],
  ['preprocessor_config.json', 'model/preprocessor_config.json', 'model-config'],
  ['vocab.json', 'model/vocab.json', 'vocabulary'],
  ['onnx/model_quantized.onnx', 'model/onnx/model_quantized.onnx', 'model-weights']
]

export async function buildPronunciationExtensionPackage({
  sourceDir = sourceRoot,
  output = process.env.LS101_PRONUNCIATION_EXTENSION_OUTPUT
    ? path.resolve(process.env.LS101_PRONUNCIATION_EXTENSION_OUTPUT)
    : path.join(root, 'dist', 'facebook-wav2vec2-pronunciation-1.0.0.zip')
} = {}) {
  const writer = createZipWriter(output)
  try {
    const assets = []
    for (const [sourceName, archivePath, kind] of files) {
      const source = path.join(sourceDir, sourceName)
      const details = await stat(source).catch(() => null)
      if (!details?.isFile() || details.size <= 0)
        throw new Error(`Missing pronunciation asset: ${source}`)
      assets.push(await addFile(writer, source, archivePath, kind))
    }
    const manifest = {
      format: 'ls101.extension-package',
      formatVersion: 1,
      extension: {
        id: 'facebook-wav2vec2-pronunciation',
        version: '1.0.0',
        name: 'AI 语音评测',
        description: 'Facebook Wav2Vec2 phoneme assessment extension.'
      },
      assets
    }
    await addBytes(writer, strToU8(`${JSON.stringify(manifest, null, 2)}\n`), 'manifest.json')
    writer.zip.end()
    await writer.done
    return { outputPath: output, manifest }
  } catch (error) {
    writer.destroy(error instanceof Error ? error : new Error(String(error)))
    await writer.done.catch(() => undefined)
    await rm(output, { force: true })
    throw error
  }
}

function createZipWriter(outputPath) {
  const output = createWriteStream(outputPath, { flags: 'wx' })
  let blocked = null
  let rejectDone
  const done = new Promise((resolve, reject) => {
    rejectDone = reject
    output.once('finish', resolve)
    output.once('error', reject)
  })
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectDone(error)
      output.destroy(error)
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
    }
  }
}

async function addFile(writer, sourcePath, archivePath, kind) {
  const entry = new ZipPassThrough(archivePath)
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
  writer.zip.add(entry)
  entry.push(bytes, true)
  await writer.waitForDrain()
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildPronunciationExtensionPackage()
    .then(({ outputPath }) =>
      console.log(`[pronunciation] extension package written: ${outputPath}`)
    )
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}
