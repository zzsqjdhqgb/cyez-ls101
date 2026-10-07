/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const http = require('node:http')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, before, describe, it } = require('node:test')

let buildHuggingFaceUrl
let buildModelScopeUrl
let buildSources
let downloadModel
let matchesPin
let parseOptions
let USAGE

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * A local stand-in for Hugging Face and ModelScope. `huggingFaceBase` gets the bare origin (so the
 * request path is the real `/<repository>/resolve/...` layout) and `mirrorBase` gets a `/mirror`
 * prefix. Nothing in this file ever touches the network.
 */
async function startServer(options = {}) {
  const seen = []
  const server = http.createServer((request, response) => {
    seen.push(request.url)
    const isMirror = request.url.startsWith('/mirror/')
    const status = (isMirror ? options.mirrorStatus : options.hfStatus) ?? 200
    const payload = (isMirror ? options.mirrorBytes : options.bytes) ?? options.bytes
    if (status !== 200) {
      response.writeHead(status, { 'content-type': 'text/plain' })
      response.end('fixture failure body\n')
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(payload)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    seen,
    base: `http://127.0.0.1:${port}`,
    mirrorBase: `http://127.0.0.1:${port}/mirror`,
    close() {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    }
  }
}

describe('index-tts model downloader', () => {
  let directory
  let assetsPath
  let bytes
  let digest
  let pinnedModel

  before(async () => {
    ;({
      buildHuggingFaceUrl,
      buildModelScopeUrl,
      buildSources,
      downloadModel,
      matchesPin,
      parseOptions,
      USAGE
    } = await import('../index-tts/download-model.mjs'))

    directory = await mkdtemp(path.join(tmpdir(), 'index-tts-download-'))
    await mkdir(path.join(directory, 'out'), { recursive: true })
    bytes = Buffer.from('pinned index-tts fixture payload\n'.repeat(16))
    digest = sha256(bytes)
    assetsPath = path.join(directory, 'assets.json')
    pinnedModel = {
      repository: 'audio-cpp/audio.cpp-gguf',
      mirror: {
        provider: 'modelscope',
        repository: 'HereIsMark/audio.cpp-gguf',
        revision: 'master'
      },
      revision: 'main',
      file: 'IndexTTS2.5-GGUF/index-tts2_5-f16.gguf',
      quantization: 'f16',
      size: bytes.byteLength,
      sha256: digest
    }
    await writeFixtureAssets(pinnedModel)
  })

  after(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  async function writeFixtureAssets(model, name = 'assets.json') {
    const filePath = path.join(directory, name)
    await writeFile(filePath, JSON.stringify({ schemaVersion: 1, model }))
    return filePath
  }

  /** A per-test destination, so no test can see a file another test left behind. */
  function outputFor(name) {
    return path.join(directory, 'out', `${name}.gguf`)
  }

  function download(outputPath, overrides = {}) {
    return downloadModel({ assetsPath, output: outputPath, ...overrides })
  }

  async function exists(filePath) {
    return stat(filePath).then(
      () => true,
      () => false
    )
  }

  it('parses the documented flags', () => {
    assert.deepEqual(parseOptions(['--output', 'model.bin', '--dry-run']), {
      output: 'model.bin',
      dryRun: true
    })
    assert.deepEqual(parseOptions(['--dry-run', '--output', 'model.bin']), {
      output: 'model.bin',
      dryRun: true
    })
    assert.deepEqual(parseOptions(['--help']), { help: true })
    assert.deepEqual(parseOptions(['-h']), { help: true })
    assert.throws(() => parseOptions(['--unknown']), /未知参数：--unknown/)
  })

  it('refuses --output consumed from another option instead of downloading to that name', () => {
    for (const argv of [
      ['--output'],
      ['--output', ''],
      ['--output', '--dry-run'],
      ['--output', '--'],
      ['--output', '-h']
    ]) {
      assert.throws(
        () => parseOptions(argv),
        (error) => {
          assert.match(error.message, /--output 缺少取值/)
          assert.ok(
            error.message.includes(USAGE),
            `error message must list the usage:\n${error.message}`
          )
          return true
        },
        `expected ${JSON.stringify(argv)} to be rejected`
      )
    }
  })

  it('keeps the pinned Hugging Face layout and encodes hostile pin values', () => {
    assert.equal(
      buildHuggingFaceUrl(pinnedModel),
      'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/IndexTTS2.5-GGUF/index-tts2_5-f16.gguf'
    )

    const hostile = {
      repository: 'evil/repo#frag',
      revision: 'rev?s ion',
      file: 'a%2Fb/c d#e?f.gguf'
    }
    const parsed = new URL(buildHuggingFaceUrl(hostile))
    assert.equal(parsed.origin, 'https://huggingface.co')
    assert.equal(
      parsed.pathname,
      '/evil/repo%23frag/resolve/rev%3Fs%20ion/a%252Fb/c%20d%23e%3Ff.gguf'
    )
    assert.equal(parsed.search, '')
    assert.equal(parsed.hash, '')
    assert.ok(!buildHuggingFaceUrl(hostile).includes(' '))

    // A `.`/`..` segment is refused: the URL parser would collapse it into a different path.
    assert.throws(
      () => buildHuggingFaceUrl({ repository: 'a/../b', revision: 'main', file: 'x.gguf' }),
      /路径段非法/
    )
  })

  it('keeps the ModelScope fallback layout and encodes it too', () => {
    assert.deepEqual(buildSources({ model: pinnedModel }), [
      'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/IndexTTS2.5-GGUF/index-tts2_5-f16.gguf',
      'https://www.modelscope.cn/api/v1/models/HereIsMark/audio.cpp-gguf/repo?Revision=master&FilePath=IndexTTS2.5-GGUF%2Findex-tts2_5-f16.gguf'
    ])

    const mirror = new URL(
      buildModelScopeUrl({ repository: 'a/b#c', revision: 'm?s' }, 'a%2Fb/c d#e.gguf')
    )
    assert.equal(mirror.origin, 'https://www.modelscope.cn')
    assert.equal(mirror.pathname, '/api/v1/models/a/b%23c/repo')
    assert.equal(mirror.searchParams.get('Revision'), 'm?s')
    assert.equal(mirror.searchParams.get('FilePath'), 'a%2Fb/c d#e.gguf')
  })

  it('accepts a file only when both size and digest match the pin', () => {
    const model = { size: bytes.byteLength, sha256: digest }
    assert.equal(matchesPin(model, bytes.byteLength, digest), true)
    assert.equal(matchesPin(model, bytes.byteLength, digest.toUpperCase()), true)
    assert.equal(matchesPin(model, bytes.byteLength + 1, digest), false)
    assert.equal(matchesPin(model, bytes.byteLength, '0'.repeat(64)), false)
  })

  it('reuses a cached file that matches the pin without any request', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('cached-pinned')
    await writeFile(outputPath, bytes)

    const result = await download(outputPath, {
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, false)
    assert.equal(server.seen.length, 0)
    assert.deepEqual(await readFile(outputPath), bytes)
  })

  it('re-downloads a cached file whose size does not match the pin', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('cached-wrong-size')
    await writeFile(outputPath, bytes.subarray(0, 3))

    const result = await download(outputPath, {
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, true)
    assert.equal(server.seen.length, 1)
    assert.deepEqual(await readFile(outputPath), bytes)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('re-downloads a cached file whose digest does not match the pin', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('cached-wrong-digest')
    await writeFile(outputPath, Buffer.alloc(bytes.byteLength, 1))

    const result = await download(outputPath, {
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, true)
    assert.equal(server.seen.length, 1)
    assert.deepEqual(await readFile(outputPath), bytes)
  })

  it('drops a cached file that does not match the pin when every source fails', async (context) => {
    const server = await startServer({ bytes, hfStatus: 404, mirrorStatus: 502 })
    context.after(() => server.close())
    const outputPath = outputFor('cached-failed')
    await writeFile(outputPath, Buffer.alloc(bytes.byteLength, 1))

    await assert.rejects(
      () => download(outputPath, { huggingFaceBase: server.base, mirrorBase: server.mirrorBase }),
      /IndexTTS 权重下载失败[\s\S]*HTTP 404[\s\S]*HTTP 502/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('never writes a non-2xx response to disk', async (context) => {
    const server = await startServer({ bytes, hfStatus: 404, mirrorStatus: 403 })
    context.after(() => server.close())
    const outputPath = outputFor('non-2xx')

    await assert.rejects(
      () => download(outputPath, { huggingFaceBase: server.base, mirrorBase: server.mirrorBase }),
      /HTTP 404/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)
    assert.deepEqual(server.seen, [
      '/audio-cpp/audio.cpp-gguf/resolve/main/IndexTTS2.5-GGUF/index-tts2_5-f16.gguf',
      '/mirror/api/v1/models/HereIsMark/audio.cpp-gguf/repo?Revision=master&FilePath=IndexTTS2.5-GGUF%2Findex-tts2_5-f16.gguf'
    ])
  })

  it('rejects fresh bytes that fail the pin, for size and for digest', async (context) => {
    const outputPath = outputFor('fresh-wrong-bytes')

    const wrongSize = await startServer({ bytes: bytes.subarray(0, 3) })
    context.after(() => wrongSize.close())
    await assert.rejects(
      () =>
        download(outputPath, {
          huggingFaceBase: wrongSize.base,
          mirrorBase: wrongSize.mirrorBase
        }),
      /校验失败：size=3/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)

    const wrongDigest = await startServer({ bytes: Buffer.alloc(bytes.byteLength, 2) })
    context.after(() => wrongDigest.close())
    await assert.rejects(
      () =>
        download(outputPath, {
          huggingFaceBase: wrongDigest.base,
          mirrorBase: wrongDigest.mirrorBase
        }),
      /校验失败：size=\d+ sha256=[0-9a-f]{64}/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('does not accept a stale .part as the finished file', async (context) => {
    const server = await startServer({ bytes, hfStatus: 500, mirrorStatus: 500 })
    context.after(() => server.close())
    const outputPath = outputFor('stale-part')
    await writeFile(`${outputPath}.part`, bytes)

    await assert.rejects(
      () => download(outputPath, { huggingFaceBase: server.base, mirrorBase: server.mirrorBase }),
      /IndexTTS 权重下载失败/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('overwrites a stale .part instead of trusting it', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('stale-part-overwrite')
    await writeFile(`${outputPath}.part`, Buffer.alloc(bytes.byteLength, 9))

    const result = await download(outputPath, {
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, true)
    assert.deepEqual(await readFile(outputPath), bytes)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('falls back to the ModelScope mirror when Hugging Face fails', async (context) => {
    const server = await startServer({ bytes, hfStatus: 503 })
    context.after(() => server.close())
    const outputPath = outputFor('mirror-fallback')

    const result = await download(outputPath, {
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, true)
    assert.equal(server.seen.length, 2)
    assert.match(server.seen[0], /^\/audio-cpp\/audio\.cpp-gguf\/resolve\/main\//)
    assert.match(server.seen[1], /^\/mirror\/api\/v1\/models\/HereIsMark\/audio\.cpp-gguf\/repo\?/)
    assert.deepEqual(await readFile(outputPath), bytes)
  })

  it('rejects wrong bytes served by the ModelScope fallback as well', async (context) => {
    const server = await startServer({
      bytes,
      hfStatus: 503,
      mirrorBytes: Buffer.alloc(bytes.byteLength, 4)
    })
    context.after(() => server.close())
    const outputPath = outputFor('mirror-wrong-bytes')

    await assert.rejects(
      () => download(outputPath, { huggingFaceBase: server.base, mirrorBase: server.mirrorBase }),
      /校验失败/
    )
    assert.equal(await exists(outputPath), false)
    assert.equal(await exists(`${outputPath}.part`), false)
  })

  it('requests the encoded path for a hostile repository and file name', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('hostile-path')
    const hostilePath = await writeFixtureAssets(
      {
        repository: 'evil/repo#frag',
        revision: 'main',
        file: 'a b#c.gguf',
        size: bytes.byteLength,
        sha256: digest
      },
      'assets-hostile.json'
    )

    const result = await downloadModel({
      assetsPath: hostilePath,
      output: outputPath,
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, true)
    assert.deepEqual(server.seen, ['/evil/repo%23frag/resolve/main/a%20b%23c.gguf'])
    assert.deepEqual(await readFile(outputPath), bytes)
  })

  it('reports the pin and sources in dry-run mode without downloading', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('dry-run')

    const result = await download(outputPath, {
      dryRun: true,
      huggingFaceBase: server.base,
      mirrorBase: server.mirrorBase
    })
    assert.equal(result.downloaded, false)
    assert.equal(result.size, bytes.byteLength)
    assert.equal(result.sha256, digest)
    assert.equal(result.outputPath, outputPath)
    assert.deepEqual(result.sources, [
      `${server.base}/audio-cpp/audio.cpp-gguf/resolve/main/IndexTTS2.5-GGUF/index-tts2_5-f16.gguf`,
      `${server.mirrorBase}/api/v1/models/HereIsMark/audio.cpp-gguf/repo?Revision=master&FilePath=IndexTTS2.5-GGUF%2Findex-tts2_5-f16.gguf`
    ])
    assert.equal(server.seen.length, 0)
    assert.equal(await exists(outputPath), false)
  })

  it('fails before any request when the assets.json pin is incomplete', async (context) => {
    const server = await startServer({ bytes })
    context.after(() => server.close())
    const outputPath = outputFor('incomplete-pin')
    const incompletePath = await writeFixtureAssets(
      { ...pinnedModel, sha256: undefined },
      'assets-incomplete.json'
    )

    await assert.rejects(
      () =>
        downloadModel({
          assetsPath: incompletePath,
          output: outputPath,
          huggingFaceBase: server.base,
          mirrorBase: server.mirrorBase
        }),
      /模型 pin 不完整/
    )
    assert.equal(server.seen.length, 0)
    assert.equal(await exists(outputPath), false)
  })

  it('keeps this suite in step with the shipped assets.json pin', async () => {
    const shipped = JSON.parse(
      await readFile(path.resolve(__dirname, '../index-tts/assets.json'), 'utf8')
    )
    assert.match(shipped.model.sha256, /^[0-9a-f]{64}$/)
    assert.ok(Number.isSafeInteger(shipped.model.size) && shipped.model.size > 0)
  })
})
