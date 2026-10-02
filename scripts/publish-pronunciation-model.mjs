#!/usr/bin/env node
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 把已导出的发音模型运行时资产发布成固定的 GitHub Release 资产。
 *
 * 背景：`scripts/export-pronunciation-model.py` 需要 torch 工具链，不适合放进安装或 CI
 * 路径。安装路径（scripts/download-pronunciation-model.js）只从
 * `scripts/pronunciation-model-assets.json` 固定的 Release 下载并按 size/SHA-256 校验。
 *
 * 用法（默认只做本地核对并打印计划，不改远端）：
 *
 *   node scripts/publish-pronunciation-model.mjs
 *   GH_TOKEN=<token> node scripts/publish-pronunciation-model.mjs --publish
 *
 * 常用组合：
 *   --update-manifest  用本地产物的实际 size/SHA-256 刷新清单（重新导出后使用）
 *   --clobber          允许覆盖 Release 上已存在但内容不一致的资产
 *
 * 需要 token 的权限：repository contents: write。可用 GH_TOKEN 或 GITHUB_TOKEN。
 * 受限网络可用 LS101_RELEASE_API_ENDPOINT / LS101_RELEASE_UPLOAD_ENDPOINT 指向镜像。
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto'
import { openAsBlob } from 'node:fs'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const model = require('./download-pronunciation-model.js')
const { MANIFEST_PATH, MODEL_ROOT, PINNED_MANIFEST, releaseAssetUrl, validateManifest } = model

const USER_AGENT = 'cyez-ls101-pronunciation-model-publisher'
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export function parsePublishOptions(argv) {
  const allowed = new Set(['--publish', '--dry-run', '--update-manifest', '--clobber', '--help'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  return {
    publish: argv.includes('--publish'),
    updateManifest: argv.includes('--update-manifest'),
    clobber: argv.includes('--clobber'),
    help: argv.includes('--help')
  }
}

function resolveEndpoint(environmentValue, fallback) {
  return String(environmentValue ?? fallback).replace(/\/+$/, '')
}

export function releaseApiEndpoint() {
  return resolveEndpoint(process.env.LS101_RELEASE_API_ENDPOINT, 'https://api.github.com')
}

export function releaseUploadEndpoint() {
  return resolveEndpoint(process.env.LS101_RELEASE_UPLOAD_ENDPOINT, 'https://uploads.github.com')
}

export function publishToken() {
  return process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
}

export function releaseDownloadEndpoint() {
  return resolveEndpoint(process.env.LS101_RELEASE_ENDPOINT, 'https://github.com')
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

function githubHeaders(accept) {
  const token = publishToken()
  return {
    accept,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
    ...(token ? { authorization: `Bearer ${token}` } : {})
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, options)
  if (response.status === 404) return null
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `GitHub API ${options.method ?? 'GET'} ${url} 失败（HTTP ${response.status}）：${detail.slice(0, 300)}`
    )
  }
  return response.status === 204 ? {} : response.json()
}

export async function findRelease(release, endpoint = releaseApiEndpoint()) {
  return request(
    `${endpoint}/repos/${release.repository}/releases/tags/${encodeURIComponent(release.tag)}`,
    { headers: githubHeaders('application/vnd.github+json') }
  )
}

async function createRelease(release, body, endpoint) {
  return request(`${endpoint}/repos/${release.repository}/releases`, {
    method: 'POST',
    headers: {
      ...githubHeaders('application/vnd.github+json'),
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      tag_name: release.tag,
      name: `${release.tag}`,
      body,
      prerelease: release.prerelease,
      draft: false
    })
  })
}

async function deleteReleaseAsset(assetApiUrl) {
  await request(assetApiUrl, {
    method: 'DELETE',
    headers: githubHeaders('application/vnd.github+json')
  })
}

async function uploadReleaseAsset(release, releaseId, file, endpoint) {
  const body = await openAsBlob(file.filename)
  return request(
    `${endpoint}/repos/${release.repository}/releases/${releaseId}/assets?name=${encodeURIComponent(file.asset.name)}`,
    {
      method: 'POST',
      headers: {
        ...githubHeaders('application/octet-stream'),
        'content-type': 'application/octet-stream'
      },
      body
    }
  )
}

