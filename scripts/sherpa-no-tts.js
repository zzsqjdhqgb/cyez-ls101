/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 用上游 no-tts 变体替换 sherpa-onnx npm 平台包里的 C API 库。
 *
 * 背景：`sherpa-onnx-node` 的 npm 平台包由 `.github/workflows/npm-addon-*.yaml` 构建，
 * cmake 命令行没有设置 `SHERPA_ONNX_ENABLE_TTS`，于是用了 `CMakeLists.txt` 里的默认值 ON，
 * 把 GPL-3.0-or-later 的 eSpeak NG（经 piper-phonemize）静态链进了
 * `libsherpa-onnx-c-api.so` / `sherpa-onnx-c-api.dll`。平台包的 package.json 却只声明
 * Apache-2.0。仓库根 LICENSE 是专有许可，与 GPLv3 不兼容，因此不能靠"补许可证文本"解决，
 * 只能让产物里不含该代码。
 *
 * 上游官方 Release 另外成套提供 `SHERPA_ONNX_ENABLE_TTS=OFF` 的 no-tts 变体，其中不包含
 * eSpeak NG / piper-phonemize（`include(espeak-ng-for-piper)` 根本不会执行）。两者同为
 * sherpa-onnx 1.13.6，C API 版本一致；no-tts 仍然导出全部 `SherpaOnnx*OfflineTts*` 入口，
 * 所以 `sherpa-onnx.node` 的符号需求一个都不缺。
 *
 * 本脚本做两件事：
 *   1. swap  —— 把仓库内 `thirdparty-libs/sherpa-onnx-no-tts/` 的已校验副本覆盖到当前平台的
 *               npm 平台包里。必须挂在 `yarn install` 之后执行，否则 yarn 重新解包会冲掉替换。
 *   2. guard —— 检查所有已安装的 sherpa 平台包：文件哈希必须等于钉死值，且不得含任何 eSpeak
 *              痕迹。构建入口调用它，保证将来升级依赖或新增平台时不会静默把 GPL 代码打进去。
 *
 * 升级 sherpa-onnx 时：更新 `sherpa-no-tts-assets.json` 的版本与哈希，跑
 * `node scripts/vendor-sherpa-no-tts.js` 重新取件，再执行一次 `yarn setup`。
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} = require('node:fs/promises')
const { join } = require('node:path')
const { sha256File } = require('./asset-integrity.js')

const ROOT_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'sherpa-no-tts-assets.json')
const VENDOR_DIR = join(ROOT_DIR, 'thirdparty-libs', 'sherpa-onnx-no-tts')
const NODE_MODULES_DIR = join(ROOT_DIR, 'node_modules')
/**
 * 纯 JS 的包装包（`sherpa-onnx-node`）不含原生库，必须排除。
 * 平台包一律是 `sherpa-onnx-<platform>-<arch>` 的形状。
 */
const SHERPA_PACKAGE_PATTERN = /^sherpa-onnx-[a-z0-9]+-[a-z0-9_]+$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

class SherpaNoTtsError extends Error {}

function readManifest() {
  let manifest
  try {
    manifest = require(MANIFEST_PATH)
  } catch (error) {
    throw new SherpaNoTtsError(`无法读取 sherpa no-tts 清单：${error.message}`)
  }
  if (manifest?.schemaVersion !== 1) {
    throw new SherpaNoTtsError(`不支持的 sherpa no-tts 清单版本：${manifest?.schemaVersion}`)
  }
  if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
    throw new SherpaNoTtsError('sherpa no-tts 清单缺少 targets')
  }
  if (!Array.isArray(manifest.markers) || manifest.markers.length === 0) {
    throw new SherpaNoTtsError('sherpa no-tts 清单缺少 markers')
  }
  for (const target of manifest.targets) {
    for (const key of [
      'name',
      'npmPackage',
      'nodePlatform',
      'nodeArch',
      'packagePath',
      'vendoredFile'
    ]) {
      if (typeof target[key] !== 'string' || target[key] === '') {
        throw new SherpaNoTtsError(`sherpa no-tts 清单项缺少 ${key}：${JSON.stringify(target)}`)
      }
    }
    if (!SHA256_PATTERN.test(target.vendoredSha256 ?? '')) {
      throw new SherpaNoTtsError(`sherpa no-tts 清单项的 vendoredSha256 无效：${target.name}`)
    }
    if (!Number.isSafeInteger(target.vendoredSize) || target.vendoredSize <= 0) {
      throw new SherpaNoTtsError(`sherpa no-tts 清单项的 vendoredSize 无效：${target.name}`)
    }
  }
  return manifest
}

