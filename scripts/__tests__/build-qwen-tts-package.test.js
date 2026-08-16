const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')
const { unzipSync, strFromU8 } = require('fflate')

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('streams a Qwen Base package with a fixed speaker embedding', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qwen-package-test-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  const output = path.join(directory, 'qwen.zip')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, 'qwen3-tts-0.6b-q8_0.gguf'), 'talker'),
    writeFile(path.join(modelDir, 'qwen3-tts-tokenizer-f16.gguf'), 'tokenizer'),
    writeFile(path.join(voicesDir, 'american-woman.spk'), speakerEmbedding())
  ])
  const { buildPackage, parseOptions } = await import('../qwen-tts/build-package.mjs')

  const result = await buildPackage(
    parseOptions([
      '--model-dir',
      modelDir,
      '--voices-dir',
      voicesDir,
      '--voice-name',
      'american-woman=American Woman',
      '--output',
      output
    ])
  )

  assert.equal(result.manifest.runtime.engine, 'qwen-tts')
  assert.equal(result.manifest.models[0].parameters.load.quantization, 'q8_0')
  assert.deepEqual(result.manifest.voices, [
    {
      id: 'american-woman',
      name: 'American Woman',
      languageCodes: ['en'],
      files: ['voices/american-woman.spk']
    }
  ])
  const zip = unzipSync(new Uint8Array(await readFile(output)))
  const manifest = JSON.parse(strFromU8(zip['manifest.json']))
  assert.equal(manifest.assets.length, 3)
  assert.equal(zip['voices/american-woman.spk'].byteLength, 4100)
  assert.equal(zip['models/qwen3-tts-0.6b-q8_0.gguf'].byteLength, 6)
})

test('rejects malformed speaker embeddings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'qwen-package-invalid-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, 'qwen3-tts-0.6b-f16.gguf'), 'talker'),
    writeFile(path.join(modelDir, 'qwen3-tts-tokenizer-f16.gguf'), 'tokenizer'),
    writeFile(path.join(voicesDir, 'bad.spk'), Buffer.alloc(12))
  ])
  const { buildPackage, parseOptions } = await import('../qwen-tts/build-package.mjs')

  await assert.rejects(
    buildPackage(parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir])),
    /4100-byte/
  )
})

function speakerEmbedding() {
  const data = Buffer.alloc(4100)
  data.writeUInt32LE(1024, 0)
  return data
}
