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

test('streams an IndexTTS package with reference-audio voices', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-package-test-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  const output = path.join(directory, 'index-tts.zip')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, 'index-tts2_5-q8_0.gguf'), 'model-bytes'),
    writeFile(path.join(voicesDir, 'american-man.wav'), referenceWav()),
    writeFile(path.join(voicesDir, 'american-woman.wav'), referenceWav())
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  const result = await buildPackage(
    parseOptions([
      '--model-dir',
      modelDir,
      '--voices-dir',
      voicesDir,
      '--voice-name',
      'american-man=American Man',
      '--voice-name',
      'american-woman=American Woman',
      '--output',
      output
    ])
  )

  assert.equal(result.manifest.runtime.engine, 'index-tts')
  assert.equal(result.manifest.runtime.minimumAppVersion, '0.4.2')
  assert.equal(result.manifest.models[0].id, 'index-tts-2.5-q8_0')
  assert.deepEqual(result.manifest.models[0].parameters, {
    load: { threads: 4, device: 0, lowMemory: true },
    synthesis: { language: 'auto', maxTokens: 1500 }
  })
  assert.deepEqual(result.manifest.voices, [
    {
      id: 'american-man',
      name: 'American Man',
      languageCodes: ['en'],
      files: ['voices/american-man.wav']
    },
    {
      id: 'american-woman',
      name: 'American Woman',
      languageCodes: ['en'],
      files: ['voices/american-woman.wav']
    }
  ])
  const zip = unzipSync(new Uint8Array(await readFile(output)))
  const manifest = JSON.parse(strFromU8(zip['manifest.json']))
  assert.equal(manifest.assets.length, 3)
  assert.deepEqual(
    manifest.assets.map((asset) => asset.kind).sort(),
    ['speaker-reference', 'speaker-reference', 'tts-model'].sort()
  )
  assert.equal(zip['voices/american-man.wav'].byteLength, 44)
  assert.equal(zip['voices/american-woman.wav'].byteLength, 44)
  assert.equal(zip['models/index-tts2_5-q8_0.gguf'].byteLength, 'model-bytes'.length)
})

test('rejects reference audio outside the accepted size range', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-package-invalid-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, 'index-tts2_5-q8_0.gguf'), 'model'),
    writeFile(path.join(voicesDir, 'too-small.wav'), Buffer.alloc(12)),
    writeFile(path.join(voicesDir, 'too-large.wav'), Buffer.alloc(33 * 1024 * 1024))
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage(parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir])),
    /44-byte to 32 MiB/
  )
})

test('rejects a missing GGUF model', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-package-missing-'))
  temporaryDirectories.push(directory)
  const voicesDir = path.join(directory, 'voices')
  await mkdir(voicesDir)
  await writeFile(path.join(voicesDir, 'american-man.wav'), referenceWav())
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage(
      parseOptions([
        '--model-dir',
        path.join(directory, 'models'),
        '--voices-dir',
        voicesDir
      ])
    ),
    /Required GGUF model is missing/
  )
})

test('accepts explicit voices that replace directory discovery', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-package-explicit-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const otherVoices = path.join(directory, 'other-voices')
  await Promise.all([mkdir(modelDir), mkdir(otherVoices)])
  await Promise.all([
    writeFile(path.join(modelDir, 'index-tts2_5-q8_0.gguf'), 'model'),
    writeFile(path.join(otherVoices, 'custom.wav'), referenceWav())
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  const result = await buildPackage(
    parseOptions([
      '--model-dir',
      modelDir,
      '--voices-dir',
      path.join(directory, 'empty'),
      '--voice',
      `narrator=${path.join(otherVoices, 'custom.wav')}`,
      '--voice-name',
      'narrator=Exam Narrator',
      '--package-id',
      'index-tts-custom',
      '--output',
      path.join(directory, 'custom.zip')
    ])
  )

  assert.deepEqual(result.manifest.voices, [
    { id: 'narrator', name: 'Exam Narrator', languageCodes: ['en'], files: ['voices/narrator.wav'] }
  ])
  assert.equal(result.manifest.package.id, 'index-tts-custom')
})

function referenceWav() {
  const wav = Buffer.alloc(44)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(22050, 24)
  wav.writeUInt32LE(44100, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(0, 40)
  return wav
}