const MANIFEST = readManifest()

/** 当前运行平台对应的清单项；未覆盖的平台返回 undefined。 */
function targetForPlatform(platform = process.platform, arch = process.arch) {
  return MANIFEST.targets.find(
    (target) => target.nodePlatform === platform && target.nodeArch === arch
  )
}

/** 该平台包是否已经装到了 node_modules 里。 */
async function packageIsInstalled(target, nodeModulesDir = NODE_MODULES_DIR) {
  const stats = await lstat(join(nodeModulesDir, target.npmPackage)).catch(() => null)
  return Boolean(stats?.isDirectory())
}

async function assertFileMatches(filename, { size, sha256 }, label) {
  const stats = await lstat(filename).catch(() => null)
  if (!stats) throw new SherpaNoTtsError(`${label} 不存在：${filename}`)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new SherpaNoTtsError(`${label} 不是普通文件：${filename}`)
  }
  if (stats.size !== size) {
    throw new SherpaNoTtsError(`${label} 大小不符：期望 ${size}，实际 ${stats.size}（${filename}）`)
  }
  const actual = await sha256File(filename)
  if (actual !== sha256) {
    throw new SherpaNoTtsError(
      `${label} SHA-256 不符：期望 ${sha256}，实际 ${actual}（${filename}）`
    )
  }
}

/**
 * 在二进制里查找 eSpeak / piper 痕迹。
 *
 * 用大小写归一化后的子串匹配，marker 一律以 `espeak`/`piper` 为核心，避免早期排查中
 * `grep -i espeak` 命中 `OfflineSpeakerDiarization` 这类误报。
 */
async function findForbiddenMarkers(filename) {
  const contents = (await readFile(filename)).toString('latin1').toLowerCase()
  return MANIFEST.markers.filter((marker) => contents.includes(marker.toLowerCase()))
}

/**
 * 校验一个平台包：目标库必须是校验过的 no-tts 文件，且整个包内不含 eSpeak 痕迹。
 * 返回该平台包的检查结果，不抛异常，便于调用方决定是失败还是仅告警。
 */
async function inspectPackage(target, nodeModulesDir = NODE_MODULES_DIR) {
  const packageDir = join(nodeModulesDir, target.npmPackage)
  const libraryPath = join(packageDir, target.packagePath)
  const result = { target, packageDir, libraryPath, ok: false, problems: [] }

  try {
    await assertFileMatches(
      libraryPath,
      { size: target.vendoredSize, sha256: target.vendoredSha256 },
      `${target.npmPackage}/${target.packagePath}`
    )
  } catch (error) {
    result.problems.push(error.message)
  }

  let entries
  try {
    entries = await readdir(packageDir, { withFileTypes: true })
  } catch (error) {
    result.problems.push(`无法读取平台包目录：${error.message}`)
    return result
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    const filename = join(packageDir, entry.name)
    let markers
    try {
      markers = await findForbiddenMarkers(filename)
    } catch (error) {
      result.problems.push(`无法扫描 ${target.npmPackage}/${entry.name}：${error.message}`)
      continue
    }
    if (markers.length > 0) {
      result.problems.push(
        `${target.npmPackage}/${entry.name} 含 eSpeak/piper 痕迹（GPL-3.0-or-later）：${markers.join(', ')}`
      )
    }
  }

  result.ok = result.problems.length === 0
  return result
}

/** 把仓库内的已校验副本原子地覆盖到平台包里。 */
async function installVendoredLibrary(target, nodeModulesDir = NODE_MODULES_DIR) {
  const source = join(VENDOR_DIR, target.vendoredFile)
  const destination = join(nodeModulesDir, target.npmPackage, target.packagePath)

  await assertFileMatches(
    source,
    { size: target.vendoredSize, sha256: target.vendoredSha256 },
    `仓库内副本 ${target.vendoredFile}`
  )

  const destinationStats = await lstat(destination).catch(() => null)
  if (destinationStats?.isFile() && !destinationStats.isSymbolicLink()) {
    if ((await sha256File(destination)) === target.vendoredSha256) return false
  }

  await mkdir(join(nodeModulesDir, target.npmPackage), { recursive: true })
  const partial = `${destination}.sherpa-no-tts.part`
  await rm(partial, { force: true })
  await writeFile(partial, await readFile(source))
  await rename(partial, destination)
  // 平台包里的原生库是可执行的；这个路径在 Windows 上不适用。
  if (target.nodePlatform !== 'win32') {
    await chmod(destination, 0o755)
  }
  return true
}

