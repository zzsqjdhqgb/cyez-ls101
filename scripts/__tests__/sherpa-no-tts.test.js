/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 覆盖 sherpa no-tts 替换与 GPL 硬闸。
 *
 * 真实平台包在 node_modules 里并被其它测试使用，所以这里用临时目录搭出同构的
 * node_modules 树来验证行为，不触碰真实依赖。
 */

const assert = require('node:assert/strict')
const { mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const { sha256File } = require('../asset-integrity.js')
const MANIFEST = require('../sherpa-no-tts-assets.json')
const {
  assertNoGplSherpaPackages,
  findForbiddenMarkers,
  swapCurrentPlatform,
  targetForPlatform
} = require('../sherpa-no-tts.js')

const VENDOR_DIR = path.join(__dirname, '..', '..', 'thirdparty-libs', 'sherpa-onnx-no-tts')
const LINUX_TARGET = MANIFEST.targets.find(
  (target) => target.npmPackage === 'sherpa-onnx-linux-x64'
)

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

/** 搭一个只含指定平台包的临时 node_modules。 */
async function fakeNodeModules(packageNames) {
  const root = await mkdtemp(path.join(tmpdir(), 'ls101-sherpa-'))
  temporaryDirectories.push(root)
  const nodeModules = path.join(root, 'node_modules')
  for (const packageName of packageNames) {
    await mkdir(path.join(nodeModules, packageName), { recursive: true })
  }
  return nodeModules
}

function platformPackageDirectory(nodeModules, packageName) {
  return path.join(nodeModules, packageName)
}

test('manifest pins a vendored library and hashes for every target', () => {
  assert.equal(MANIFEST.schemaVersion, 1)
  assert.ok(MANIFEST.targets.length >= 2)
  for (const target of MANIFEST.targets) {
    assert.match(target.vendoredSha256, /^[a-f0-9]{64}$/)
    assert.match(target.releaseArtifactSha256, /^[a-f0-9]{64}$/)
    assert.ok(target.vendoredSize > 0)
    assert.ok(target.member.endsWith(target.packagePath))
  }
})

test('manifest covers the platforms the build entry point can produce', () => {
  const names = new Set(
    MANIFEST.targets.map((target) => `${target.nodePlatform}-${target.nodeArch}`)
  )
  assert.ok(names.has('linux-x64'))
  assert.ok(names.has('win32-x64'))
})

test('markers do not collide with unrelated sherpa symbols', () => {
  // 早期排查里 `grep -i espeak` 曾命中 OfflineSpeakerDiarization / SpeakerEmbedding，
  // 归一化匹配必须仍然区分得开。
  const innocents = [
    'OfflineSpeakerDiarization',
    'SherpaOnnxCreateSpeakerEmbeddingExtractor',
    'SherpaOnnxOfflineSpeakerDiarizationProcess',
    'WeSpeaker',
    'sherpa-onnx-linux-x64'
  ]
  for (const marker of MANIFEST.markers) {
    for (const innocent of innocents) {
      assert.equal(
        innocent.toLowerCase().includes(marker.toLowerCase()),
        false,
        `marker ${marker} 会误伤 ${innocent}`
      )
    }
  }
})

test('findForbiddenMarkers detects espeak strings but not innocents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-sherpa-marker-'))
  temporaryDirectories.push(directory)

  const offending = path.join(directory, 'tainted.so')
  await writeFile(offending, Buffer.from('.espeak_Initialize.espeak-ng-data.', 'latin1'))
  const markers = await findForbiddenMarkers(offending)
  assert.ok(markers.includes('espeak_Initialize'))
  assert.ok(markers.includes('espeak-ng-data'))

  const clean = path.join(directory, 'clean.so')
  await writeFile(clean, Buffer.from('.SherpaOnnxOfflineSpeakerDiarization.', 'latin1'))
  assert.deepEqual(await findForbiddenMarkers(clean), [])
})

test('vendored files in the repo match the manifest pins and are eSpeak-free', async () => {
  for (const target of MANIFEST.targets) {
    const filename = path.join(VENDOR_DIR, target.vendoredFile)
    const stats = await stat(filename)
    assert.equal(stats.size, target.vendoredSize, `${target.vendoredFile} 大小不符`)
    assert.equal(
      await sha256File(filename),
      target.vendoredSha256,
      `${target.vendoredFile} 哈希不符`
    )
    assert.deepEqual(
      await findForbiddenMarkers(filename),
      [],
      `${target.vendoredFile} 含 eSpeak 痕迹`
    )
  }
})

