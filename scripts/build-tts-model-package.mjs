import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'

const root = path.resolve(import.meta.dirname, '..')
const appVersion = process.argv[2]
const packageVersion = process.env.TTS_PACKAGE_VERSION || '1.0.0'
const sourceRoot = path.join(root, 'model-assets', 'tts')
const outputRoot = path.join(root, 'dist')
const packageId = 'pocket-tts-en'

if (!appVersion) throw new Error('缺少当前应用版本参数')

const sourceFiles = [
  {
    source: 'model.safetensors',
    path: 'model/model.safetensors',
    kind: 'model-weights'
  },
  { source: 'tokenizer.model', path: 'tokenizer/tokenizer.model', kind: 'tokenizer' },
  ...['alba', 'marius', 'javert', 'fantine', 'cosette', 'eponine', 'azelma'].map((id) => ({
    source: `voices/${id}.safetensors`,
    path: `voices/${id}.safetensors`,
    kind: 'voice'
  }))
]

const assets = sourceFiles.map((file) => {
  const bytes = new Uint8Array(readFileSync(path.join(sourceRoot, file.source)))
  return {
    ...file,
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
})

const manifest = {
  format: 'ls101.tts-model-package',
  formatVersion: 1,
  package: {
    id: packageId,
    version: packageVersion,
    name: 'Pocket TTS English'
  },
  runtime: {
    engine: 'pocket-tts',
    engineApiVersion: 1,
    minimumAppVersion: appVersion
  },
  assets: assets.map(({ path: assetPath, kind, size, sha256 }) => ({
    path: assetPath,
    kind,
    size,
    sha256
  })),
  models: [
    {
      id: 'pocket-tts-en-v1',
      name: 'Pocket TTS English',
      languageCodes: ['en', 'en-US'],
      artifacts: {
        weights: ['model/model.safetensors'],
        tokenizer: ['tokenizer/tokenizer.model']
      },
      parameters: {
        load: { quantization: 'f32' },
        audio: { sampleRate: 24000 },
        synthesis: {
          maxTokensPerChunk: 50,
          silenceBetweenChunksMs: 200,
          temperature: 0.7,
          padShortInputs: false,
          removeSemicolons: false
        }
      }
    }
  ],
  voices: ['alba', 'marius', 'javert', 'fantine', 'cosette', 'eponine', 'azelma'].map((id) => ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    languageCodes: ['en', 'en-US'],
    files: [`voices/${id}.safetensors`]
  }))
}

const entries = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) }
for (const asset of assets) entries[asset.path] = asset.bytes

mkdirSync(outputRoot, { recursive: true })
const outputPath = path.join(outputRoot, `${packageId}-${packageVersion}.zip`)
writeFileSync(outputPath, zipSync(entries, { level: 0 }))
console.log(`[tts] model package written: ${outputPath}`)