/**
 * 替换指定平台的 sherpa 平台包。
 *
 * 平台未覆盖时返回 unsupported；平台包未安装（可选依赖未落地）时返回 missing，
 * 由调用方决定是否升级为失败。
 */
async function swapCurrentPlatform({
  platform = process.platform,
  arch = process.arch,
  nodeModulesDir = NODE_MODULES_DIR
} = {}) {
  const target = targetForPlatform(platform, arch)
  if (!target) {
    return { status: 'unsupported', platform, arch }
  }
  if (!(await packageIsInstalled(target, nodeModulesDir))) {
    return { status: 'missing', target }
  }

  const replaced = await installVendoredLibrary(target, nodeModulesDir)
  const inspection = await inspectPackage(target, nodeModulesDir)
  if (!inspection.ok) {
    throw new SherpaNoTtsError(`替换后校验失败：\n  - ${inspection.problems.join('\n  - ')}`)
  }
  return { status: replaced ? 'replaced' : 'already-clean', target }
}

/**
 * 构建前的硬闸：所有已安装的 sherpa 平台包都必须是校验过的 no-tts 内容。
 *
 * 任何未覆盖的平台只要装进了 node_modules 就视为失败——宁可构建报错，
 * 也不能让它带着 GPL 代码进安装包。
 */
async function assertNoGplSherpaPackages(nodeModulesDir = NODE_MODULES_DIR) {
  const problems = []
  const uncovered = []
  let checked = 0

  const entries = await readdir(nodeModulesDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory() || !SHERPA_PACKAGE_PATTERN.test(entry.name)) continue
    const target = MANIFEST.targets.find((candidate) => candidate.npmPackage === entry.name)
    if (!target) {
      uncovered.push(entry.name)
      problems.push(`${entry.name} 不在 no-tts 清单里，无法证明其中不含 GPL 的 eSpeak NG。`)
      continue
    }
    checked += 1
    const inspection = await inspectPackage(target, nodeModulesDir)
    if (!inspection.ok) problems.push(...inspection.problems)
  }

  if (problems.length > 0) {
    const hints = []
    if (checked > 0) {
      hints.push('这些平台包已登记但内容不符，执行 `yarn setup` 完成替换后再构建。')
    }
    if (uncovered.length > 0) {
      hints.push(
        `尚未登记的平台包：${uncovered.join('、')}。` +
          '请仿照 thirdparty-libs/sherpa-onnx-no-tts 与 scripts/sherpa-no-tts-assets.json ' +
          '补充对应的 no-tts 变体，否则不要在该平台出包。'
      )
    }
    throw new SherpaNoTtsError(
      'sherpa-onnx 平台包未通过 GPL 检查：\n  - ' +
        problems.join('\n  - ') +
        '\n\n' +
        hints.join('\n')
    )
  }
  return { checked }
}

/** 平台包不在依赖中（可选依赖未落地）时不算失败，但必须让人看得见。 */
function reportUnsupported(platform, arch) {
  console.warn(
    `[sherpa-no-tts] 当前平台 ${platform}-${arch} 没有对应的 no-tts 变体，未做替换。\n` +
      `               若要在该平台构建，请补充清单项，否则安装包里会含 GPL 的 eSpeak NG。`
  )
}

async function main() {
  const result = await swapCurrentPlatform()
  if (result.status === 'unsupported') {
    reportUnsupported(result.platform, result.arch)
    const { checked } = await assertNoGplSherpaPackages()
    console.log(`[sherpa-no-tts] 已安装的 sherpa 平台包通过 GPL 检查：${checked} 个`)
    return
  }
  if (result.status === 'missing') {
    console.log(`[sherpa-no-tts] ${result.target.npmPackage} 未安装，跳过替换`)
    return
  }

  const label = result.status === 'replaced' ? '已替换' : '已是 no-tts 版本'
  console.log(
    `[sherpa-no-tts] ${result.target.npmPackage}/${result.target.packagePath} ${label}` +
      `（${result.target.vendoredSha256}）`
  )
  const { checked } = await assertNoGplSherpaPackages()
  console.log(`[sherpa-no-tts] 已安装的 sherpa 平台包通过 GPL 检查：${checked} 个`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof SherpaNoTtsError ? error.message : error)
    process.exit(1)
  })
}

module.exports = {
  MANIFEST,
  MANIFEST_PATH,
  NODE_MODULES_DIR,
  SHERPA_PACKAGE_PATTERN,
  SherpaNoTtsError,
  VENDOR_DIR,
  assertNoGplSherpaPackages,
  findForbiddenMarkers,
  installVendoredLibrary,
  inspectPackage,
  packageIsInstalled,
  readManifest,
  swapCurrentPlatform,
  targetForPlatform
}
