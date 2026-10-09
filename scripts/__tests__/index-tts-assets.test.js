const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { afterEach, test } = require('node:test')
const { unzipSync } = require('fflate')

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-assets-'))
  directories.push(directory)
  const { loadConfig } = await import('../index-tts/config.mjs')
  const config = structuredClone(loadConfig())
  const model = Buffer.from('GGUF fixture')
  const modelFile = path.join(directory, 'model.gguf')
  await writeFile(modelFile, model)
  config.model.size = model.length
  config.model.sha256 = sha256(model)
  return { directory, config, modelFile }
}

test('streams one GGUF and variable reference WAVs into a verified importable package', async () => {
  const { directory, config, modelFile } = await fixture()
  const { buildPackage } = await import('../index-tts/build-package.mjs')
  const output = path.join(directory, 'model.zip')
  const { manifest } = await buildPackage({ model: modelFile, output, config })
  assert.equal(manifest.runtime.engine, 'index-tts')
  assert.equal(manifest.models.length, 1)
  assert.equal(manifest.voices.length, 2)
  assert.equal(manifest.models[0].parameters.synthesis.language, 'auto')
  const zip = unzipSync(await readFile(output))
  assert.equal(zip['models/' + config.model.file].length, config.model.size)
  assert.equal(
    Object.keys(zip).some((name) => /\.exe$|\.dll$|\.so$/.test(name)),
    false
  )
  for (const asset of manifest.assets) {
    assert.equal(zip[asset.path].length, asset.size)
    assert.equal(sha256(zip[asset.path]), asset.sha256)
  }
  assert.equal(
    Object.keys(zip).some((name) => name.startsWith('provenance/')),
    true
  )
  assert.equal(
    Object.keys(zip).some((name) => name.startsWith('licenses/')),
    true
  )
})

test('failed model integrity preserves an existing ZIP and cleans partial output', async () => {
  const { directory, config, modelFile } = await fixture()
  const { buildPackage } = await import('../index-tts/build-package.mjs')
  const output = path.join(directory, 'model.zip')
  await writeFile(output, 'previous')
  config.model.sha256 = '0'.repeat(64)
  await assert.rejects(buildPackage({ model: modelFile, output, config }), /integrity/)
  assert.equal(await readFile(output, 'utf8'), 'previous')
  const { readdir } = require('node:fs/promises')
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith('.part')),
    false
  )
})

test('checks 4 GiB ZIP boundary before reading or creating an archive', async () => {
  const { directory, config, modelFile } = await fixture()
  const { buildPackage } = await import('../index-tts/build-package.mjs')
  const { truncate } = require('node:fs/promises')
  await truncate(modelFile, 0x100000000)
  config.model.size = 0x100000000
  const output = path.join(directory, 'oversized.zip')
  await assert.rejects(buildPackage({ model: modelFile, output, config }), /4 GiB/)
  await assert.rejects(stat(output), { code: 'ENOENT' })
})

test('rejects malformed and non-finite reference audio', async () => {
  const { validateReferenceWav } = await import('../index-tts/build-package.mjs')
  const bytes = Buffer.alloc(48)
  bytes.write('RIFF')
  bytes.writeUInt32LE(40, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(3, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24)
  bytes.writeUInt32LE(96000, 28)
  bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(32, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(4, 40)
  validateReferenceWav(bytes)
  bytes.writeFloatLE(NaN, 44)
  assert.throws(() => validateReferenceWav(bytes), /finite/)
  bytes.writeUInt32LE(0xffffffff, 40)
  assert.throws(() => validateReferenceWav(bytes), /WAV/)
})

test('selects only pinned platform assets and rejects missing dependency metadata', async () => {
  const { selectRuntimeAssets } = await import('../index-tts/download-release-assets.mjs')
  const release = {
    repository: 'owner/repo',
    tag: 'v1',
    assets: [
      {
        target: 'linux-x64',
        path: 'ls101-index-tts-helper-cuda',
        name: 'helper-linux',
        size: 1,
        sha256: 'a'.repeat(64)
      },
      {
        target: 'win32-x64',
        path: 'ls101-index-tts-helper-cuda.exe',
        name: 'helper-win.exe',
        size: 2,
        sha256: 'b'.repeat(64)
      }
    ]
  }
  assert.equal(selectRuntimeAssets({ runtimeRelease: release }, 'linux-x64').length, 1)
  assert.throws(() => selectRuntimeAssets({ runtimeRelease: release }, 'other'), /No pinned/)
  release.assets.push({ target: 'linux-x64', path: 'libaudiocpp.so', name: 'library', size: 1 })
  assert.throws(
    () => selectRuntimeAssets({ runtimeRelease: release }, 'linux-x64'),
    /Invalid pinned/
  )
})

test('skip and unpublished setup preserve local runtime files without network requests', async () => {
  const { directory, config } = await fixture()
  const { main } = await import('../index-tts/download-release-assets.mjs')
  const file = path.join(directory, 'local-helper')
  await writeFile(file, 'local')
  const previousFetch = global.fetch
  global.fetch = () => {
    throw new Error('Unexpected network request')
  }
  try {
    await main({
      config,
      externalRoot: directory,
      boundary: directory,
      environment: { LS101_SKIP_INDEX_TTS_DOWNLOAD: '1' }
    })
    await main({ config, externalRoot: directory, boundary: directory, environment: {} })
    assert.equal(await readFile(file, 'utf8'), 'local')
  } finally {
    global.fetch = previousFetch
  }
})

test('splits model releases below GitHub limits and reconstructs exactly, preserving output on corruption', async () => {
  const { directory, config, modelFile } = await fixture()
  const { assembleModelParts, modelReleaseParts, splitModelForRelease } =
    await import('../index-tts/model-release.mjs')
  const outputDirectory = path.join(directory, 'release')
  const manifest = await splitModelForRelease({
    model: modelFile,
    outputDirectory,
    config,
    partSize: 4
  })
  config.modelRelease.parts = manifest.release.parts
  const parts = modelReleaseParts(config)
  assert.equal(parts.length, 3)
  assert.deepEqual(
    parts.map(({ size }) => size),
    [4, 4, 4]
  )
  const destination = path.join(directory, 'assembled.gguf')
  await assembleModelParts({ parts, directory: outputDirectory, destination, model: config.model })
  assert.deepEqual(await readFile(destination), await readFile(modelFile))
  await writeFile(path.join(outputDirectory, parts[1].name), 'bad!')
  await assert.rejects(
    assembleModelParts({ parts, directory: outputDirectory, destination, model: config.model }),
    /integrity/
  )
  assert.deepEqual(await readFile(destination), await readFile(modelFile))
  const { readdir } = require('node:fs/promises')
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith('.part')),
    false
  )
  config.modelRelease.parts[0].size = 2 * 1024 ** 3
  assert.throws(() => modelReleaseParts(config), /Invalid pinned/)
})

