/* eslint-disable @typescript-eslint/explicit-function-return-type */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { access, mkdir, mkdtemp, readFile, rm, writeFile, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')

const modulePromise = import('../index-tts/download-release-assets.mjs')

test('selects runtime-only downloads for product documentation setup', async () => {
  const { downloadMode } = await modulePromise

  assert.equal(downloadMode({}), 'all')
  assert.equal(downloadMode({ LS101_INDEX_TTS_RUNTIME_ONLY: '1' }), 'runtime-only')
  assert.equal(
    downloadMode({
      LS101_INDEX_TTS_RUNTIME_ONLY: '1',
      LS101_SKIP_INDEX_TTS_DOWNLOAD: '1'
    }),
    'skip'
  )
})

test('skip mode exits before cleaning locally built CUDA runtime files', async (context) => {
  const { main } = await modulePromise
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'index-tts-skip-'))
  context.after(() => rm(runtimeRoot, { recursive: true, force: true }))
  const linuxDirectory = path.join(runtimeRoot, 'linux-x64')
  const windowsDirectory = path.join(runtimeRoot, 'win32-x64')
  const cudaFiles = [
    path.join(linuxDirectory, 'ls101-index-tts-helper-cuda'),
    path.join(linuxDirectory, 'libcublasLt.so.12'),
    path.join(windowsDirectory, 'ls101-index-tts-helper-cuda.exe'),
    path.join(windowsDirectory, 'cublas64_12.dll'),
    path.join(windowsDirectory, 'cufft64_11.dll')
  ]
  await Promise.all([
    mkdir(linuxDirectory, { recursive: true }),
    mkdir(windowsDirectory, { recursive: true })
  ])
  await Promise.all(cudaFiles.map((file) => writeFile(file, 'locally built cuda runtime')))

  await main({ environment: { LS101_SKIP_INDEX_TTS_DOWNLOAD: '1' }, runtimeRoot })

  await Promise.all(cudaFiles.map((file) => access(file)))
})

test('plans the deterministic 1 GiB split of the pinned model', async () => {
  const { modelPartPlan, modelPartName } = await modulePromise

  assert.deepEqual(modelPartPlan(5, 2), [
    { index: 0, offset: 0, size: 2 },
    { index: 1, offset: 2, size: 2 },
    { index: 2, offset: 4, size: 1 }
  ])
  assert.deepEqual(
    modelPartPlan(3_502_955_328).map((part) => part.size),
    [1_073_741_824, 1_073_741_824, 1_073_741_824, 281_729_856]
  )
  assert.deepEqual(
    modelPartPlan(3_502_955_328).map((part, index) => modelPartName(index)),
    [
      'index-tts2_5-q8_0.gguf.part-0001',
      'index-tts2_5-q8_0.gguf.part-0002',
      'index-tts2_5-q8_0.gguf.part-0003',
      'index-tts2_5-q8_0.gguf.part-0004'
    ]
  )
})

