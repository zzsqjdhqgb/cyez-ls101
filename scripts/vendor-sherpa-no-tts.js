/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 从上游 sherpa-onnx Release 取回 no-tts 变体，校验后写入 thirdparty-libs/sherpa-onnx-no-tts/。
 *
 * 只在升级 sherpa-onnx 时手动运行；安装/构建路径从不访问网络，只读仓库内已校验的副本。
 *
 * 用法：
 *   node scripts/vendor-sherpa-no-tts.js            # 下载、校验、写入仓库
 *   node scripts/vendor-sherpa-no-tts.js --check    # 只校验仓库内现有副本与清单一致
 *
 * 上游 Release 资产是 tar.bz2，用系统 tar 解包（Linux/macOS 自带；Windows 11 自带 bsdtar）。
 * 同时钉死归档与成员的 SHA-256：归档值确认取件来源，成员值确认真正入库的字节。
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync } = require('node:child_process')
const { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { sha256File } = require('./asset-integrity.js')

const ROOT_DIR = join(__dirname, '..')
const MANIFEST_PATH = join(__dirname, 'sherpa-no-tts-assets.json')
const VENDOR_DIR = join(ROOT_DIR, 'thirdparty-libs', 'sherpa-onnx-no-tts')
const RELEASE_BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function releaseAssetUrl(manifest, target) {
  return `${RELEASE_BASE_URL}/v${manifest.sherpaOnnxVersion}/${target.releaseArtifact}`
}

function assertPin(value, label) {
  if (!SHA256_PATTERN.test(value ?? '')) {
    throw new Error(`${label} 不是有效的 SHA-256，请在运行 --update-manifest 前先确认取件来源`)
  }
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败：${url}（HTTP ${response.status}）`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(destination, buffer)
  return buffer
}

async function extractMember(archive, member, destinationDir) {
  // 只取清单里钉死的那一个成员，避免整包解开。
  execFileSync('tar', ['xjf', archive, '-C', destinationDir, member], { stdio: 'pipe' })
  return join(destinationDir, member)
}

async function checkManifest(manifest) {
  const problems = []
  for (const target of manifest.targets) {
    const filename = join(VENDOR_DIR, target.vendoredFile)
    const actual = await sha256File(filename).catch(() => null)
    if (actual !== target.vendoredSha256) {
      problems.push(
        `${target.vendoredFile}: 期望 ${target.vendoredSha256}，实际 ${actual ?? '（文件缺失）'}`
      )
      continue
    }
    console.log(`${target.vendoredFile} 校验通过（${actual}）`)
  }
  if (problems.length > 0)
    throw new Error(`仓库内副本与清单不一致：\n  - ${problems.join('\n  - ')}`)
}

async function vendorTarget(manifest, target, workDir) {
  const url = releaseAssetUrl(manifest, target)
  console.log(`下载 ${target.releaseArtifact} ...`)
  const archive = join(workDir, target.releaseArtifact)
  await downloadArchive(url, archive)

  if (Number.isSafeInteger(target.releaseArtifactSize)) {
    const { size } = await stat(archive)
    if (size !== target.releaseArtifactSize) {
      throw new Error(
        `${target.releaseArtifact} 大小不符：期望 ${target.releaseArtifactSize}，实际 ${size}`
      )
    }
  }
  assertPin(target.releaseArtifactSha256, `${target.name}.releaseArtifactSha256`)
  const archiveSha256 = await sha256File(archive)
  if (archiveSha256 !== target.releaseArtifactSha256) {
    throw new Error(
      `${target.releaseArtifact} SHA-256 不符：期望 ${target.releaseArtifactSha256}，实际 ${archiveSha256}`
    )
  }
  console.log(`  归档校验通过（${archiveSha256}）`)

  const extracted = await extractMember(archive, target.member, workDir)
  const memberSha256 = await sha256File(extracted)
  if (memberSha256 !== target.vendoredSha256) {
    throw new Error(
      `${target.member} SHA-256 与清单不符：期望 ${target.vendoredSha256}，实际 ${memberSha256}\n` +
        `  如果这是有意的版本升级，请先更新清单，再重新运行本脚本。`
    )
  }

  const destination = join(VENDOR_DIR, target.vendoredFile)
  await mkdir(VENDOR_DIR, { recursive: true })
  await writeFile(destination, await readFile(extracted))
  if (!target.vendoredFile.endsWith('.dll')) await chmod(destination, 0o755)
  console.log(`  写入 ${destination}（${memberSha256}）`)
}

async function main() {
  const argv = process.argv.slice(2)
  const unknown = argv.filter((argument) => argument !== '--check')
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))

  await mkdir(VENDOR_DIR, { recursive: true })
  if (argv.includes('--check')) {
    await checkManifest(manifest)
    console.log('仓库内 no-tts 副本与清单一致。')
    return
  }

  const workDir = await mkdtemp(join(tmpdir(), 'ls101-vendor-sherpa-'))
  try {
    for (const target of manifest.targets) await vendorTarget(manifest, target, workDir)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
  await checkManifest(manifest)
  console.log('完成。请提交 thirdparty-libs/ 下的变更。')
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message ?? error)
    process.exit(1)
  })
}

module.exports = { checkManifest, releaseAssetUrl, vendorTarget }
