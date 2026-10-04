#!/usr/bin/env node
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 核对并暂存发音模型运行时资产，供 GitHub CLI 发布。
 *
 * 背景：`scripts/export-pronunciation-model.py` 需要 torch 工具链，不适合放进安装或 CI
 * 路径。安装路径（scripts/download-pronunciation-model.js）只从
 * `scripts/pronunciation-model-assets.json` 固定的 Release 下载并按 size/SHA-256 校验。
 *
 * 本脚本**不访问网络**：它把运行时目录里的文件按发布名摆进一个暂存目录，并写出 Release
 * 说明，真正的上传交给 `.github/workflows/pronunciation-model.yml` 里的
 * `gh release create`。发布名与运行时文件名不同（例如 `config.json` 发布为
 * `charsiu-…-int8-config.json`），而 GitHub Release 的资产是扁平的、`gh` 按文件名命名，
 * 所以必须先暂存。
 *
 * 用法（默认只做核对并打印计划，不写任何文件）：
 *
 *   node scripts/publish-pronunciation-model.mjs
 *   node scripts/publish-pronunciation-model.mjs --stage <dir> --notes <file>
 *
 * 常用组合：
 *   --update-manifest  用本地产物的实际 size/SHA-256 刷新清单（重新导出后使用）
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const model = require('./download-pronunciation-model.js')
const { MANIFEST_PATH, PINNED_MANIFEST, releaseAssetUrl, resolveModelRoot, validateManifest } =
  model

export function parsePublishOptions(argv) {
  const options = { stage: null, notes: null, updateManifest: false, help: false }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--update-manifest') {
      options.updateManifest = true
      continue
    }
    if (argument === '--help') {
      options.help = true
      continue
    }
    if (argument === '--stage' || argument === '--notes') {
      const value = argv[++index]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} 需要一个路径参数`)
      }
      if (argument === '--stage') options.stage = value
      else options.notes = value
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return options
}

export function releaseDownloadEndpoint() {
  return String(process.env.LS101_RELEASE_ENDPOINT ?? 'https://github.com').replace(/\/+$/, '')
}

async function sha256File(filename) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filename)) digest.update(chunk)
  return digest.digest('hex')
}

export async function inspectLocalAssets(manifest, runtimeDir) {
  const files = []
  const problems = []
  for (const asset of manifest.release.assets) {
    const filename = path.join(runtimeDir, asset.path)
    const details = await stat(filename).catch(() => null)
    if (!details?.isFile()) {
      problems.push({ asset, reason: '本地文件缺失' })
      continue
    }
    const sha256 = await sha256File(filename)
    files.push({ asset, filename, size: details.size, sha256 })
    if (details.size !== asset.size) {
      problems.push({ asset, reason: `大小 ${details.size} 与清单 ${asset.size} 不一致` })
    } else if (sha256 !== asset.sha256) {
      problems.push({ asset, reason: `SHA-256 ${sha256} 与清单 ${asset.sha256} 不一致` })
    }
  }
  return { files, problems }
}

export function planUploads(manifest, files, endpoint = releaseDownloadEndpoint()) {
  return files.map((file) => ({
    name: file.asset.name,
    path: file.asset.path,
    size: file.size,
    sha256: file.sha256,
    url: releaseAssetUrl(manifest.release, file.asset.name, endpoint)
  }))
}

export function applyLocalHashes(manifest, files) {
  const byPath = new Map(files.map((file) => [file.asset.path, file]))
  const next = structuredClone(manifest)
  const changes = []
  for (const asset of next.release.assets) {
    const file = byPath.get(asset.path)
    if (!file) continue
    if (asset.size !== file.size || asset.sha256 !== file.sha256) {
      changes.push(
        `${asset.path}: ${asset.size} / ${asset.sha256.slice(0, 12)}… -> ${file.size} / ${file.sha256.slice(0, 12)}…`
      )
      asset.size = file.size
      asset.sha256 = file.sha256
    }
  }
  return { manifest: next, changes }
}

export function releaseNotes(manifest, files) {
  const { modelId, runtimeDirectory, exporter, sources } = manifest
  const lines = [
    `发音评测运行时资产（${modelId}），由 \`${exporter}\` 从固定上游权重导出并只对 MatMul 做 INT8 量化。`,
    '',
    `- 运行时目录：\`externals/ai/pronunciation/model/${runtimeDirectory}\``,
    `- 安装方式：\`node scripts/download-pronunciation-model.js\`（按 size 与 SHA-256 校验，不需要 Python）`,
    '',
    '上游来源：',
    ...sources.map(
      (source) => `- \`${source.sourceModelId}\`@\`${source.revision}\`（${source.directory}）`
    ),
    '',
    '资产（size / SHA-256）：',
    ...files.map((file) => `- \`${file.asset.name}\` — ${file.size} B / \`${file.sha256}\``),
    '',
    '本 Release 视为不可变：任何资产内容变化都需要在 `scripts/pronunciation-model-assets.json` 里提升 `release.version` 并发布新的 tag。'
  ]
  return `${lines.join('\n')}\n`
}

