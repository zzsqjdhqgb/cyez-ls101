const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function fixture(target = 'linux-x64') {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-runtime 产物 '))
  directories.push(directory)
  const { loadConfig } = await import('../index-tts/config.mjs')
  const config = loadConfig()
  const artifactDirectory = path.join(directory, 'download')
  const runtimeRoot = path.join(directory, 'runtime')
  await mkdir(artifactDirectory)
  const windows = target === 'win32-x64'
  const names = windows
    ? [
        'ls101-index-tts-helper-cuda.exe',
        'audiocpp.dll',
        'cublas64_12.dll',
        'cublasLt64_12.dll',
        'cudart64_12.dll',
        'cufft64_11.dll',
        'nvJitLink_120_0.dll',
        'msvcp140.dll',
        'vcruntime140.dll'
      ]
    : [
        'ls101-index-tts-helper-cuda',
        'libaudiocpp.so',
        'libcublas.so.12',
        'libcublasLt.so.12',
        'libcudart.so.12',
        'libcufft.so.11',
        'libnvJitLink.so.12'
      ]
  names.push('LICENSE.NVIDIA-CUDA.html', 'build-cuda.json')
  const build = {
    sourceCommit: config.runtime.revision,
    ggmlTree: config.runtime.ggmlTree,
    backend: 'cuda',
    target,
    cudaArchitectures: config.runtime.cudaArchitectures
  }
  const manifest = {
    revision: config.runtime.revision,
    ggmlTree: config.runtime.ggmlTree,
    assets: []
  }
  for (const filename of names) {
    const bytes = Buffer.from(
      filename === 'build-cuda.json' ? JSON.stringify(build) : `fixture ${filename}`
    )
    const name = `${target}-${filename}`
    await writeFile(path.join(artifactDirectory, name), bytes)
    manifest.assets.push({ target, name, path: filename, size: bytes.length, sha256: hash(bytes) })
  }
  const writeManifest = () =>
    writeFile(path.join(artifactDirectory, `${target}-manifest.json`), JSON.stringify(manifest))
  await writeManifest()
  const destination = path.join(runtimeRoot, target)
  await mkdir(destination, { recursive: true })
  await writeFile(path.join(destination, 'previous-runtime'), 'preserve me')
  return {
    directory,
    artifactDirectory,
    runtimeRoot,
    target,
    config,
    manifest,
    writeManifest,
    destination
  }
}

test('installs verified CI files under their runtime names and replaces the complete old directory', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  for (const target of ['linux-x64', 'win32-x64']) {
    const options = await fixture(target)
    let probes = 0
    const result = await installRuntime({
      ...options,
      probe: async (directory) => {
        probes++
        assert.ok(
          (await readdir(directory)).includes(
            target === 'linux-x64'
              ? 'ls101-index-tts-helper-cuda'
              : 'ls101-index-tts-helper-cuda.exe'
          )
        )
        return { status: 'passed' }
      }
    })
    assert.equal(probes, 1)
    assert.deepEqual(result.manifest, options.manifest)
    assert.deepEqual(
      JSON.parse(await readFile(path.join(options.destination, 'artifact-manifest.json'), 'utf8')),
      options.manifest
    )
    assert.equal((await readdir(options.destination)).includes('previous-runtime'), false)
    assert.deepEqual(await readdir(options.runtimeRoot), [target])
    if (target === 'linux-x64')
      assert.equal(
        (await stat(path.join(options.destination, 'ls101-index-tts-helper-cuda'))).mode & 0o111,
        0o111
      )
  }
})

test('corrupt artifacts preserve the old runtime and never start a probe', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  const options = await fixture()
  const asset = options.manifest.assets[0]
  await writeFile(path.join(options.artifactDirectory, asset.name), Buffer.alloc(asset.size, 120))
  await assert.rejects(
    installRuntime({ ...options, probe: () => assert.fail('Probe started') }),
    /SHA-256/
  )
  assert.equal(
    await readFile(path.join(options.destination, 'previous-runtime'), 'utf8'),
    'preserve me'
  )
  assert.deepEqual(await readdir(options.runtimeRoot), [options.target])
})

test('rejects wrong revisions, missing CUDA dependencies and escaping paths before installation', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  for (const mutation of ['revision', 'dependency', 'path']) {
    const options = await fixture()
    if (mutation === 'revision') options.manifest.revision = '0'.repeat(40)
    if (mutation === 'dependency')
      options.manifest.assets = options.manifest.assets.filter(
        (asset) => !asset.path.includes('cufft')
      )
    if (mutation === 'path') options.manifest.assets[1].path = '../escape.so'
    await options.writeManifest()
    await assert.rejects(installRuntime(options), /manifest differs|Missing CUDA|Invalid pinned/)
    assert.deepEqual(await readdir(options.destination), ['previous-runtime'])
  }
})

test('matching digests cannot hide incorrect build metadata', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  const options = await fixture()
  const asset = options.manifest.assets.find((asset) => asset.path === 'build-cuda.json')
  const bytes = Buffer.from(JSON.stringify({ backend: 'cpu' }))
  await writeFile(path.join(options.artifactDirectory, asset.name), bytes)
  Object.assign(asset, { size: bytes.length, sha256: hash(bytes) })
  await options.writeManifest()
  await assert.rejects(installRuntime(options), /build metadata differs/)
  assert.deepEqual(await readdir(options.runtimeRoot), [options.target])
})

test('Windows cuBLAS Lt cannot substitute for the required cuBLAS DLL', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  const options = await fixture('win32-x64')
  options.manifest.assets = options.manifest.assets.filter(
    (asset) => asset.path !== 'cublas64_12.dll'
  )
  await options.writeManifest()
  await assert.rejects(installRuntime(options), /Missing CUDA dependency: cublas/)
  assert.deepEqual(await readdir(options.destination), ['previous-runtime'])
})

test('startup failure leaves the previous runtime intact', async () => {
  const { installRuntime } = await import('../index-tts/install-runtime.mjs')
  const options = await fixture()
  await assert.rejects(
    installRuntime({
      ...options,
      probe: () => {
        throw new Error('DLL load failed')
      }
    }),
    /DLL load failed/
  )
  assert.deepEqual(await readdir(options.runtimeRoot), [options.target])
  assert.deepEqual(await readdir(options.destination), ['previous-runtime'])
})
