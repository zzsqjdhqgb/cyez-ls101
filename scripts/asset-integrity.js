/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { createHash, randomUUID } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { lstat, mkdir, open, readFile, readdir, rename, rm } = require('node:fs/promises')
const path = require('node:path')

const STATE_SCHEMA_VERSION = 1
const MAX_STATE_BYTES = 1024 * 1024
const SHA256_PATTERN = /^[a-f0-9]{64}$/

async function ensureAssetSet(options) {
  const normalized = normalizeOptions(options)
  const status = await verifyAssetSet({ ...normalized, cleanUnexpected: true })
  if (status.valid) {
    return { method: status.method, repaired: 0 }
  }

  await ensureManagedDirectory(normalized.root, normalized.boundary)
  await ensureAssetDirectories(normalized.root, normalized.assets)

  let repaired = 0
  const verifiedFingerprints = { ...status.verifiedFingerprints }
  for (const asset of status.invalidAssets) {
    const destination = assetPath(normalized.root, asset.path)
    await rm(destination, { recursive: true, force: true })
    await ensureAssetDirectories(normalized.root, [asset])
    await normalized.repair(asset, destination)
    verifiedFingerprints[asset.path] = await assertAssetFile(destination, asset)
    repaired += 1
  }

  if (normalized.exact) {
    await cleanUnexpectedEntries(normalized.root, normalized.assets)
  }
  await writeAssetVerificationState(normalized, verifiedFingerprints)
  return { method: 'repaired', repaired }
}

async function verifyAssetSet(options) {
  const normalized = normalizeOptions(options, { repairRequired: false })
  if (!normalized.forceHash && (await quickAssetSetIsValid(normalized))) {
    return {
      valid: true,
      method: 'fast',
      invalidAssets: [],
      unexpectedPaths: [],
      verifiedFingerprints: {}
    }
  }

  const tree = await inspectManagedTree(normalized)
  const invalidAssets = []
  const verifiedFingerprints = {}
  for (const asset of normalized.assets) {
    if (!tree.readableAssets.has(asset.path)) {
      invalidAssets.push(asset)
      continue
    }
    try {
      verifiedFingerprints[asset.path] = await assertAssetFile(
        assetPath(normalized.root, asset.path),
        asset
      )
    } catch {
      invalidAssets.push(asset)
    }
  }

  let unexpectedPaths = tree.unexpectedPaths
  if (invalidAssets.length === 0 && unexpectedPaths.length > 0 && normalized.cleanUnexpected) {
    await Promise.all(unexpectedPaths.map((entry) => rm(entry, { recursive: true, force: true })))
    unexpectedPaths = []
  }

  if (invalidAssets.length === 0 && unexpectedPaths.length === 0) {
    await writeAssetVerificationState(normalized, verifiedFingerprints)
    return {
      valid: true,
      method: 'full',
      invalidAssets: [],
      unexpectedPaths: [],
      verifiedFingerprints
    }
  }
  return {
    valid: false,
    method: 'full',
    invalidAssets,
    unexpectedPaths,
    verifiedFingerprints
  }
}

async function quickAssetSetIsValid(options) {
  const state = await readVerificationState(options.statePath)
  if (
    !state ||
    state.schemaVersion !== STATE_SCHEMA_VERSION ||
    state.manifestSha256 !== manifestSha256(options.assets, options.exact) ||
    !state.files ||
    typeof state.files !== 'object' ||
    Array.isArray(state.files)
  ) {
    return false
  }

  const tree = await inspectManagedTree(options)
  if (tree.readableAssets.size !== options.assets.length || tree.unexpectedPaths.length > 0) {
    return false
  }

  for (const asset of options.assets) {
    const stats = await lstatBigInt(assetPath(options.root, asset.path)).catch(() => null)
    if (!stats || !assetStatsAreValid(stats, asset)) return false
    if (!sameFingerprint(state.files[asset.path], fileFingerprint(stats))) return false
  }
  return true
}

async function recordAssetSetVerification(options) {
  const normalized = normalizeOptions(options, { repairRequired: false })
  const tree = await inspectManagedTree(normalized)
  if (tree.readableAssets.size !== normalized.assets.length || tree.unexpectedPaths.length > 0) {
    throw new Error(`无法记录未完成的资产目录：${normalized.root}`)
  }

  const files = {}
  for (const asset of normalized.assets) {
    const stats = await lstatBigInt(assetPath(normalized.root, asset.path))
    if (!assetStatsAreValid(stats, asset)) {
      throw new Error(`无法记录无效资产：${asset.path}`)
    }
    files[asset.path] = fileFingerprint(stats)
  }

  await writeAssetVerificationState(normalized, files)
}

