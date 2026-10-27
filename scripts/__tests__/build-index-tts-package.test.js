const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { afterEach, test } = require('node:test')
const { unzipSync, strFromU8 } = require('fflate')

const execFileAsync = promisify(execFile)
const MODEL_FILE_NAME = 'index-tts2_5-q8_0.gguf'
const LICENSE_TEXT_NAMES = [
  'LICENSE.IndexTTS.txt',
  'DISCLAIMER.IndexTTS.txt',
  'LICENSE.audio-cpp.txt'
]

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
  const model = 'model-bytes'
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, MODEL_FILE_NAME), model),
    writeFile(path.join(voicesDir, 'american-man.wav'), referenceWav()),
    writeFile(path.join(voicesDir, 'american-woman.wav'), referenceWav())
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  const result = await buildPackage({
    ...parseOptions([
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
    ]),
    expectedModel: expectedModelFor(model)
  })

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
  assert.equal(manifest.assets.length, 6)
  assert.deepEqual(
    manifest.assets.map((asset) => asset.kind).sort(),
    [
      'license-text',
      'license-text',
      'license-text',
      'speaker-reference',
      'speaker-reference',
      'tts-model'
    ].sort()
  )
  assert.equal(zip['voices/american-man.wav'].byteLength, 44)
  assert.equal(zip['voices/american-woman.wav'].byteLength, 44)
  assert.equal(zip[`models/${MODEL_FILE_NAME}`].byteLength, model.length)
  assert.equal(
    manifest.assets.find((asset) => asset.kind === 'tts-model').sha256,
    expectedModelFor(model).sha256
  )
})

test('embeds the repository license texts with matching manifest entries', async () => {
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-licenses-',
    'model-bytes'
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  const result = await buildPackage({
    ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output]),
    expectedModel: expectedModelFor('model-bytes')
  })

  const zip = unzipSync(new Uint8Array(await readFile(output)))
  const licensesDirectory = path.join(__dirname, '..', '..', 'native', 'index-tts', 'licenses')
  for (const name of LICENSE_TEXT_NAMES) {
    const source = new Uint8Array(await readFile(path.join(licensesDirectory, name)))
    const entry = zip[`licenses/${name}`]
    assert.ok(entry, `package must contain licenses/${name}`)
    assert.deepEqual(entry, source)
    const asset = result.manifest.assets.find((candidate) => candidate.path === `licenses/${name}`)
    assert.equal(asset.kind, 'license-text')
    assert.equal(asset.size, source.byteLength)
    assert.equal(asset.sha256, createHash('sha256').update(source).digest('hex'))
  }
})

test('rejects a missing or empty license text before any package bytes are written', async () => {
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-missing-license-',
    'model-bytes'
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')
  const options = {
    ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output]),
    expectedModel: expectedModelFor('model-bytes')
  }

  await assert.rejects(
    buildPackage({ ...options, licensesDir: path.join(modelDir, 'missing-licenses') }),
    /Required license text is missing or empty/
  )
  const emptyLicensesDirectory = path.join(modelDir, 'empty-licenses')
  await mkdir(emptyLicensesDirectory)
  await Promise.all(
    LICENSE_TEXT_NAMES.map((name) => writeFile(path.join(emptyLicensesDirectory, name), ''))
  )
  await assert.rejects(
    buildPackage({ ...options, licensesDir: emptyLicensesDirectory }),
    /Required license text is missing or empty/
  )
  assert.equal(await fileExists(output), false)
})

test('rejects reference audio outside the accepted size range', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-package-invalid-'))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  await Promise.all([
    writeFile(path.join(modelDir, MODEL_FILE_NAME), 'model'),
    writeFile(path.join(voicesDir, 'too-small.wav'), Buffer.alloc(12)),
    writeFile(path.join(voicesDir, 'too-large.wav'), Buffer.alloc(33 * 1024 * 1024))
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage({
      ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir]),
      expectedModel: expectedModelFor('model')
    }),
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
    writeFile(path.join(modelDir, MODEL_FILE_NAME), 'model'),
    writeFile(path.join(otherVoices, 'custom.wav'), referenceWav())
  ])
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  const result = await buildPackage({
    ...parseOptions([
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
    ]),
    expectedModel: expectedModelFor('model')
  })

  assert.deepEqual(result.manifest.voices, [
    { id: 'narrator', name: 'Exam Narrator', languageCodes: ['en'], files: ['voices/narrator.wav'] }
  ])
  assert.equal(result.manifest.package.id, 'index-tts-custom')
})

test('rejects a truncated GGUF model before any package bytes are written', async () => {
  const complete = Buffer.alloc(64, 1)
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-truncated-',
    complete.subarray(0, 32)
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage({
      ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output]),
      expectedModel: expectedModelFor(complete)
    }),
    /实际 32 字节，应为 64 字节/
  )
  assert.equal(await fileExists(output), false)
})

