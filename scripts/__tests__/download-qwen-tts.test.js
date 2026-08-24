/* eslint-disable @typescript-eslint/explicit-function-return-type */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')

const modulePromise = import('../qwen-tts/download-release-assets.mjs')

test('selects runtime-only downloads for product documentation setup', async () => {
  const { downloadMode } = await modulePromise

  assert.equal(downloadMode({}), 'all')
  assert.equal(downloadMode({ LS101_QWEN_TTS_RUNTIME_ONLY: '1' }), 'runtime-only')
  assert.equal(
    downloadMode({
      LS101_QWEN_TTS_RUNTIME_ONLY: '1',
      LS101_SKIP_QWEN_TTS_DOWNLOAD: '1'
    }),
    'skip'
  )
})

test('skip mode exits before cleaning locally built CUDA runtime files', async (context) => {
  const { main } = await modulePromise
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'qwen-runtime-skip-'))
  context.after(() => rm(runtimeRoot, { recursive: true, force: true }))
  const linuxDirectory = path.join(runtimeRoot, 'linux-x64')
  const windowsDirectory = path.join(runtimeRoot, 'win32-x64')
  const cudaFiles = [
    path.join(linuxDirectory, 'ls101-qwen-tts-helper-cuda'),
    path.join(windowsDirectory, 'ls101-qwen-tts-helper-cuda.exe'),
    path.join(windowsDirectory, 'cublas64_12.dll')
  ]
  await Promise.all([
    mkdir(linuxDirectory, { recursive: true }),
    mkdir(windowsDirectory, { recursive: true })
  ])
  await Promise.all(cudaFiles.map((file) => writeFile(file, 'locally built cuda runtime')))

  await main({ environment: { LS101_SKIP_QWEN_TTS_DOWNLOAD: '1' }, runtimeRoot })

  await Promise.all(cudaFiles.map((file) => access(file)))
})

test('selects the pinned platform helper from runtime release metadata', async () => {
  const { runtimeTarget, selectRuntimeReleaseAssets } = await modulePromise
  const target = runtimeTarget('linux', 'x64')
  const digest = 'a'.repeat(64)
  const release = {
    tag_name: 'qwen-tts-runtime-v0.3.1',
    draft: false,
    prerelease: true,
    assets: [
      ...Object.values(target.helpers).map((helper) => asset(helper.name, digest)),
      asset('qwen-tts-runtime-manifest.json', digest)
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
      name: 'qwen-tts-runtime-manifest.json',
      size: 1,
      digest,
      url: 'https://example.test/qwen-tts-runtime-manifest.json'
    }
  })
})

test('selects raw models independently from model release metadata', async () => {
  const { modelAssetNames, selectModelReleaseAssets } = await modulePromise
  const modelNames = modelAssetNames()
  const digest = 'b'.repeat(64)
  const release = {
    tag_name: 'qwen-tts-model-v1.0.0',
    draft: false,
    prerelease: true,
    assets: [
      asset(modelNames.talker, digest),
      asset(modelNames.tokenizer, digest),
      asset('qwen-tts-model-manifest.json', digest)
    ]
  }

  assert.deepEqual(selectModelReleaseAssets(release), {
    models: {
      talker: {
        name: modelNames.talker,
        size: 1,
        digest,
        url: `https://example.test/${modelNames.talker}`
      },
      tokenizer: {
        name: modelNames.tokenizer,
        size: 1,
        digest,
        url: `https://example.test/${modelNames.tokenizer}`
      }
    },
    manifest: {
      name: 'qwen-tts-model-manifest.json',
      size: 1,
      digest,
      url: 'https://example.test/qwen-tts-model-manifest.json'
    }
  })
})

