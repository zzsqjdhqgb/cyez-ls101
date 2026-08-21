/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..', '..')
const config = loadConfig()
const downloadDirectory = path.join(root, 'externals', 'ai', 'qwen3-tts', 'downloads')

export function loadConfig() {
  return JSON.parse(readFileSync(path.join(root, 'scripts', 'qwen-tts', 'assets.json'), 'utf8'))
}

export function runtimeTarget(platform = process.platform, architecture = process.arch) {
  if (architecture !== 'x64') return null
  if (platform === 'linux') {
    return {
      directory: 'linux-x64',
      helpers: {
        cpu: {
          name: 'ls101-qwen-tts-helper-cpu-linux-x64',
          executable: 'ls101-qwen-tts-helper-cpu'
        },
        cuda: {
          name: 'ls101-qwen-tts-helper-cuda-linux-x64',
          executable: 'ls101-qwen-tts-helper-cuda'
        }
      }
    }
  }
  if (platform === 'win32') {
    return {
      directory: 'win32-x64',
      helpers: {
        cpu: {
          name: 'ls101-qwen-tts-helper-cpu-win32-x64.exe',
          executable: 'ls101-qwen-tts-helper-cpu.exe'
        },
        cuda: {
          name: 'ls101-qwen-tts-helper-cuda-win32-x64.exe',
          executable: 'ls101-qwen-tts-helper-cuda.exe'
        }
      }
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

export function downloadMode(environment = process.env) {
  if (environment.LS101_SKIP_QWEN_TTS_DOWNLOAD === '1') return 'skip'
  if (environment.LS101_QWEN_TTS_RUNTIME_ONLY === '1') return 'runtime-only'
  return 'all'
}

export function selectRuntimeReleaseAssets(release, target = runtimeTarget()) {
  validateRelease(release, config.runtimeRelease)
  const assets = Array.isArray(release.assets) ? release.assets : []
  if (!target) throw new Error('当前平台没有 Qwen TTS 原生运行时')
  return {
    helpers: Object.fromEntries(
      Object.entries(target.helpers).map(([backend, helper]) => [
        backend,
        findAsset(assets, helper.name)
      ])
    ),
    manifest: findAsset(assets, 'qwen-tts-runtime-manifest.json')
  }
}

export function selectModelReleaseAssets(release) {
  validateRelease(release, config.modelRelease)
  const assets = Array.isArray(release.assets) ? release.assets : []
  const modelNames = modelAssetNames()
  return {
    models: {
      talker: findAsset(assets, modelNames.talker),
      tokenizer: findAsset(assets, modelNames.tokenizer)
    },
    manifest: findAsset(assets, 'qwen-tts-model-manifest.json')
  }
}

function validateRelease(release, expected) {
  if (
    !release ||
    release.tag_name !== expected.tag ||
    release.draft ||
    release.prerelease !== expected.prerelease
  ) {
    throw new Error(`Qwen TTS Release 无效：${expected.tag}`)
  }
}

function findAsset(assets, name) {
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
  const mode = downloadMode()
  if (mode === 'skip') {
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
  const runtimeRelease = await loadReleaseMetadata(
    config.runtimeRelease,
    path.join(downloadDirectory, 'runtime-release-api.json'),
    (release) => selectRuntimeReleaseAssets(release, target)
  )
  const runtimeAssets = selectRuntimeReleaseAssets(runtimeRelease, target)
  const runtimeDirectory = path.join(
    root,
    'externals',
    'ai',
    'qwen3-tts',
    'runtime',
    target.directory
  )
  const helperDownloads = await Promise.all(
    Object.entries(runtimeAssets.helpers).map(async ([backend, asset]) => {
      const helper = target.helpers[backend]
      const cachePath = path.join(downloadDirectory, 'releases', asset.name)
      const helperPath = path.join(runtimeDirectory, helper.executable)
      const downloaded = await downloadAsset(asset, cachePath)
      await mkdir(path.dirname(helperPath), { recursive: true })
      await copyFile(cachePath, helperPath)
      if (process.platform !== 'win32') await chmod(helperPath, 0o755)
      return { backend, downloaded, helperPath }
    })
  )
  await rm(
    path.join(
      runtimeDirectory,
      process.platform === 'win32' ? 'ls101-qwen-tts-helper.exe' : 'ls101-qwen-tts-helper'
    ),
    { force: true }
  )
  await downloadAsset(
    runtimeAssets.manifest,
    path.join(downloadDirectory, 'releases', runtimeAssets.manifest.name)
  )
  for (const { backend, downloaded, helperPath } of helperDownloads) {
    console.log(
      `[qwen-tts] ${backend} helper ${downloaded ? 'downloaded' : 'cached'}: ${helperPath}`
    )
  }
  if (mode === 'runtime-only') {
    console.log('[qwen-tts] model download skipped in runtime-only mode')
    return
  }

  const modelRelease = await loadReleaseMetadata(
    config.modelRelease,
    path.join(downloadDirectory, 'model-release-api.json'),
    selectModelReleaseAssets
  )
  const modelAssets = selectModelReleaseAssets(modelRelease)
  const modelDirectory = path.join(root, 'externals', 'ai', 'qwen3-tts', 'models')
  const modelDownloads = await Promise.all(
    Object.values(modelAssets.models).map(async (asset) => ({
      asset,
      downloaded: await downloadAsset(asset, path.join(modelDirectory, asset.name))
    }))
  )
  await downloadAsset(
    modelAssets.manifest,
    path.join(downloadDirectory, 'releases', modelAssets.manifest.name)
  )
  for (const { asset, downloaded } of modelDownloads) {
    console.log(
      `[qwen-tts] model ${downloaded ? 'downloaded' : 'cached'}: ${path.join(modelDirectory, asset.name)}`
    )
  }
}

async function loadReleaseMetadata(releaseConfig, cachePath, selectAssets) {
  try {
    const release = await fetchJson(
      `https://api.github.com/repos/${releaseConfig.repository}/releases/tags/${releaseConfig.tag}`
    )
    selectAssets(release)
    await mkdir(path.dirname(cachePath), { recursive: true })
    await writeFile(cachePath, `${JSON.stringify(release, null, 2)}\n`, 'utf8')
    return release
  } catch (error) {
    const cached = await readFile(cachePath, 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => null)
    if (cached) {
      selectAssets(cached)
      console.warn(
        `[qwen-tts] ${releaseConfig.tag} API 不可用，使用已缓存的元数据：${error instanceof Error ? error.message : error}`
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