test('rejects a tampered GGUF model whose size still matches', async () => {
  const authentic = Buffer.alloc(64, 1)
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-tampered-',
    Buffer.alloc(64, 2)
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage({
      ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output]),
      expectedModel: expectedModelFor(authentic)
    }),
    /SHA-256 不匹配/
  )
  assert.equal(await fileExists(output), false)
})

test('rejects a GGUF model that does not match the pinned assets.json values', async () => {
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-unpinned-',
    'model-bytes'
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')
  const pinned = JSON.parse(
    await readFile(path.join(__dirname, '..', 'index-tts', 'assets.json'), 'utf8')
  ).model

  await assert.rejects(
    buildPackage(
      parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output])
    ),
    new RegExp(`实际 11 字节，应为 ${pinned.size} 字节`)
  )
  assert.equal(await fileExists(output), false)
})

test('rejects an invalid pinned model expectation', async () => {
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-bad-pin-',
    'model-bytes'
  )
  const { buildPackage, parseOptions } = await import('../index-tts/build-package.mjs')

  await assert.rejects(
    buildPackage({
      ...parseOptions(['--model-dir', modelDir, '--voices-dir', voicesDir, '--output', output]),
      expectedModel: { size: 11, sha256: 'not-a-sha256' }
    }),
    /固定校验值无效/
  )
})

test('exits non-zero from the CLI when the model fails verification', async () => {
  const { modelDir, voicesDir, output } = await packageFixture(
    'index-tts-package-cli-',
    'model-bytes'
  )

  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(__dirname, '..', 'index-tts', 'build-package.mjs'),
      '--model-dir',
      modelDir,
      '--voices-dir',
      voicesDir,
      '--output',
      output
    ]),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /大小不符/)
      return true
    }
  )
  assert.equal(await fileExists(output), false)
})

test('prepare-package rejects a truncated model without replacing the previous package', async () => {
  const { modelDir, voicesDir, voice, output } = await packageFixture(
    'index-tts-prepare-truncated-',
    'model-bytes'
  )
  await writeFile(output, 'previous-package')
  const { preparePackage } = await import('../index-tts/prepare-package.mjs')

  await assert.rejects(
    preparePackage({
      environment: {},
      modelDir,
      voicesDir,
      voices: [{ id: 'american-man', name: 'American Man', file: voice }],
      output
    }),
    /大小不符/
  )
  assert.equal(await fileExists(`${output}.part`), false)
  assert.equal(await readFile(output, 'utf8'), 'previous-package')
})

test('prepare-package rejects a same-size tampered model via the pinned SHA-256', async () => {
  const authentic = Buffer.alloc(48, 1)
  const { modelDir, voicesDir, voice, output } = await packageFixture(
    'index-tts-prepare-tampered-',
    Buffer.alloc(48, 2)
  )
  const { preparePackage } = await import('../index-tts/prepare-package.mjs')

  await assert.rejects(
    preparePackage({
      environment: {},
      modelDir,
      voicesDir,
      voices: [{ id: 'american-man', name: 'American Man', file: voice }],
      output,
      expectedModel: expectedModelFor(authentic)
    }),
    /SHA-256 不匹配/
  )
  assert.equal(await fileExists(`${output}.part`), false)
})

test('prepare-package writes a package whose manifest matches the verified model', async () => {
  const model = Buffer.alloc(48, 3)
  const { modelDir, voicesDir, voice, output } = await packageFixture(
    'index-tts-prepare-verified-',
    model
  )
  const { preparePackage } = await import('../index-tts/prepare-package.mjs')

  const result = await preparePackage({
    environment: {},
    modelDir,
    voicesDir,
    voices: [{ id: 'american-man', name: 'American Man', file: voice }],
    output,
    expectedModel: expectedModelFor(model)
  })

  assert.equal(result.outputPath, output)
  assert.equal(await fileExists(`${output}.part`), false)
  const zip = unzipSync(new Uint8Array(await readFile(output)))
  const manifest = JSON.parse(strFromU8(zip['manifest.json']))
  const modelAsset = manifest.assets.find((asset) => asset.kind === 'tts-model')
  assert.equal(modelAsset.size, model.length)
  assert.equal(modelAsset.sha256, expectedModelFor(model).sha256)
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

function expectedModelFor(bytes) {
  return {
    size: Buffer.byteLength(bytes),
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

async function fileExists(file) {
  return stat(file).then(
    () => true,
    () => false
  )
}

async function packageFixture(prefix, modelBytes) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  const modelDir = path.join(directory, 'models')
  const voicesDir = path.join(directory, 'voices')
  await Promise.all([mkdir(modelDir), mkdir(voicesDir)])
  const voice = path.join(voicesDir, 'american-man.wav')
  await Promise.all([
    writeFile(path.join(modelDir, MODEL_FILE_NAME), modelBytes),
    writeFile(voice, referenceWav())
  ])
  return { directory, modelDir, voicesDir, voice, output: path.join(directory, 'index-tts.zip') }
}