async function assertAssetFile(filename, asset) {
  const before = await lstatBigInt(filename).catch(() => null)
  if (!before || !assetStatsAreValid(before, asset)) {
    throw new Error(`资产文件类型、大小或权限不匹配：${filename}`)
  }
  const actual = await sha256File(filename)
  if (actual !== asset.sha256) {
    throw new Error(`SHA-256 不匹配：${filename}（应为 ${asset.sha256}，实际为 ${actual}）`)
  }
  const after = await lstatBigInt(filename).catch(() => null)
  if (
    !after ||
    !assetStatsAreValid(after, asset) ||
    !sameFingerprint(fileFingerprint(before), fileFingerprint(after))
  ) {
    throw new Error(`资产在 SHA-256 校验期间发生变化：${filename}`)
  }
  return fileFingerprint(after)
}

async function writeAssetVerificationState(options, files) {
  if (options.assets.some((asset) => !isFingerprint(files[asset.path]))) {
    throw new Error(`资产验证状态不完整：${options.root}`)
  }
  for (const asset of options.assets) {
    const current = await lstatBigInt(assetPath(options.root, asset.path)).catch(() => null)
    if (
      !current ||
      !assetStatsAreValid(current, asset) ||
      !sameFingerprint(files[asset.path], fileFingerprint(current))
    ) {
      throw new Error(`资产在验证状态写入前发生变化：${asset.path}`)
    }
  }
  await writeJsonAtomically(
    options.statePath,
    {
      schemaVersion: STATE_SCHEMA_VERSION,
      manifestSha256: manifestSha256(options.assets, options.exact),
      files
    },
    options.boundary
  )
}

async function sha256File(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function cleanUnexpectedEntries(root, assets) {
  const normalized = normalizeAssets(assets)
  const tree = await inspectManagedTree({
    root: path.resolve(root),
    boundary: path.dirname(path.resolve(root)),
    assets: normalized,
    exact: true
  })
  await Promise.all(
    tree.unexpectedPaths.map((entry) => rm(entry, { recursive: true, force: true }))
  )
}

async function inspectManagedTree(options) {
  const readableAssets = new Set()
  const unexpectedPaths = []
  if (!(await directoryChainIsSafe(options.root, options.boundary))) {
    return { readableAssets, unexpectedPaths }
  }

  const expectedFiles = new Set(options.assets.map((asset) => asset.path))
  const expectedDirectories = expectedDirectorySet(options.assets)
  const safeDirectories = new Set([''])

  for (const directory of [...expectedDirectories].sort(byPathDepth)) {
    const parent = parentAssetPath(directory)
    if (!safeDirectories.has(parent)) continue
    const stats = await lstat(assetPath(options.root, directory)).catch(() => null)
    if (stats?.isDirectory() && !stats.isSymbolicLink()) safeDirectories.add(directory)
  }

  for (const asset of options.assets) {
    if (!safeDirectories.has(parentAssetPath(asset.path))) continue
    const stats = await lstat(assetPath(options.root, asset.path)).catch(() => null)
    if (stats?.isFile() && !stats.isSymbolicLink()) readableAssets.add(asset.path)
  }

  if (options.exact) {
    await walkExactTree(options.root, '', expectedFiles, expectedDirectories, unexpectedPaths)
  }
  return { readableAssets, unexpectedPaths }
}

async function walkExactTree(root, relative, expectedFiles, expectedDirectories, unexpectedPaths) {
  const directory = relative ? assetPath(root, relative) : root
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name
    const filename = assetPath(root, child)
    if (expectedFiles.has(child)) {
      if (!entry.isFile() || entry.isSymbolicLink()) unexpectedPaths.push(filename)
      continue
    }
    if (expectedDirectories.has(child)) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walkExactTree(root, child, expectedFiles, expectedDirectories, unexpectedPaths)
      } else {
        unexpectedPaths.push(filename)
      }
      continue
    }
    unexpectedPaths.push(filename)
  }
}

async function ensureManagedDirectory(target, boundary) {
  const absoluteBoundary = path.resolve(boundary)
  const absoluteTarget = path.resolve(target)
  const relative = path.relative(absoluteBoundary, absoluteTarget)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`受管目录不在安全边界内：${absoluteTarget}`)
  }
  const boundaryStats = await lstat(absoluteBoundary).catch(() => null)
  if (!boundaryStats?.isDirectory() || boundaryStats.isSymbolicLink()) {
    throw new Error(`资产安全边界不是普通目录：${absoluteBoundary}`)
  }

  let current = absoluteBoundary
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = await lstat(current).catch(() => null)
    if (stats?.isDirectory() && !stats.isSymbolicLink()) continue
    if (stats) await rm(current, { recursive: true, force: true })
    await mkdir(current)
  }
}

