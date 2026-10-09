/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import integrity from '../asset-integrity.js'
import download from '../download-asset.js'
import { externalRoot, loadConfig, modelAsset, root, runtimeTarget } from './config.mjs'
import { assembleModelParts, modelReleaseParts } from './model-release.mjs'

const { ensureAssetSet, assertAssetFile } = integrity

export function parseOptions(argv) {
  const allowed = ['--verify', '--verify-upstream', '--models-only']
  if (argv.some((flag) => !allowed.includes(flag)))
    throw new Error('Unknown IndexTTS download option')
  return {
    verify: argv.includes('--verify'),
    verifyUpstream: argv.includes('--verify-upstream'),
    modelsOnly: argv.includes('--models-only')
  }
}

export function selectRuntimeAssets(config, target) {
  const release = config.runtimeRelease
  const files = release.assets.filter((asset) => asset.target === target)
  if (
    !files.length ||
    !files.some(
      (asset) =>
        asset.path === `ls101-index-tts-helper-cuda${target.startsWith('win32') ? '.exe' : ''}`
    )
  ) {
    throw new Error(`No pinned IndexTTS runtime for ${target}`)
  }
  const names = new Set(),
    paths = new Set()
  return files.map((asset) => {
    if (
      !/^[\w.-]+$/.test(asset.name) ||
      !/^[\w.-]+$/.test(asset.path) ||
      names.has(asset.name) ||
      paths.has(asset.path) ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      throw new Error('Invalid pinned IndexTTS runtime asset')
    names.add(asset.name)
    paths.add(asset.path)
    return {
      ...asset,
      url: `https://github.com/${release.repository}/releases/download/${release.tag}/${encodeURIComponent(asset.name)}`
    }
  })
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  return { 'user-agent': 'ls101-index-tts', ...(token ? { authorization: `Bearer ${token}` } : {}) }
}

export async function main(options = {}) {
  const environment = options.environment ?? process.env
  if (environment.LS101_SKIP_INDEX_TTS_DOWNLOAD === '1') {
    console.log('[index-tts] asset setup and cleanup skipped')
    return
  }
  const flags = parseOptions(options.arguments ?? [])
  const config = options.config ?? loadConfig()
  const target = runtimeTarget(options.platform ?? process.platform, options.arch ?? process.arch)
  if (!flags.modelsOnly && !target) {
    console.log('[index-tts] runtime is unavailable for this platform')
    return
  }
  // No invented release digests: pin the outputs after the first native release.
  // Explicit model preparation can already use the immutable upstream GGUF.
  if (!flags.modelsOnly && !config.runtimeRelease.published) {
    console.log(
      '[index-tts] runtime release is not published; keeping local runtime files. Build with yarn index-tts:build-runtime --backend cuda; prepare models with yarn index-tts:prepare'
    )
    return
  }
  const boundary = options.boundary ?? root
  const directory = options.externalRoot ?? externalRoot
  const stateDirectory = path.join(directory, '.verification')
  const runtimeAssets = flags.modelsOnly ? [] : selectRuntimeAssets(config, target)
  const model = modelAsset(config)
  const parts = config.modelRelease.published ? modelReleaseParts(config) : []
  if (flags.verifyUpstream) {
    if (runtimeAssets.length) {
      const response = await fetch(
        `https://api.github.com/repos/${config.runtimeRelease.repository}/releases/tags/${config.runtimeRelease.tag}`,
        { headers: githubHeaders() }
      )
      if (!response.ok) throw new Error(`Runtime metadata request failed: ${response.status}`)
      const release = await response.json()
      if (release.tag_name !== config.runtimeRelease.tag || release.draft)
        throw new Error('Invalid IndexTTS release metadata')
      for (const asset of runtimeAssets) {
        const actual = release.assets.find((item) => item.name === asset.name)
        if (actual?.size !== asset.size || actual?.digest !== `sha256:${asset.sha256}`)
          throw new Error(`Runtime release metadata differs: ${asset.name}`)
      }
    }
    if (!config.modelRelease.published) {
      const response = await fetch(
        `https://huggingface.co/api/models/${config.model.ggufRepository}/revision/${config.model.ggufRevision}?blobs=true`
      )
      if (!response.ok) throw new Error(`Model metadata request failed: ${response.status}`)
      const metadata = await response.json()
      const actual = metadata.siblings.find((item) => item.rfilename === config.model.upstreamPath)
      if (actual?.lfs?.sha256 !== model.sha256 || actual?.size !== model.size)
        throw new Error('Model metadata differs from pinned GGUF')
    } else {
      const response = await fetch(
        `https://api.github.com/repos/${config.modelRelease.repository}/releases/tags/${config.modelRelease.tag}`,
        { headers: githubHeaders() }
      )
      if (!response.ok) throw new Error(`Model release metadata request failed: ${response.status}`)
      const release = await response.json()
      if (release.draft || release.tag_name !== config.modelRelease.tag)
        throw new Error('Model release metadata differs')
      for (const part of parts) {
        const actual = release.assets.find((asset) => asset.name === part.name)
        if (actual?.size !== part.size || actual?.digest !== `sha256:${part.sha256}`)
          throw new Error(`Model release metadata differs: ${part.name}`)
      }
    }
  }
  if (runtimeAssets.length) {
    const cache = path.join(directory, 'downloads', 'releases', target)
    await ensureAssetSet({
      boundary,
      root: cache,
      statePath: path.join(stateDirectory, `${target}-cache.json`),
      assets: runtimeAssets.map((asset) => ({ ...asset, path: asset.name })),
      exact: true,
      forceHash: flags.verify,
      repair: (asset, destination) =>
        download.downloadVerifiedAsset(asset, destination, `[index-tts] ${asset.name}`, {
          headers: githubHeaders
        })
    })
    await ensureAssetSet({
      boundary,
      root: path.join(directory, 'runtime', target),
      statePath: path.join(stateDirectory, `${target}-runtime.json`),
      assets: runtimeAssets.map((asset) => ({
        ...asset,
        ...(asset.path.startsWith('ls101-') && !target.startsWith('win32') ? { mode: 0o755 } : {})
      })),
      exact: true,
      forceHash: flags.verify,
      repair: async (asset, destination) => {
        await mkdir(path.dirname(destination), { recursive: true })
        const temporary = `${destination}.${randomUUID()}.part`
        try {
          await copyFile(path.join(cache, asset.name), temporary)
          if (asset.mode) await chmod(temporary, asset.mode)
          await assertAssetFile(temporary, asset)
          await rename(temporary, destination)
        } finally {
          await rm(temporary, { force: true })
        }
      }
    })
  }
  if (environment.LS101_INDEX_TTS_RUNTIME_ONLY === '1' && !flags.modelsOnly) return
  await ensureAssetSet({
    boundary,
    root: path.join(directory, 'models'),
    statePath: path.join(stateDirectory, 'models.json'),
    assets: [model],
    exact: true,
    forceHash: flags.verify,
    repair: async (asset, destination) => {
      if (!parts.length)
        return download.downloadVerifiedAsset(asset, destination, `[index-tts] ${asset.name}`)
      const cache = path.join(directory, 'downloads', 'model-parts')
      await ensureAssetSet({
        boundary,
        root: cache,
        statePath: path.join(stateDirectory, 'model-parts.json'),
        assets: parts,
        exact: true,
        forceHash: flags.verify,
        repair: (part, filename) =>
          download.downloadVerifiedAsset(part, filename, `[index-tts] ${part.name}`, {
            headers: githubHeaders
          })
      })
      return assembleModelParts({ parts, directory: cache, destination, model: asset })
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main({ arguments: process.argv.slice(2) }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
