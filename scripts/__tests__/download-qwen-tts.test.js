/* eslint-disable @typescript-eslint/explicit-function-return-type */

const test = require('node:test')
const assert = require('node:assert/strict')

const modulePromise = import('../qwen-tts/download-release-assets.mjs')

test('selects the pinned platform helper and raw models from GitHub metadata', async () => {
  const { modelAssetNames, runtimeTarget, selectReleaseAssets } = await modulePromise
  const target = runtimeTarget('linux', 'x64')
  const modelNames = modelAssetNames()
  const digest = 'a'.repeat(64)
  const release = {
    tag_name: 'qwen-tts-v0.2.0',
    draft: false,
    prerelease: true,
    assets: [
      asset(target.name, digest),
      asset(modelNames.talker, digest),
      asset(modelNames.tokenizer, digest),
      asset('qwen-tts-release-manifest.json', digest)
    ]
  }

  assert.deepEqual(selectReleaseAssets(release, target), {
    helper: { name: target.name, size: 1, digest, url: `https://example.test/${target.name}` },
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
      name: 'qwen-tts-release-manifest.json',
      size: 1,
      digest,
      url: 'https://example.test/qwen-tts-release-manifest.json'
    }
  })
})

test('uses the canonical helper filename on Windows', async () => {
  const { runtimeTarget } = await modulePromise
  assert.deepEqual(runtimeTarget('win32', 'x64'), {
    directory: 'win32-x64',
    name: 'ls101-qwen-tts-helper-win32-x64.exe',
    executable: 'ls101-qwen-tts-helper.exe'
  })
})

test('rejects assets without the GitHub API digest', async () => {
  const { selectReleaseAssets } = await modulePromise
  assert.throws(
    () =>
      selectReleaseAssets(
        {
          tag_name: 'qwen-tts-v0.2.0',
          prerelease: true,
          assets: [
            asset('qwen3-tts-0.6b-q8_0.gguf', 'missing'),
            asset('qwen3-tts-tokenizer-f16.gguf', 'a'.repeat(64)),
            asset('qwen-tts-release-manifest.json', 'a'.repeat(64))
          ]
        },
        null
      ),
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