async function ensureAssetDirectories(root, assets) {
  for (const directory of [...expectedDirectorySet(assets)].sort(byPathDepth)) {
    const filename = assetPath(root, directory)
    const stats = await lstat(filename).catch(() => null)
    if (stats?.isDirectory() && !stats.isSymbolicLink()) continue
    if (stats) await rm(filename, { recursive: true, force: true })
    await mkdir(filename)
  }
}

async function directoryChainIsSafe(target, boundary) {
  const absoluteBoundary = path.resolve(boundary)
  const absoluteTarget = path.resolve(target)
  const relative = path.relative(absoluteBoundary, absoluteTarget)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return false

  let current = absoluteBoundary
  const boundaryStats = await lstat(current).catch(() => null)
  if (!boundaryStats?.isDirectory() || boundaryStats.isSymbolicLink()) return false
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = await lstat(current).catch(() => null)
    if (!stats?.isDirectory() || stats.isSymbolicLink()) return false
  }
  return true
}

function normalizeOptions(options, { repairRequired = true } = {}) {
  if (!options || typeof options !== 'object') throw new Error('缺少资产验证选项')
  const root = path.resolve(options.root)
  const boundary = path.resolve(options.boundary ?? path.dirname(root))
  const statePath = path.resolve(options.statePath)
  const assets = normalizeAssets(options.assets)
  if (repairRequired && typeof options.repair !== 'function') throw new Error('缺少资产恢复函数')
  return {
    ...options,
    root,
    boundary,
    statePath,
    assets,
    exact: options.exact !== false,
    forceHash: options.forceHash === true,
    cleanUnexpected: options.cleanUnexpected === true
  }
}

function normalizeAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('资产清单为空')
  const paths = new Set()
  return assets.map((asset) => {
    if (!asset || typeof asset !== 'object' || !isSafeAssetPath(asset.path)) {
      throw new Error(`资产路径无效：${asset?.path}`)
    }
    if (paths.has(asset.path)) throw new Error(`资产路径重复：${asset.path}`)
    paths.add(asset.path)
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`资产大小无效：${asset.path}`)
    }
    if (!SHA256_PATTERN.test(asset.sha256 || '')) {
      throw new Error(`资产 SHA-256 无效：${asset.path}`)
    }
    if (
      asset.mode !== undefined &&
      (!Number.isInteger(asset.mode) || asset.mode < 0 || asset.mode > 0o777)
    ) {
      throw new Error(`资产权限无效：${asset.path}`)
    }
    return { ...asset }
  })
}

function isSafeAssetPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  )
}

function expectedDirectorySet(assets) {
  const directories = new Set()
  for (const asset of assets) {
    let parent = parentAssetPath(asset.path)
    while (parent) {
      directories.add(parent)
      parent = parentAssetPath(parent)
    }
  }
  return directories
}

function parentAssetPath(value) {
  const index = value.lastIndexOf('/')
  return index === -1 ? '' : value.slice(0, index)
}

function byPathDepth(left, right) {
  return left.split('/').length - right.split('/').length || left.localeCompare(right)
}

function assetPath(root, relative) {
  return path.join(root, ...relative.split('/'))
}

function manifestSha256(assets, exact) {
  const manifest = assets
    .map(({ path: assetPath, size, sha256, mode }) => ({
      path: assetPath,
      size,
      sha256,
      ...(mode === undefined ? {} : { mode })
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
  return createHash('sha256')
    .update(JSON.stringify({ exact, assets: manifest }))
    .digest('hex')
}

function assetStatsAreValid(stats, asset) {
  return (
    stats.isFile() &&
    !stats.isSymbolicLink() &&
    stats.size === BigInt(asset.size) &&
    (asset.mode === undefined || Number(stats.mode & 0o777n) === asset.mode)
  )
}

function fileFingerprint(stats) {
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mode: stats.mode.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString()
  }
}

function sameFingerprint(left, right) {
  return (
    isFingerprint(left) &&
    isFingerprint(right) &&
    Object.keys(right).every((property) => left[property] === right[property])
  )
}

function isFingerprint(value) {
  return (
    value &&
    typeof value === 'object' &&
    ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs'].every(
      (property) => typeof value[property] === 'string'
    )
  )
}

async function lstatBigInt(filename) {
  return lstat(filename, { bigint: true })
}

async function readVerificationState(filename) {
  try {
    const stats = await lstat(filename)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_STATE_BYTES) return null
    return JSON.parse(await readFile(filename, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonAtomically(filename, value, boundary) {
  await ensureManagedDirectory(path.dirname(filename), boundary)
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
  let handle = null
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rm(filename, { recursive: true, force: true })
    await rename(temporary, filename)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

module.exports = {
  assertAssetFile,
  cleanUnexpectedEntries,
  ensureAssetSet,
  ensureManagedDirectory,
  isSafeAssetPath,
  manifestSha256,
  quickAssetSetIsValid,
  recordAssetSetVerification,
  sha256File,
  verifyAssetSet
}
