const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { strFromU8, unzipSync } = require('fflate')

test('builds the declared AI pronunciation extension package', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-pronunciation-extension-'))
  try {
    const sourceDir = path.join(directory, 'source', 'onnx')
    await mkdir(sourceDir, { recursive: true })
    await Promise.all([
      writeFile(path.join(directory, 'source', 'config.json'), '{}'),
      writeFile(path.join(directory, 'source', 'preprocessor_config.json'), '{}'),
      writeFile(path.join(directory, 'source', 'vocab.json'), '{}'),
      writeFile(path.join(sourceDir, 'model_quantized.onnx'), new Uint8Array([1, 2, 3]))
    ])
    const output = path.join(directory, 'extension.zip')
    const { buildPronunciationExtensionPackage } =
      await import('../build-pronunciation-extension-package.mjs')
    await buildPronunciationExtensionPackage({ sourceDir: path.join(directory, 'source'), output })
    const archive = unzipSync(new Uint8Array(await readFile(output)))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']))
    assert.equal(manifest.format, 'ls101.extension-package')
    assert.deepEqual(manifest.extension, {
      id: 'facebook-wav2vec2-pronunciation',
      version: '1.0.0',
      name: 'AI 语音评测',
      description: 'Facebook Wav2Vec2 phoneme assessment extension.'
    })
    assert.equal(manifest.assets.length, 4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