test('uses repository-pinned release sizes and hashes for normal setup', async () => {
  const { pinnedModelReleaseAssets, pinnedRuntimeReleaseAssets, runtimeTarget } =
    await modulePromise
  const runtime = pinnedRuntimeReleaseAssets(runtimeTarget('linux', 'x64'))
  const models = pinnedModelReleaseAssets()
  const selected = [
    ...Object.values(runtime.helpers),
    runtime.manifest,
    ...Object.values(models.models),
    models.manifest
  ]

  for (const asset of selected) {
    assert.equal(Number.isSafeInteger(asset.size) && asset.size > 0, true)
    assert.match(asset.digest, /^[a-f0-9]{64}$/)
    assert.match(asset.url, /^https:\/\/github\.com\/zzsqjdhqgb\/cyez-ls101\/releases\/download\//)
  }
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
  const directory = await mkdtemp(path.join(tmpdir(), 'qwen-runtime-copy-'))
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
        name: 'ls101-qwen-tts-helper-cpu-win32-x64.exe',
        executable: 'ls101-qwen-tts-helper-cpu.exe'
      }
    }
  })
})

test('selects only the CPU helper and manifest for the Windows runtime', async () => {
  const { runtimeTarget, selectRuntimeReleaseAssets } = await modulePromise
  const target = runtimeTarget('win32', 'x64')
  const digest = 'c'.repeat(64)
  const release = {
    tag_name: 'qwen-tts-runtime-v0.3.1',
    draft: false,
    prerelease: true,
    assets: [
      asset(target.helpers.cpu.name, digest),
      asset('qwen-tts-runtime-manifest.json', digest)
    ]
  }

  const selected = selectRuntimeReleaseAssets(release, target)
  assert.deepEqual(Object.keys(selected.helpers), ['cpu'])
  assert.deepEqual(selected.dependencies, [])
  assert.deepEqual(selected.licenses, [])
})

test('lists staged CUDA files that setup must remove while CUDA packaging is disabled', async () => {
  const { disabledCudaRuntimeFiles } = await modulePromise

  assert.deepEqual(disabledCudaRuntimeFiles('linux'), ['ls101-qwen-tts-helper-cuda'])
  assert.deepEqual(disabledCudaRuntimeFiles('win32'), [
    'ls101-qwen-tts-helper-cuda.exe',
    'cublas64_12.dll',
    'cublasLt64_12.dll',
    'nvJitLink_120_0.dll',
    'LICENSE.NVIDIA-CUDA.html'
  ])
})

test('removes staged CUDA files for every platform without removing CPU helpers', async (context) => {
  const { cleanupStagedCudaRuntimes, disabledCudaRuntimeFiles } = await modulePromise
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'qwen-runtime-'))
  context.after(() => rm(runtimeRoot, { recursive: true, force: true }))
  const linuxDirectory = path.join(runtimeRoot, 'linux-x64')
  const windowsDirectory = path.join(runtimeRoot, 'win32-x64')
  await Promise.all([
    mkdir(linuxDirectory, { recursive: true }),
    mkdir(windowsDirectory, { recursive: true })
  ])
  const linuxCudaHelper = path.join(linuxDirectory, 'ls101-qwen-tts-helper-cuda')
  const windowsCpuHelper = path.join(windowsDirectory, 'ls101-qwen-tts-helper-cpu.exe')
  const windowsCudaFiles = disabledCudaRuntimeFiles('win32').map((file) =>
    path.join(windowsDirectory, file)
  )
  await Promise.all([
    writeFile(linuxCudaHelper, 'cuda'),
    writeFile(windowsCpuHelper, 'cpu'),
    ...windowsCudaFiles.map((file) => writeFile(file, 'cuda'))
  ])

  await cleanupStagedCudaRuntimes(runtimeRoot)

  await access(windowsCpuHelper)
  await assert.rejects(access(linuxCudaHelper))
  await Promise.all(windowsCudaFiles.map((file) => assert.rejects(access(file))))
})

test('rejects assets without the GitHub API digest', async () => {
  const { selectModelReleaseAssets } = await modulePromise
  assert.throws(
    () =>
      selectModelReleaseAssets({
        tag_name: 'qwen-tts-model-v1.0.0',
        draft: false,
        prerelease: true,
        assets: [
          asset('qwen3-tts-0.6b-q8_0.gguf', 'missing'),
          asset('qwen3-tts-tokenizer-f16.gguf', 'a'.repeat(64)),
          asset('qwen-tts-model-manifest.json', 'a'.repeat(64))
        ]
      }),
    /缺少 SHA-256 digest/
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