test('swap installs the vendored library over the platform package', async () => {
  const nodeModules = await fakeNodeModules([LINUX_TARGET.npmPackage])
  const destination = path.join(
    platformPackageDirectory(nodeModules, LINUX_TARGET.npmPackage),
    LINUX_TARGET.packagePath
  )
  // 先放一个假装是 GPL 版本的占位文件。
  await writeFile(destination, Buffer.from('espeak_Initialize', 'latin1'))

  const result = await swapCurrentPlatform({
    platform: LINUX_TARGET.nodePlatform,
    arch: LINUX_TARGET.nodeArch,
    nodeModulesDir: nodeModules
  })
  assert.equal(result.status, 'replaced')
  assert.equal(await sha256File(destination), LINUX_TARGET.vendoredSha256)

  const again = await swapCurrentPlatform({
    platform: LINUX_TARGET.nodePlatform,
    arch: LINUX_TARGET.nodeArch,
    nodeModulesDir: nodeModules
  })
  assert.equal(again.status, 'already-clean')
})

test('swap reports missing when the platform package is not installed', async () => {
  const nodeModules = await fakeNodeModules([])
  const result = await swapCurrentPlatform({
    platform: LINUX_TARGET.nodePlatform,
    arch: LINUX_TARGET.nodeArch,
    nodeModulesDir: nodeModules
  })
  assert.equal(result.status, 'missing')
})

test('swap reports unsupported for a platform without a no-tts variant', async () => {
  const nodeModules = await fakeNodeModules([])
  const result = await swapCurrentPlatform({
    platform: 'darwin',
    arch: 'arm64',
    nodeModulesDir: nodeModules
  })
  assert.equal(result.status, 'unsupported')
  assert.equal(targetForPlatform('darwin', 'arm64'), undefined)
})

test('a GPL-tainted platform package fails the guard', async () => {
  const nodeModules = await fakeNodeModules([LINUX_TARGET.npmPackage])
  await writeFile(
    path.join(
      platformPackageDirectory(nodeModules, LINUX_TARGET.npmPackage),
      LINUX_TARGET.packagePath
    ),
    Buffer.from('espeak_SetVoiceByName', 'latin1')
  )
  await assert.rejects(() => assertNoGplSherpaPackages(nodeModules), /未通过 GPL 检查/)
})

test('an unregistered platform package fails the guard', async () => {
  const nodeModules = await fakeNodeModules(['sherpa-onnx-darwin-arm64'])
  await assert.rejects(() => assertNoGplSherpaPackages(nodeModules), /不在 no-tts 清单里/)
})

test('a swapped platform package passes the guard', async () => {
  const nodeModules = await fakeNodeModules([LINUX_TARGET.npmPackage])
  await swapCurrentPlatform({
    platform: LINUX_TARGET.nodePlatform,
    arch: LINUX_TARGET.nodeArch,
    nodeModulesDir: nodeModules
  })
  assert.deepEqual(await assertNoGplSherpaPackages(nodeModules), { checked: 1 })
})

test('the JS wrapper package is not mistaken for a platform package', async () => {
  // sherpa-onnx-node 只有 JS，没有原生库，不该被当成需要替换的平台包。
  const nodeModules = await fakeNodeModules(['sherpa-onnx-node', LINUX_TARGET.npmPackage])
  await swapCurrentPlatform({
    platform: LINUX_TARGET.nodePlatform,
    arch: LINUX_TARGET.nodeArch,
    nodeModulesDir: nodeModules
  })
  assert.deepEqual(await assertNoGplSherpaPackages(nodeModules), { checked: 1 })
})

test('the audit document records the no-tts resolution', async () => {
  const document = await readFile(
    path.join(__dirname, '..', '..', 'docs', 'engineering', 'licensing-audit.md'),
    'utf8'
  )
  assert.match(document, /SHERPA_ONNX_ENABLE_TTS=OFF/)
  assert.match(document, /thirdparty-libs\/sherpa-onnx-no-tts/)
})