/*
 * GitHub Release 的资产是扁平的，`gh release create` 按文件名命名，而清单里的发布名与
 * 运行时文件名不同，所以先把每个文件按发布名复制进暂存目录，再逐个复核复制结果。
 */
export async function stageReleaseAssets(files, stageDirectory) {
  await mkdir(stageDirectory, { recursive: true })
  const staged = []
  for (const file of files) {
    const target = path.join(stageDirectory, file.asset.name)
    await copyFile(file.filename, target)
    const details = await stat(target)
    const sha256 = await sha256File(target)
    if (details.size !== file.asset.size || sha256 !== file.asset.sha256) {
      throw new Error(`暂存文件与清单不一致：${file.asset.name}`)
    }
    staged.push(target)
  }
  return staged
}

export async function writeReleaseNotes(manifest, files, notesPath) {
  await mkdir(path.dirname(path.resolve(notesPath)), { recursive: true })
  await writeFile(notesPath, releaseNotes(manifest, files), 'utf8')
  return notesPath
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function printUsage() {
  console.log(`用法：node scripts/publish-pronunciation-model.mjs [--stage <dir>] [--notes <file>] [--update-manifest]

只做本地核对；不上传、不访问网络。上传由 GitHub CLI 完成：
  gh release create <tag> --prerelease --title <tag> --notes-file <file> <stage>/*

  --stage <dir>       把每个资产按发布名复制到该目录（上传前必须）
  --notes <file>      把 Release 说明写入该文件（上传前必须）
  --update-manifest   用本地产物的实际 size/SHA-256 刷新 scripts/pronunciation-model-assets.json
  --help              显示本帮助`)
}

async function main(argv = process.argv.slice(2)) {
  const options = parsePublishOptions(argv)
  if (options.help) {
    printUsage()
    return { staged: false }
  }

  let manifest = PINNED_MANIFEST
  validateManifest(manifest)
  const runtimeDir = path.join(resolveModelRoot(), manifest.runtimeDirectory)
  const release = manifest.release

  console.log(`[publish] 清单：${MANIFEST_PATH}`)
  console.log(
    `[publish] Release：${release.repository}@${release.tag}（prerelease=${release.prerelease}）`
  )
  console.log(`[publish] 运行时目录：${runtimeDir}`)

  let inspection = await inspectLocalAssets(manifest, runtimeDir)
  if (options.updateManifest) {
    const { manifest: updated, changes } = applyLocalHashes(manifest, inspection.files)
    if (changes.length === 0) {
      console.log('[publish] --update-manifest：清单已与本地产物一致，无需修改')
    } else {
      await writeFile(MANIFEST_PATH, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
      for (const change of changes) console.log(`[publish] 清单更新 ${change}`)
      manifest = updated
      inspection = await inspectLocalAssets(manifest, runtimeDir)
    }
  }

  if (inspection.problems.length > 0) {
    for (const problem of inspection.problems) {
      console.error(`[publish] 本地资产不一致：${problem.asset.path} — ${problem.reason}`)
    }
    throw new Error(
      '本地运行时资产与清单不一致。先重新导出（node scripts/download-pronunciation-model.js --export）或用 --update-manifest 刷新清单。'
    )
  }

  const plan = planUploads(manifest, inspection.files)
  console.log('[publish] 待发布资产：')
  for (const entry of plan) {
    console.log(`  - ${entry.name}（${formatBytes(entry.size)}）-> ${entry.path}`)
  }

  if (!options.stage || !options.notes) {
    console.log('[publish] 未指定 --stage 与 --notes：只做核对，未写入任何文件。')
    console.log(
      '[publish] 上传入口：.github/workflows/pronunciation-model.yml（gh release create）'
    )
    return { staged: false, plan }
  }

  const staged = await stageReleaseAssets(inspection.files, options.stage)
  console.log(`[publish] 已按发布名暂存 ${staged.length} 个资产到 ${options.stage}`)
  await writeReleaseNotes(manifest, inspection.files, options.notes)
  console.log(`[publish] 已写入 Release 说明：${options.notes}`)
  console.log(`[publish] 接下来：gh release create ${release.tag} --notes-file ${options.notes} …`)
  return { staged: true, plan }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message ?? error)
    process.exit(1)
  })
}