test('merging the planned parts reproduces the original bytes and hashes', async (context) => {
  const { mergeModelParts, modelPartPlan, modelPartName } = await modulePromise
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-merge-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const payload = Buffer.from(
    Array.from({ length: 1000 }, (_, index) => (index * 7 + 13) % 251)
  )
  const model = path.join(directory, 'model.bin')
  await writeFile(model, payload)
  const partsDirectory = path.join(directory, 'parts')
  await mkdir(partsDirectory)
  const partBytes = 300
  const plan = modelPartPlan(payload.byteLength, partBytes)
  const parts = []
  for (const part of plan) {
    const partPath = path.join(partsDirectory, modelPartName(part.index))
    const bytes = payload.subarray(part.offset, part.offset + part.size)
    await writeFile(partPath, bytes)
    parts.push({
      path: partPath,
      size: part.size,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  }
  const destination = path.join(directory, 'merged.bin')

  await mergeModelParts(parts, destination, {
    path: 'merged.bin',
    size: payload.byteLength,
    sha256: createHash('sha256').update(payload).digest('hex')
  })

  assert.deepEqual(await readFile(destination), payload)
})

test('rejects a merge whose parts do not reconstruct the pinned bytes', async (context) => {
  const { mergeModelParts } = await modulePromise
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-bad-merge-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const original = Buffer.from('0123456789')
  const partsDirectory = path.join(directory, 'parts')
  await mkdir(partsDirectory)
  const first = path.join(partsDirectory, 'a')
  const second = path.join(partsDirectory, 'b')
  await writeFile(first, '01234')
  await writeFile(second, '5678X')
  const destination = path.join(directory, 'merged.bin')

  await assert.rejects(
    mergeModelParts(
      [
        { path: first, size: 5, sha256: createHash('sha256').update('01234').digest('hex') },
        { path: second, size: 5, sha256: createHash('sha256').update('5678X').digest('hex') }
      ],
      destination,
      {
        path: 'merged.bin',
        size: original.byteLength,
        sha256: createHash('sha256').update(original).digest('hex')
      }
    ),
    /SHA-256/
  )
  await assert.rejects(access(destination))
})

test('selects the pinned platform helper from runtime release metadata', async () => {
  const { runtimeTarget, selectRuntimeReleaseAssets } = await modulePromise
  const target = runtimeTarget('linux', 'x64')
  const digest = 'a'.repeat(64)
  const release = {
    tag_name: 'index-tts-runtime-v0.1.0',
    draft: false,
    prerelease: true,
    assets: [
      ...Object.values(target.helpers).map((helper) => asset(helper.name, digest)),
      asset('ls101-index-tts-helper-cuda-linux-x64', digest),
      asset('index-tts-runtime-manifest.json', digest)
    ]
  }

  assert.deepEqual(selectRuntimeReleaseAssets(release, target), {
    helpers: Object.fromEntries(
      Object.entries(target.helpers).map(([backend, helper]) => [
        backend,
        { name: helper.name, size: 1, digest, url: `https://example.test/${helper.name}` }
      ])
    ),
    dependencies: [],
    licenses: [],
    manifest: {
      name: 'index-tts-runtime-manifest.json',
      size: 1,
      digest,
      url: 'https://example.test/index-tts-runtime-manifest.json'
    }
  })
})

test('selects the model parts from model release metadata', async () => {
  const { selectModelReleaseAssets, modelPartName } = await modulePromise
  const digest = 'b'.repeat(64)
  const release = {
    tag_name: 'index-tts-model-v1.0.0',
    draft: false,
    prerelease: true,
    assets: [
      asset(modelPartName(0), digest),
      asset(modelPartName(1), digest),
      asset(modelPartName(2), digest),
      asset(modelPartName(3), digest),
      asset('index-tts-model-manifest.json', digest)
    ]
  }

  const selected = selectModelReleaseAssets(release)
  assert.equal(selected.parts.length, 4)
  assert.deepEqual(
    selected.parts.map((part) => part.name),
    [modelPartName(0), modelPartName(1), modelPartName(2), modelPartName(3)]
  )
  assert.equal(selected.manifest.name, 'index-tts-model-manifest.json')
})

test('pins the model parts from the repository configuration', async () => {
  const { pinnedModelReleaseParts } = await modulePromise
  const parts = pinnedModelReleaseParts()

  assert.equal(parts.length, 4)
  for (const part of parts) {
    assert.equal(Number.isSafeInteger(part.size) && part.size > 0, true)
    assert.match(part.digest, /^[a-f0-9]{64}$/)
    assert.match(
      part.url,
      /^https:\/\/github\.com\/zzsqjdhqgb\/cyez-ls101\/releases\/download\/index-tts-model-v1\.0\.0\//
    )
  }
  assert.equal(
    parts.reduce((total, part) => total + part.size, 0),
    3_502_955_328
  )
})

test('only performs expensive verification when explicitly requested', async () => {
  const { parseOptions } = await modulePromise
  assert.deepEqual(parseOptions([]), { verify: false, verifyUpstream: false })
  assert.deepEqual(parseOptions(['--verify']), { verify: true, verifyUpstream: false })
  assert.deepEqual(parseOptions(['--verify-upstream']), {
    verify: false,
    verifyUpstream: true
  })
  assert.throws(() => parseOptions(['--unknown']), /未知参数/)
})

test('atomically replaces a wrong staged runtime path with a verified helper', async (context) => {
  const { copyVerifiedAsset } = await modulePromise
  const directory = await mkdtemp(path.join(tmpdir(), 'index-tts-copy-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'cache', 'helper')
  const destination = path.join(directory, 'runtime', 'helper')
  const content = Buffer.from('verified helper')
  await mkdir(path.dirname(source), { recursive: true })
  await mkdir(destination, { recursive: true })
  await writeFile(source, content)
  const executableMode = process.platform === 'win32' ? undefined : 0o755
  const asset = {
    path: 'helper',
    size: content.byteLength,
    sha256: createHash('sha256').update(content).digest('hex'),
    ...(executableMode === undefined ? {} : { mode: executableMode })
  }

  await copyVerifiedAsset(source, destination, asset)

  assert.deepEqual(await readFile(destination), content)
  if (executableMode !== undefined) {
    assert.equal((await stat(destination)).mode & 0o777, executableMode)
  }
})

test('uses the canonical helper filename on Windows', async () => {
  const { runtimeTarget } = await modulePromise
  assert.deepEqual(runtimeTarget('win32', 'x64'), {
    directory: 'win32-x64',
    dependencies: [],
    licenses: [],
    helpers: {
      cpu: {
        name: 'ls101-index-tts-helper-cpu-win32-x64.exe',
        executable: 'ls101-index-tts-helper-cpu.exe'
      }
    }
  })
})

test('lists the CUDA prefixes setup must remove while CUDA packaging is disabled', async () => {
  const { disabledCudaRuntimePrefixes, matchesDisabledCudaRuntimePrefix } = await modulePromise

  for (const name of ['ls101-index-tts-helper-cuda', 'libcublas.so.12', 'libcufft.so.11']) {
    assert.equal(matchesDisabledCudaRuntimePrefix(name, disabledCudaRuntimePrefixes('linux')), true)
  }
  for (const name of [
    'ls101-index-tts-helper-cuda.exe',
    'cublas64_12.dll',
    'cublasLt64_12.dll',
    'cudart64_12.dll',
    'cufft64_11.dll',
    'nvJitLink_120_0.dll',
    'LICENSE.NVIDIA-CUDA.html'
  ]) {
    assert.equal(matchesDisabledCudaRuntimePrefix(name, disabledCudaRuntimePrefixes('win32')), true)
  }
  for (const name of ['ls101-index-tts-helper-cpu', 'ls101-index-tts-helper-cpu.exe']) {
    assert.equal(matchesDisabledCudaRuntimePrefix(name, disabledCudaRuntimePrefixes('linux')), false)
    assert.equal(
      matchesDisabledCudaRuntimePrefix(name, disabledCudaRuntimePrefixes('win32')),
      false
    )
  }
})

test('removes staged CUDA files for every platform without removing CPU helpers', async (context) => {
  const { cleanupStagedCudaRuntimes } = await modulePromise
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'index-tts-runtime-'))
  context.after(() => rm(runtimeRoot, { recursive: true, force: true }))
  const linuxDirectory = path.join(runtimeRoot, 'linux-x64')
  const windowsDirectory = path.join(runtimeRoot, 'win32-x64')
  await Promise.all([
    mkdir(linuxDirectory, { recursive: true }),
    mkdir(windowsDirectory, { recursive: true })
  ])
  const linuxCudaHelper = path.join(linuxDirectory, 'ls101-index-tts-helper-cuda')
  const linuxCudaLibrary = path.join(linuxDirectory, 'libcublasLt.so.12')
  const windowsCpuHelper = path.join(windowsDirectory, 'ls101-index-tts-helper-cpu.exe')
  const windowsCudaFiles = [
    'ls101-index-tts-helper-cuda.exe',
    'cublas64_12.dll',
    'cublasLt64_12.dll',
    'cudart64_12.dll',
    'cufft64_11.dll',
    'nvJitLink_120_0.dll',
    'LICENSE.NVIDIA-CUDA.html'
  ].map((file) => path.join(windowsDirectory, file))
  await Promise.all([
    writeFile(linuxCudaHelper, 'cuda'),
    writeFile(linuxCudaLibrary, 'cuda'),
    writeFile(windowsCpuHelper, 'cpu'),
    ...windowsCudaFiles.map((file) => writeFile(file, 'cuda'))
  ])

  await cleanupStagedCudaRuntimes(runtimeRoot)

  await access(windowsCpuHelper)
  await assert.rejects(access(linuxCudaHelper))
  await assert.rejects(access(linuxCudaLibrary))
  await Promise.all(windowsCudaFiles.map((file) => assert.rejects(access(file))))
})

test('tolerates missing runtime directories during CUDA cleanup', async () => {
  const { cleanupStagedCudaRuntimes } = await modulePromise
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'index-tts-empty-'))
  await rm(runtimeRoot, { recursive: true, force: true })
  await cleanupStagedCudaRuntimes(runtimeRoot)
})