function releaseAssetStatus(asset, pinned) {
  if (!asset) return { state: 'missing', detail: '缺失' }
  if (asset.size !== pinned.size) {
    return { state: 'mismatch', detail: `大小 ${asset.size} != ${pinned.size}` }
  }
  const digest = typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '') : ''
  if (SHA256_PATTERN.test(digest) && digest !== pinned.sha256) {
    return { state: 'mismatch', detail: `SHA-256 ${digest} != ${pinned.sha256}` }
  }
  return { state: 'match', detail: `一致（${asset.size} B）` }
}

function formatBytes(value) {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function printUsage() {
  console.log(`用法：node scripts/publish-pronunciation-model.mjs [--publish] [--update-manifest] [--clobber]

默认只核对本地运行时资产并打印上传计划，不访问远端写接口。
  --publish          创建/复用 Release 并上传资产（需要 GH_TOKEN 或 GITHUB_TOKEN）
  --update-manifest  用本地产物的实际 size/SHA-256 刷新 scripts/pronunciation-model-assets.json
  --clobber          覆盖 Release 上已存在但内容不一致的资产
  --help             显示本帮助`)
}

async function main(argv = process.argv.slice(2)) {
  const options = parsePublishOptions(argv)
  if (options.help) {
    printUsage()
    return { published: false }
  }

  let manifest = PINNED_MANIFEST
  validateManifest(manifest)
  const runtimeDir = path.join(MODEL_ROOT, manifest.runtimeDirectory)
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

  if (!options.publish) {
    console.log('[publish] 干跑结束（未访问远端）。加 --publish 才会创建 Release 并上传。')
    console.log(
      `[publish] 手动上传入口：https://github.com/${release.repository}/releases/new?tag=${encodeURIComponent(release.tag)}`
    )
    return { published: false, plan }
  }

  if (!publishToken()) {
    throw new Error('缺少 GH_TOKEN 或 GITHUB_TOKEN（需要 repository contents: write 权限）')
  }

  let remote = await findRelease(release)
  if (!remote) {
    remote = await createRelease(
      release,
      releaseNotes(manifest, inspection.files),
      releaseApiEndpoint()
    )
    console.log(`[publish] 已创建 Release：${remote.html_url}`)
  } else {
    console.log(`[publish] 复用已有 Release：${remote.html_url}`)
  }

  const existing = Array.isArray(remote.assets) ? remote.assets : []
  for (const file of inspection.files) {
    const current = existing.find((asset) => asset.name === file.asset.name)
    const status = releaseAssetStatus(current, file.asset)
    if (status.state === 'match') {
      console.log(`[publish] 跳过 ${file.asset.name}（${status.detail}）`)
      continue
    }
    if (current && !options.clobber) {
      throw new Error(
        `Release 上已有 ${file.asset.name} 但${status.detail}；提升 release.version 发布新 tag，或用 --clobber 覆盖`
      )
    }
    if (current) {
      await deleteReleaseAsset(current.url)
      console.log(`[publish] 已删除旧资产 ${file.asset.name}`)
    }
    console.log(`[publish] 上传 ${file.asset.name}（${formatBytes(file.size)}）…`)
    await uploadReleaseAsset(release, remote.id, file, releaseUploadEndpoint())
  }

  const verified = await findRelease(release)
  const verifiedAssets = Array.isArray(verified?.assets) ? verified.assets : []
  for (const pinned of release.release.assets) {
    const status = releaseAssetStatus(
      verifiedAssets.find((asset) => asset.name === pinned.name),
      pinned
    )
    if (status.state !== 'match') {
      throw new Error(`发布后校验失败：${pinned.name} — ${status.detail}`)
    }
  }
  console.log(`[publish] 发布完成并校验通过：${verified.html_url}`)
  for (const entry of plan) console.log(`  - ${entry.url}`)
  return { published: true, plan, releaseUrl: verified.html_url }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message ?? error)
    process.exit(1)
  })
}
