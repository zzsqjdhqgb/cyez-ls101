const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { unzipSync, strFromU8 } = require('fflate')

test('builds a Qwen3 ASR model package with verified assets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-asr-package-'))
  try {
    const sourceDir = path.join(directory, 'source')
    const modelDir = path.join(sourceDir, 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25')
    await mkdir(path.join(modelDir, 'tokenizer'), { recursive: true })
    const files = {
      [path.join(modelDir, 'conv_frontend.onnx')]: 'frontend',
      [path.join(modelDir, 'encoder.int8.onnx')]: 'encoder',
      [path.join(modelDir, 'decoder.int8.onnx')]: 'decoder',
      [path.join(modelDir, 'tokenizer', 'merges.txt')]: 'merges',
      [path.join(modelDir, 'tokenizer', 'tokenizer_config.json')]: '{}',
      [path.join(modelDir, 'tokenizer', 'vocab.json')]: '{}',
      [path.join(sourceDir, 'silero_vad.onnx')]: 'vad'
    }
    await Promise.all(Object.entries(files).map(([file, bytes]) => writeFile(file, bytes)))
    const output = path.join(directory, 'qwen3-asr.zip')
    const { buildAsrModelPackage } = await import('../build-asr-model-package.mjs')
    await buildAsrModelPackage({ sourceDir, output })

    await writeFile(path.join(modelDir, 'encoder.int8.onnx'), 'updated encoder')
    await buildAsrModelPackage({ sourceDir, output })

    const archive = unzipSync(new Uint8Array(await readFile(output)))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']))
    assert.equal(manifest.format, 'ls101.asr-model-package')
    assert.equal(manifest.runtime.engine, 'qwen3-asr')
    assert.equal(manifest.assets.length, 7)
    assert.deepEqual(manifest.models[0].artifacts.tokenizer, [
      'model/tokenizer/merges.txt',
      'model/tokenizer/tokenizer_config.json',
      'model/tokenizer/vocab.json'
    ])
    for (const asset of manifest.assets) {
      assert.equal(archive[asset.path].byteLength, asset.size)
      assert.equal(createHash('sha256').update(archive[asset.path]).digest('hex'), asset.sha256)
    }
    assert.equal(Buffer.from(archive['model/encoder.int8.onnx']).toString(), 'updated encoder')

    await rm(path.join(modelDir, 'decoder.int8.onnx'))
    await assert.rejects(buildAsrModelPackage({ sourceDir, output }), /Missing ASR asset/)
    const preserved = unzipSync(new Uint8Array(await readFile(output)))
    assert.equal(Buffer.from(preserved['model/encoder.int8.onnx']).toString(), 'updated encoder')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
