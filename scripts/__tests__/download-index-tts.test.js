/* eslint-disable @typescript-eslint/explicit-function-return-type */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat
} = require('node:fs/promises')
const { readFileSync } = require('node:fs')
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

test('skip mode leaves locally staged CUDA runtime files untouched', async (context) => {
  const { main } = await modulePromise
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-skip-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const externalRoot = path.join(boundary, 'index-tts')
  const runtimeRoot = path.join(externalRoot, 'runtime')
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
  const stagedSnapshot = await snapshotTree(boundary)
  // The skip branch must not touch the network: an empty response map makes
  // any fetch call fail fast instead of hanging on a real upstream request.
  context.after(stubUpstreamFetch(new Map(), []))

  await main({
    boundary,
    environment: { LS101_SKIP_INDEX_TTS_DOWNLOAD: '1' },
    externalRoot,
    modelDirectory: path.join(externalRoot, 'models'),
    runtimeRoot,
    stateDirectory: path.join(boundary, '.setup-verification')
  })

  assert.deepEqual(await snapshotTree(boundary), stagedSnapshot)
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
  const payload = Buffer.from(Array.from({ length: 1000 }, (_, index) => (index * 7 + 13) % 251))
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

test('selects the pinned platform helpers from runtime release metadata', async () => {
  const { runtimeTarget, selectRuntimeReleaseAssets } = await modulePromise
  const target = runtimeTarget('linux', 'x64')
  const digest = 'a'.repeat(64)
  const release = {
    tag_name: JSON.parse(readFileSync('scripts/index-tts/assets.json', 'utf8')).runtimeRelease.tag,
    draft: false,
    prerelease: true,
    assets: [
      ...Object.values(target.helpers).map((helper) => asset(helper.name, digest)),
      asset('index-tts-runtime-manifest.json', digest),
      ...target.licenses.map((license) => asset(license.name, digest))
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
    licenses: target.licenses.map((license) => ({
      name: license.name,
      size: 1,
      digest,
      url: `https://example.test/${license.name}`
    })),
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

test('verifies upstream metadata on a clean tree and caches the API responses', async (context) => {
  const { loadConfig, runtimeTarget, verifyUpstreamMetadata } = await modulePromise
  const config = loadConfig()
  const { responses, runtimeRelease, modelTree, modelRelease } = upstreamMetadataFixtures(config)
  const requestedUrls = []
  context.after(stubUpstreamFetch(responses, requestedUrls))
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-upstream-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const downloadDirectory = path.join(boundary, 'index-tts', 'downloads')
  await assert.rejects(access(downloadDirectory))

  await verifyUpstreamMetadata(runtimeTarget('linux', 'x64'), downloadDirectory, boundary)

  // The endpoints are pinned verbatim instead of being derived from the same
  // fixture map, so a URL-construction regression in the module cannot pass
  // just by updating the fixtures in sync. The runtime release metadata is
  // only fetched while the pin says published (the unpublished window relies
  // on the local-build fallback instead).
  const expectedEndpoints = [
    'https://huggingface.co/api/models/audio-cpp/audio.cpp-gguf/tree/9c78726d0d2cf7ee8511e68ef003490c1251062f/IndexTTS2.5-GGUF'
  ]
  if (runtimeRelease) {
    expectedEndpoints.push(
      `https://api.github.com/repos/zzsqjdhqgb/cyez-ls101/releases/tags/${config.runtimeRelease.tag}`
    )
  }
  if (modelRelease) {
    expectedEndpoints.push(
      'https://api.github.com/repos/zzsqjdhqgb/cyez-ls101/releases/tags/index-tts-model-v1.0.0'
    )
  }
  assert.deepEqual([...requestedUrls].sort(), expectedEndpoints.sort())
  const expectedCaches = ['hf-model-tree-api.json']
  if (runtimeRelease) expectedCaches.push('runtime-release-api.json')
  if (modelRelease) expectedCaches.push('model-release-api.json')
  assert.deepEqual((await readdir(downloadDirectory)).sort(), expectedCaches.sort())
  if (runtimeRelease) {
    assert.deepEqual(
      JSON.parse(await readFile(path.join(downloadDirectory, 'runtime-release-api.json'), 'utf8')),
      runtimeRelease
    )
  }
  assert.deepEqual(
    JSON.parse(await readFile(path.join(downloadDirectory, 'hf-model-tree-api.json'), 'utf8')),
    modelTree
  )
  if (modelRelease) {
    assert.deepEqual(
      JSON.parse(await readFile(path.join(downloadDirectory, 'model-release-api.json'), 'utf8')),
      modelRelease
    )
  }
})

test('rejects diverging upstream metadata without creating the download directory', async (context) => {
  const { loadConfig, runtimeTarget, verifyUpstreamMetadata } = await modulePromise
  const config = loadConfig()
  const { responses, modelTree } = upstreamMetadataFixtures(config)
  modelTree[0].lfs.oid = '0'.repeat(64)
  context.after(stubUpstreamFetch(responses, []))
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-upstream-mismatch-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const downloadDirectory = path.join(boundary, 'index-tts', 'downloads')

  await assert.rejects(
    verifyUpstreamMetadata(runtimeTarget('linux', 'x64'), downloadDirectory, boundary),
    /IndexTTS 上游模型与 assets\.json 固定的 SHA-256 不一致/
  )
  await assert.rejects(access(downloadDirectory))
})

test('rejects an upstream model whose size diverges from assets.json', async (context) => {
  const { loadConfig, runtimeTarget, verifyUpstreamMetadata } = await modulePromise
  const config = loadConfig()
  const { responses, modelTree } = upstreamMetadataFixtures(config)
  // Keep the oid a valid 64-hex digest so only the size check rejects first.
  modelTree[0].lfs.size = config.model.size + 1
  context.after(stubUpstreamFetch(responses, []))
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-upstream-size-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const downloadDirectory = path.join(boundary, 'index-tts', 'downloads')

  await assert.rejects(
    verifyUpstreamMetadata(runtimeTarget('linux', 'x64'), downloadDirectory, boundary),
    /IndexTTS 上游模型与 assets\.json 固定的尺寸或 SHA-256 不一致/
  )
  await assert.rejects(access(downloadDirectory))
})

test('rejects a runtime release asset that diverges from the pinned manifest', async (context) => {
  const { loadConfig, runtimeTarget, verifyUpstreamMetadata } = await modulePromise
  const config = loadConfig()
  if (!config.runtimeRelease.published) {
    context.skip('runtime Release 尚未发布（backfill 窗口期），无 runtime 元数据可比对')
    return
  }
  const target = runtimeTarget('linux', 'x64')
  const { responses, runtimeRelease } = upstreamMetadataFixtures(config)
  const divergingAsset = runtimeRelease.assets.find(
    (candidate) => candidate.name === target.helpers.cpu.name
  )
  divergingAsset.size += 1
  context.after(stubUpstreamFetch(responses, []))
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-runtime-mismatch-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const downloadDirectory = path.join(boundary, 'index-tts', 'downloads')

  await assert.rejects(
    verifyUpstreamMetadata(target, downloadDirectory, boundary),
    /IndexTTS runtime Release 资产与固定清单不一致/
  )
  await assert.rejects(access(downloadDirectory))
})

test('rejects a model release part that diverges from the pinned manifest', async (context) => {
  const { loadConfig, runtimeTarget, verifyUpstreamMetadata } = await modulePromise
  const config = loadConfig()
  const { responses, modelRelease } = upstreamMetadataFixtures(config)
  // Nothing to tamper when the model release is not published yet.
  if (!modelRelease) return
  const divergingPart = modelRelease.assets.find(
    (candidate) => candidate.name === config.modelRelease.parts[0].name
  )
  divergingPart.digest = `sha256:${'0'.repeat(64)}`
  context.after(stubUpstreamFetch(responses, []))
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-model-mismatch-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const downloadDirectory = path.join(boundary, 'index-tts', 'downloads')

  await assert.rejects(
    verifyUpstreamMetadata(runtimeTarget('linux', 'x64'), downloadDirectory, boundary),
    /IndexTTS model Release 资产与固定清单不一致/
  )
  await assert.rejects(access(downloadDirectory))
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

test('uses the canonical helper filenames on Windows', async () => {
  const { runtimeTarget } = await modulePromise
  assert.deepEqual(runtimeTarget('win32', 'x64'), {
    directory: 'win32-x64',
    dependencies: [
      { name: 'cublas64_12.dll', file: 'cublas64_12.dll' },
      { name: 'cublasLt64_12.dll', file: 'cublasLt64_12.dll' }
    ],
    licenses: [
      { name: 'LICENSE.NVIDIA-CUDA.html', file: 'LICENSE.NVIDIA-CUDA.html' },
      { name: 'LICENSE.cJSON.txt', file: 'LICENSE.cJSON.txt' },
      { name: 'LICENSE.sentencepiece.txt', file: 'LICENSE.sentencepiece.txt' },
      { name: 'LICENSE.absl.txt', file: 'LICENSE.absl.txt' },
      { name: 'LICENSE.darts-clone.txt', file: 'LICENSE.darts-clone.txt' },
      { name: 'LICENSE.protobuf-lite.txt', file: 'LICENSE.protobuf-lite.txt' },
      { name: 'LICENSE.libyaml.txt', file: 'LICENSE.libyaml.txt' }
    ],
    helpers: {
      cpu: {
        name: 'ls101-index-tts-helper-cpu-win32-x64.exe',
        executable: 'ls101-index-tts-helper-cpu.exe'
      },
      cuda: {
        name: 'ls101-index-tts-helper-cuda-win32-x64.exe',
        executable: 'ls101-index-tts-helper-cuda.exe'
      }
    }
  })
})

test('requires the complete runtime license closure on every supported platform', async () => {
  const { runtimeTarget } = await modulePromise
  const expected = [
    'LICENSE.NVIDIA-CUDA.html',
    'LICENSE.cJSON.txt',
    'LICENSE.sentencepiece.txt',
    'LICENSE.absl.txt',
    'LICENSE.darts-clone.txt',
    'LICENSE.protobuf-lite.txt',
    'LICENSE.libyaml.txt'
  ]
  for (const platform of ['linux', 'win32']) {
    assert.deepEqual(
      runtimeTarget(platform, 'x64').licenses.map((license) => license.name),
      expected
    )
  }
})

test('pins the repository third-party notices to their exact bytes', async () => {
  const { loadConfig } = await modulePromise
  const config = loadConfig()
  for (const name of [
    'LICENSE.cJSON.txt',
    'LICENSE.sentencepiece.txt',
    'LICENSE.absl.txt',
    'LICENSE.darts-clone.txt',
    'LICENSE.protobuf-lite.txt',
    'LICENSE.libyaml.txt'
  ]) {
    const pinned = config.runtimeRelease.assets.find((asset) => asset.name === name)
    assert.ok(pinned, `${name} must be pinned`)
    const bytes = readFileSync(
      path.join(__dirname, '..', '..', 'native', 'index-tts', 'licenses', name)
    )
    assert.equal(pinned.size, bytes.byteLength)
    assert.equal(pinned.sha256, createHash('sha256').update(bytes).digest('hex'))
  }
})

test('does not carry speculative binary pins through the unpublished runtime window', async () => {
  const { loadConfig } = await modulePromise
  const config = loadConfig()
  if (config.runtimeRelease.published) return
  assert.deepEqual(
    config.runtimeRelease.assets.map((asset) => asset.name).sort(),
    [
      'LICENSE.absl.txt',
      'LICENSE.cJSON.txt',
      'LICENSE.darts-clone.txt',
      'LICENSE.libyaml.txt',
      'LICENSE.protobuf-lite.txt',
      'LICENSE.sentencepiece.txt'
    ].sort()
  )
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

test('exact cleanup preserves local runtime build artifacts and notices', async (context) => {
  const { LOCAL_RUNTIME_ARTIFACT_PATTERNS } = await modulePromise
  const { ensureAssetSet } = require('../asset-integrity.js')
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-preserve-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const runtimeDirectory = path.join(boundary, 'index-tts', 'runtime', 'linux-x64')
  await mkdir(runtimeDirectory, { recursive: true })
  // 受管资产：已就位且哈希正确的 helper（修复不应被触发）。
  const helperContent = Buffer.from('verified helper bytes')
  const helperPath = path.join(runtimeDirectory, 'ls101-index-tts-helper-cpu')
  await writeFile(helperPath, helperContent)
  if (process.platform !== 'win32') await chmod(helperPath, 0o755)
  const helperAsset = {
    path: 'ls101-index-tts-helper-cpu',
    size: helperContent.byteLength,
    sha256: createHash('sha256').update(helperContent).digest('hex'),
    ...(process.platform === 'win32' ? {} : { mode: 0o755 })
  }
  // 本地构建产物（build-runtime 写入）+ 一个"未来新增的第三方许可证"名字，
  // 证明 allowlist 是模式化的：新文件名命中 LICENSE.* 即自动受保护。
  const localArtifacts = [
    'build-cpu.json',
    'build-cuda.json',
    'LICENSE.IndexTTS.txt',
    'DISCLAIMER.IndexTTS.txt',
    'LICENSE.audio-cpp.txt',
    'LICENSE.cJSON.txt'
  ]
  for (const name of localArtifacts) {
    await writeFile(path.join(runtimeDirectory, name), 'local artifact')
  }
  await writeFile(path.join(runtimeDirectory, 'stale.tmp'), 'unexpected junk')

  const staged = await ensureAssetSet({
    boundary,
    root: runtimeDirectory,
    // statePath 必须位于 boundary（runtime 目录）内：状态写入沿用 boundary 安全校验。
    // 与生产布局一致：状态目录位于 boundary 内、受管目录之外。
    statePath: path.join(boundary, 'index-tts', '.setup-verification', 'state.json'),
    assets: [helperAsset],
    exact: true,
    preserve: LOCAL_RUNTIME_ARTIFACT_PATTERNS,
    repair: async () => {
      throw new Error('受管 helper 已就位，不应触发修复')
    }
  })

  assert.equal(staged.repaired, 0)
  assert.deepEqual(await readFile(helperPath), helperContent)
  for (const name of localArtifacts) {
    assert.equal(await readFile(path.join(runtimeDirectory, name), 'utf8'), 'local artifact')
  }
  // 模式之外的垃圾文件仍被 exact 清理删除。
  await assert.rejects(access(path.join(runtimeDirectory, 'stale.tmp')))
})

test('without the preserve patterns the exact cleanup removes the local artifacts', async (context) => {
  const { ensureAssetSet } = require('../asset-integrity.js')
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-nopreserve-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const runtimeDirectory = path.join(boundary, 'index-tts', 'runtime', 'linux-x64')
  await mkdir(runtimeDirectory, { recursive: true })
  const helperContent = Buffer.from('verified helper bytes')
  const helperAsset = {
    path: 'ls101-index-tts-helper-cpu',
    size: helperContent.byteLength,
    sha256: createHash('sha256').update(helperContent).digest('hex')
  }
  // 未预置受管 helper，确保走修复路径后再执行 exact 清理（而非快速校验短路）。
  await writeFile(path.join(runtimeDirectory, 'build-cpu.json'), 'local artifact')

  await ensureAssetSet({
    boundary,
    root: runtimeDirectory,
    // statePath 必须位于 boundary（runtime 目录）内：状态写入沿用 boundary 安全校验。
    // 与生产布局一致：状态目录位于 boundary 内、受管目录之外。
    statePath: path.join(boundary, 'index-tts', '.setup-verification', 'state.json'),
    assets: [helperAsset],
    exact: true,
    repair: async (asset, destination) => {
      await writeFile(destination, helperContent)
      if (process.platform !== 'win32') await chmod(destination, 0o755)
    }
  })

  // 反向证明：没有 preserve 时 build-cpu.json 会被删（正是被修复的缺陷）。
  await assert.rejects(access(path.join(runtimeDirectory, 'build-cpu.json')))
  assert.deepEqual(
    await readFile(path.join(runtimeDirectory, 'ls101-index-tts-helper-cpu')),
    helperContent
  )
})

test('local bootstrap rejects stale helper metadata and accepts the current runtime version', async (context) => {
  const { ensureRuntimeLocalBuild, loadConfig, runtimeTarget } = await modulePromise
  const config = loadConfig()
  const boundary = await mkdtemp(path.join(tmpdir(), 'index-tts-local-version-'))
  context.after(() => rm(boundary, { recursive: true, force: true }))
  const runtimeDirectory = path.join(boundary, 'runtime', 'linux-x64')
  await mkdir(runtimeDirectory, { recursive: true })
  const helper = path.join(runtimeDirectory, 'ls101-index-tts-helper-cpu')
  await writeFile(helper, Buffer.alloc(1024 * 1024, 1))
  const metadataPath = path.join(runtimeDirectory, 'build-cpu.json')
  const metadata = {
    runtimeVersion: '0.0.0-stale',
    sourceCommit: config.runtime.revision,
    ggmlRevision: config.runtime.ggmlRevision
  }
  await writeFile(metadataPath, JSON.stringify(metadata))

  await assert.rejects(
    ensureRuntimeLocalBuild(runtimeDirectory, runtimeTarget('linux', 'x64')),
    /本地 IndexTTS runtime 版本不一致/
  )

  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, runtimeVersion: config.runtimeRelease.version })
  )
  await ensureRuntimeLocalBuild(runtimeDirectory, runtimeTarget('linux', 'x64'))
})

test('the runtime staging call wires the preserve patterns', async () => {
  const source = readFileSync(
    path.join(__dirname, '..', 'index-tts', 'download-release-assets.mjs'),
    'utf8'
  )
  const stagingCall = source.slice(
    source.indexOf('const stagedRuntime = await ensureAssetSet'),
    source.indexOf("logAssetSet('staged runtime'")
  )
  assert.match(stagingCall, /preserve:\s*LOCAL_RUNTIME_ARTIFACT_PATTERNS/)
  // 模型目录的 staging 不得挂 preserve：模型目录没有本地产物，保持严格 exact。
  const modelCall = source.slice(
    source.indexOf('const models = await ensureAssetSet'),
    source.indexOf("logAssetSet('models'")
  )
  assert.doesNotMatch(modelCall, /preserve:/)
})

function asset(name, digest) {
  return {
    name,
    size: 1,
    digest: digest === 'missing' ? undefined : `sha256:${digest}`,
    browser_download_url: `https://example.test/${name}`
  }
}

// Builds the upstream API responses that exactly match the pinned manifests,
// so verifyUpstreamMetadata can be exercised without real network access.
function upstreamMetadataFixtures(config) {
  const responses = new Map()
  // runtimeRelease 为 null 表示 pin 尚未发布（published: false）：
  // verifyUpstreamMetadata 不得请求该端点，也不写 runtime-release-api.json。
  const runtimeRelease = config.runtimeRelease.published
    ? githubReleaseMetadata(config.runtimeRelease, [...config.runtimeRelease.assets])
    : null
  if (runtimeRelease) {
    responses.set(githubReleaseApiUrl(config.runtimeRelease), runtimeRelease)
  }
  const modelTree = [
    {
      type: 'file',
      path: config.model.upstreamPath,
      lfs: { oid: config.model.sha256, size: config.model.size }
    }
  ]
  responses.set(
    `https://huggingface.co/api/models/${config.model.ggufRepository}/tree/${config.model.ggufRevision}/${path.posix.dirname(config.model.upstreamPath)}`,
    modelTree
  )
  let modelRelease
  if (config.modelRelease.published) {
    modelRelease = githubReleaseMetadata(config.modelRelease, [
      ...config.modelRelease.parts,
      { name: 'index-tts-model-manifest.json', size: 1572, sha256: 'd'.repeat(64) }
    ])
    responses.set(githubReleaseApiUrl(config.modelRelease), modelRelease)
  }
  return { responses, runtimeRelease, modelTree, modelRelease }
}

function githubReleaseApiUrl(release) {
  return `https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`
}

function githubReleaseMetadata(release, pinnedAssets) {
  return {
    tag_name: release.tag,
    draft: false,
    prerelease: release.prerelease,
    assets: pinnedAssets.map((pinned) => ({
      name: pinned.name,
      size: pinned.size,
      digest: `sha256:${pinned.sha256}`,
      browser_download_url: `https://github.com/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(pinned.name)}`
    }))
  }
}

function stubUpstreamFetch(responses, requestedUrls) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    requestedUrls.push(`${url}`)
    const body = responses.get(`${url}`)
    if (body === undefined) throw new Error(`测试未提供该上游端点的响应：${url}`)
    return { ok: true, json: async () => body }
  }
  return () => {
    globalThis.fetch = originalFetch
  }
}

async function snapshotTree(root) {
  const snapshot = {}
  await collectTreeSnapshot(root, '', snapshot)
  return snapshot
}

async function collectTreeSnapshot(root, relative, snapshot) {
  const entries = await readdir(relative ? path.join(root, relative) : root, {
    withFileTypes: true
  })
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      // Directories are recorded as null entries so that a staging step which
      // only creates an empty directory (downloads/, models/) still changes
      // the snapshot.
      snapshot[`${child}/`] = null
      await collectTreeSnapshot(root, child, snapshot)
    } else {
      snapshot[child] = await readFile(path.join(root, child))
    }
  }
  return snapshot
}
