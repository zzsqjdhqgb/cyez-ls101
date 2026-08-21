/* eslint-disable @typescript-eslint/explicit-function-return-type */

const test = require('node:test')
const assert = require('node:assert/strict')

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

test('uses the canonical helper filename on Windows', async () => {
  const { runtimeTarget } = await modulePromise
  assert.deepEqual(runtimeTarget('win32', 'x64'), {
    directory: 'win32-x64',
    dependencies: [
      { name: 'cublas64_12.dll', file: 'cublas64_12.dll' },
      { name: 'cublasLt64_12.dll', file: 'cublasLt64_12.dll' },
      { name: 'nvJitLink_120_0.dll', file: 'nvJitLink_120_0.dll' }
    ],
    licenses: [{ name: 'LICENSE.NVIDIA-CUDA.html', file: 'LICENSE.NVIDIA-CUDA.html' }],
    helpers: {
      cpu: {
        name: 'ls101-qwen-tts-helper-cpu-win32-x64.exe',
        executable: 'ls101-qwen-tts-helper-cpu.exe'
      },
      cuda: {
        name: 'ls101-qwen-tts-helper-cuda-win32-x64.exe',
        executable: 'ls101-qwen-tts-helper-cuda.exe'
      }
    }
  })
})

test('selects CUDA DLLs and their license for the Windows runtime', async () => {
  const { runtimeTarget, selectRuntimeReleaseAssets } = await modulePromise
  const target = runtimeTarget('win32', 'x64')
  const digest = 'c'.repeat(64)
  const release = {
    tag_name: 'qwen-tts-runtime-v0.3.1',
    draft: false,
    prerelease: true,
    assets: [
      ...Object.values(target.helpers).map((helper) => asset(helper.name, digest)),
      ...target.dependencies.map((dependency) => asset(dependency.name, digest)),
      ...target.licenses.map((license) => asset(license.name, digest)),
      asset('qwen-tts-runtime-manifest.json', digest)
    ]
  }

  const selected = selectRuntimeReleaseAssets(release, target)
  assert.deepEqual(
    selected.dependencies.map(({ name }) => name),
    ['cublas64_12.dll', 'cublasLt64_12.dll', 'nvJitLink_120_0.dll']
  )
  assert.deepEqual(
    selected.licenses.map(({ name }) => name),
    ['LICENSE.NVIDIA-CUDA.html']
  )
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