test('rejects release assets without the GitHub API digest', async () => {
  const { selectModelReleaseAssets } = await modulePromise
  assert.throws(
    () =>
      selectModelReleaseAssets({
        tag_name: 'index-tts-model-v1.0.0',
        draft: false,
        prerelease: true,
        assets: [
          asset('index-tts2_5-q8_0.gguf.part-0001', 'missing'),
          asset('index-tts2_5-q8_0.gguf.part-0002', 'a'.repeat(64)),
          asset('index-tts2_5-q8_0.gguf.part-0003', 'a'.repeat(64)),
          asset('index-tts2_5-q8_0.gguf.part-0004', 'a'.repeat(64)),
          asset('index-tts-model-manifest.json', 'a'.repeat(64))
        ]
      }),
    /缺少 SHA-256 digest/
  )
})

test('points the bootstrap download at the pinned Hugging Face revision', async () => {
  const { upstreamModelAsset } = await modulePromise
  const upstream = upstreamModelAsset()
  assert.equal(upstream.size, 3_502_955_328)
  assert.equal(upstream.sha256, '5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628')
  assert.equal(
    upstream.url,
    'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/9c78726d0d2cf7ee8511e68ef003490c1251062f/IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf'
  )
})

function asset(name, digest) {
  return {
    name,
    size: 1,
    digest: digest === 'missing' ? undefined : `sha256:${digest}`,
    browser_download_url: `https://example.test/${name}`
  }
}