test('rejects corrupt model input before publishing parts and never overwrites an earlier release', async () => {
  const { directory, config, modelFile } = await fixture()
  const { splitModelForRelease } = await import('../index-tts/model-release.mjs')
  const outputDirectory = path.join(directory, 'release')
  config.model.sha256 = '0'.repeat(64)
  await assert.rejects(
    splitModelForRelease({ model: modelFile, outputDirectory, config, partSize: 4 }),
    /integrity/
  )
  await assert.rejects(stat(outputDirectory), { code: 'ENOENT' })
  config.model.sha256 = sha256(await readFile(modelFile))
  await splitModelForRelease({ model: modelFile, outputDirectory, config, partSize: 4 })
  await assert.rejects(
    splitModelForRelease({ model: modelFile, outputDirectory, config, partSize: 4 }),
    /already exists/
  )
})

test('downloads pinned release parts, verifies the full model and repairs it from offline cache', async () => {
  const { directory, config, modelFile } = await fixture()
  const { splitModelForRelease } = await import('../index-tts/model-release.mjs')
  const { main } = await import('../index-tts/download-release-assets.mjs')
  const releaseDirectory = path.join(directory, 'release')
  const manifest = await splitModelForRelease({
    model: modelFile,
    outputDirectory: releaseDirectory,
    config,
    partSize: 4
  })
  config.modelRelease = { ...manifest.release, published: true }
  const contents = new Map(
    await Promise.all(
      manifest.release.parts.map(async (part) => [
        part.name,
        await readFile(path.join(releaseDirectory, part.name))
      ])
    )
  )
  const previousFetch = global.fetch
  let calls = 0
  global.fetch = async (url) => {
    calls += 1
    const bytes = contents.get(new URL(url).pathname.split('/').at(-1))
    assert.ok(bytes, `Unexpected release asset: ${url}`)
    return new Response(bytes)
  }
  const options = {
    config,
    externalRoot: path.join(directory, 'downloaded'),
    boundary: directory,
    arguments: ['--models-only', '--verify'],
    environment: {}
  }
  try {
    await main(options)
    assert.equal(calls, 3)
    const installed = path.join(options.externalRoot, 'models', config.model.file)
    assert.deepEqual(await readFile(installed), await readFile(modelFile))
    global.fetch = () => {
      throw new Error('Offline')
    }
    await writeFile(installed, 'broken')
    await main(options)
    assert.deepEqual(await readFile(installed), await readFile(modelFile))
  } finally {
    global.fetch = previousFetch
  }
})

test('pinned model cache verifies offline, repairs corruption and stages runtime atomically', async () => {
  const { directory, config } = await fixture()
  const { main } = await import('../index-tts/download-release-assets.mjs')
  const previousFetch = global.fetch
  const payload = Buffer.from('GGUF fixture')
  const helper = Buffer.from('helper')
  config.runtimeRelease.published = true
  config.runtimeRelease.assets = [
    {
      target: 'linux-x64',
      name: 'helper-linux',
      path: 'ls101-index-tts-helper-cuda',
      size: helper.length,
      sha256: sha256(helper)
    }
  ]
  let calls = 0
  global.fetch = async (url) => {
    calls += 1
    return new Response(String(url).includes('helper-linux') ? helper : payload)
  }
  const options = {
    config,
    externalRoot: directory,
    boundary: directory,
    platform: 'linux',
    arch: 'x64',
    environment: {}
  }
  try {
    await main(options)
    assert.equal(calls, 2)
    global.fetch = () => {
      throw new Error('Offline')
    }
    await main({ ...options, arguments: ['--verify'] })
    const file = path.join(directory, 'runtime/linux-x64/ls101-index-tts-helper-cuda')
    assert.equal(await readFile(file, 'utf8'), 'helper')
    await writeFile(file, 'broken')
    await main({ ...options, arguments: ['--verify'] })
    assert.equal(await readFile(file, 'utf8'), 'helper')
  } finally {
    global.fetch = previousFetch
  }
})
