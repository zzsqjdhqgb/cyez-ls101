/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()
const downloadDirectory = path.join(root, 'model-assets', 'downloads', 'qwen-tts')
const apiBase = `https://api.github.com/repos/${config.release.repository}/releases/tags/${config.release.tag}`

export function loadConfig() {
  return JSON.parse(readFileSync(path.join(root, 'scripts', 'qwen-tts', 'assets.json'), 'utf8'))
}

export function runtimeTarget(platform = process.platform, architecture = process.arch) {
  if (architecture !== 'x64') return null
  if (platform === 'linux') {
    return {
      directory: 'linux-x64',
      name: 'ls101-qwen-tts-helper-linux-x64',
      executable: 'ls101-qwen-tts-helper'
    }
  }
  if (platform === 'win32') {
    return {
      directory: 'win32-x64',
      name: 'ls101-qwen-tts-helper-win32-x64.exe',
      executable: 'ls101-qwen-tts-helper.exe'
    }
  }
  return null
}

export function modelAssetNames() {
  return {
    talker: `qwen3-tts-0.6b-${config.model.quantization}.gguf`,
    tokenizer: 'qwen3-tts-tokenizer-f16.gguf'
  }
}

export function selectReleaseAssets(release, target = runtimeTarget()) {
  if (
    !release ||
    release.tag_name !== config.release.tag ||
    release.draft ||
    release.prerelease !== config.release.prerelease
  ) {
    throw new Error(`Qwen TTS Release 无效：${config.release.tag}`)
  }
  const assets = Array.isArray(release.assets) ? release.assets : []
  const find = (name) => {
    const asset = assets.find((candidate) => candidate?.name === name)
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Qwen TTS Release 缺少有效资产：${name}`)
    }
    if (
      typeof asset.browser_download_url !== 'string' ||
      !asset.browser_download_url.startsWith('https://')
    ) {
      throw new Error(`Qwen TTS Release 资产下载地址无效：${name}`)
    }
    const digest = typeof asset.digest === 'string' ? asset.digest : ''
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Qwen TTS Release 资产缺少 SHA-256 digest：${name}`)
    }
    return {
      name,
      size: asset.size,
      digest: digest.slice('sha256:'.length),
      url: asset.browser_download_url
    }
  }
  const modelNames = modelAssetNames()
  const selected = {
    models: {
      talker: find(modelNames.talker),
      tokenizer: find(modelNames.tokenizer)
    }
  }
  if (target) selected.helper = find(target.name)
  selected.manifest = find('qwen-tts-release-manifest.json')
  return selected
}

async function fetchJson(url) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'cyez-ls101-qwen-tts',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  })
  if (!response.ok) throw new Error(`Qwen TTS Release API 请求失败（HTTP ${response.status}）`)
  return response.json()
}

async function downloadAsset(asset, destination) {
  const existing = await stat(destination).catch(() => null)
  if (
    existing?.isFile() &&
    existing.size === asset.size &&
    (await hashFile(destination)) === asset.digest
  ) {
    return false
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.part`
  let offset = (await stat(temporary).catch(() => null))?.size ?? 0
  if (offset > asset.size) {
    await rm(temporary, { force: true })
    offset = 0
  }
  if (offset === asset.size && (await hashFile(temporary)) === asset.digest) {
    await rename(temporary, destination)
    return true
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  const rangeHeaders = {
    accept: 'application/octet-stream',
    'user-agent': 'cyez-ls101-qwen-tts',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(offset > 0 ? { range: `bytes=${offset}-` } : {})
  }
  const response = await fetch(asset.url, {
    headers: rangeHeaders
  })
  if (!response.ok || !response.body)
    throw new Error(`下载 Qwen TTS 资产失败（${asset.name}，HTTP ${response.status}）`)
  if (offset > 0 && response.status !== 206) {
    await rm(temporary, { force: true })
    offset = 0
  }
  const contentRange = response.headers.get('content-range')
  if (offset > 0 && contentRange !== `bytes ${offset}-${asset.size - 1}/${asset.size}`) {
    throw new Error(`Qwen TTS 资产续传响应无效：${asset.name}`)
  }
  await pipeline(response.body, createWriteStream(temporary, { flags: offset > 0 ? 'a' : 'w' }))
  const details = await stat(temporary)
  const digest = await hashFile(temporary)
  if (details.size > asset.size || (details.size === asset.size && digest !== asset.digest)) {
    await rm(temporary, { force: true })
    throw new Error(`Qwen TTS 资产校验失败：${asset.name}`)
  }
  if (details.size !== asset.size) {
    throw new Error(`Qwen TTS 资产下载未完成：${asset.name}（${details.size}/${asset.size}）`)
  }
  await rename(temporary, destination)
  return true
}

async function hashFile(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function main() {
  if (process.env.LS101_SKIP_QWEN_TTS_DOWNLOAD === '1') {
    console.log('[qwen-tts] download skipped by LS101_SKIP_QWEN_TTS_DOWNLOAD')
    return
  }
  const target = runtimeTarget()
  if (!target) {
    console.warn(
      `[qwen-tts] 当前平台 ${process.platform}/${process.arch} 没有已发布的 CPU helper，跳过下载`
    )
    return
  }
  const metadataPath = path.join(downloadDirectory, 'release-api.json')
  const release = await loadReleaseMetadata(metadataPath)
  const assets = selectReleaseAssets(release, target)
  const helperCachePath = path.join(downloadDirectory, 'releases', assets.helper.name)
  const helperPath = path.join(root, 'resources', 'qwen-tts', target.directory, target.executable)
  const modelDirectory = path.join(root, 'model-assets', 'qwen-tts', 'models')
  const manifestPath = path.join(downloadDirectory, 'releases', assets.manifest.name)
  const helperDownloaded = await downloadAsset(assets.helper, helperCachePath)
  await mkdir(path.dirname(helperPath), { recursive: true })
  await copyFile(helperCachePath, helperPath)
  const modelDownloads = await Promise.all(
    Object.values(assets.models).map(async (asset) => ({
      asset,
      downloaded: await downloadAsset(asset, path.join(modelDirectory, asset.name))
    }))
  )
  await downloadAsset(assets.manifest, manifestPath)
  if (process.platform !== 'win32') await chmod(helperPath, 0o755)
  console.log(`[qwen-tts] helper ${helperDownloaded ? 'downloaded' : 'cached'}: ${helperPath}`)
  for (const { asset, downloaded } of modelDownloads) {
    console.log(
      `[qwen-tts] model ${downloaded ? 'downloaded' : 'cached'}: ${path.join(modelDirectory, asset.name)}`
    )
  }
}

async function loadReleaseMetadata(cachePath) {
  try {
    const release = await fetchJson(apiBase)
    selectReleaseAssets(release, runtimeTarget())
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, `${JSON.stringify(release, null, 2)}\n`, 'utf8')
    return release
  } catch (error) {
    const cached = await readFile(cachePath, 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => null)
    if (cached) {
      selectReleaseAssets(cached, runtimeTarget())
      console.warn(
        `[qwen-tts] Release API 不可用，使用已缓存的元数据：${error instanceof Error ? error.message : error}`
      )
      return cached
    }
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
