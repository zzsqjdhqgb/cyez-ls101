/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * Builds the IndexTTS 2.5 model package: one ZIP containing the fp16 weights, the runtime helper plus
 * its shared libraries, both reference voices, and the package manifest — then slices it into volumes
 * that respect the release asset size limit.
 *
 * The runtime ships inside the package by decision; the application only carries the helper's digest
 * allowlist (packages/airouter/src/main/index-tts-runtime.ts) and refuses to execute anything else.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile, splitVolumes, writeStoreZip } from './zip64-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRoot = path.resolve(here, '..', '..')

/** GitHub rejects release assets above 2 GiB; leave 1 MiB of headroom. */
const DEFAULT_VOLUME_BYTES = 2 * 1024 * 1024 * 1024 - 1024 * 1024
const SYNTHESIS_PARAMETERS = {
  weightType: 'f16',
  language: 'auto',
  threads: 4,
  numBeams: 3,
  doSample: true,
  temperature: 0.8,
  topK: 30,
  topP: 0.8,
  repetitionPenalty: 10.0,
  maxMelTokens: 1500,
  durationFactor: 1.0,
  emotionAlpha: 1.0
}

export async function buildPackage(options = {}) {
  const root = options.root ?? defaultRoot
  const assets = JSON.parse(
    await readFile(options.assetsPath ?? path.join(here, 'assets.json'), 'utf8')
  )
  const packageVersion = options.packageVersion ?? assets.package.version
  const platform = options.platform ?? `${process.platform}-${process.arch}`
  const volumeBytes = options.volumeBytes ?? DEFAULT_VOLUME_BYTES
  const outputPath = path.resolve(
    root,
    options.output ?? path.join('dist', `index-tts-2.5-f16-${platform}-${packageVersion}.zip`)
  )

  const modelPath =
    options.modelPath ??
    path.join(root, 'externals/ai/index-tts/models', path.basename(assets.model.file))
  await assertFile(
    modelPath,
    `缺少 IndexTTS 权重文件：${modelPath}；请先运行 yarn index-tts:download`
  )

  const runtimeDirectory = path.join(root, 'externals/ai/index-tts/runtime', platform)
  const helperBaseName = assets.runtime.helperName ?? 'ls101-index-tts-helper'
  const helperName = `${helperBaseName}-cuda${platform.startsWith('win32') ? '.exe' : ''}`
  const helperPath = path.join(runtimeDirectory, helperName)
  await assertFile(
    helperPath,
    `缺少 IndexTTS 运行时：${helperPath}；请先运行 node scripts/index-tts/build-runtime.mjs --backend cuda`
  )

  const runtimeFiles = (await readdir(runtimeDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
  const helperArchivePath = `runtime/${platform}/${helperName}`
  const libraryArchivePaths = runtimeFiles
    .filter((name) => name !== helperName)
    .map((name) => `runtime/${platform}/${name}`)

  const voices = []
  for (const voice of assets.voices) {
    const voicePath = path.join(root, voice.file)
    await assertFile(voicePath, `缺少参考音色：${voicePath}`)
    const info = await hashFile(voicePath)
    voices.push({ ...voice, archivePath: `voices/${path.basename(voice.file)}`, ...info })
  }

  const modelInfo = await hashFile(modelPath)
  const helperInfo = await hashFile(helperPath)

  /** archive path -> source path, preserving insertion order for the archive. */
  const sources = new Map()
  const manifestAssets = []
  const addAsset = (archivePath, kind, info, sourcePath) => {
    sources.set(archivePath, sourcePath)
    manifestAssets.push({ path: archivePath, kind, size: info.size, sha256: info.sha256 })
    return info
  }

  addAsset(helperArchivePath, 'runtime-helper', helperInfo, helperPath)
  for (const archivePath of libraryArchivePaths) {
    const sourcePath = path.join(runtimeDirectory, path.basename(archivePath))
    addAsset(archivePath, 'runtime-library', await hashFile(sourcePath), sourcePath)
  }
  addAsset(`models/${path.basename(assets.model.file)}`, 'tts-model', modelInfo, modelPath)
  for (const voice of voices) {
    addAsset(voice.archivePath, 'voice-reference', voice, path.join(root, voice.file))
  }

  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: {
      id: options.packageId ?? `indextts-2.5-f16-${platform}`,
      version: packageVersion,
      name: `IndexTTS 2.5 fp16 (${platform})`,
      description:
        'IndexTTS 2.5 zero-shot voice cloning, zh/en/ja/es/ar, fp16 weights with the CUDA runtime.'
    },
    runtime: {
      engine: 'index-tts',
      engineApiVersion: 1,
      minimumAppVersion: options.minimumAppVersion ?? '0.5.0'
    },
    assets: manifestAssets,
    models: [
      {
        id: 'index-tts2.5-f16',
        name: 'IndexTTS 2.5 fp16',
        languageCodes: ['zh', 'en', 'ja', 'es', 'ar'],
        artifacts: {
          'tts-model': [`models/${path.basename(assets.model.file)}`],
          'runtime-helper': [helperArchivePath]
        },
        parameters: { synthesis: { ...SYNTHESIS_PARAMETERS, ...(options.synthesis ?? {}) } }
      }
    ],
    voices: voices.map((voice) => ({
      id: voice.id,
      name: voice.name,
      languageCodes: ['en'],
      files: [voice.archivePath]
    })),
    extensions: {
      upstream: {
        model: assets.model.repository,
        mirror: assets.model.mirror?.repository,
        revision: assets.model.revision,
        quantization: assets.model.quantization,
        runtime: { repository: assets.runtime.repository, revision: assets.runtime.revision }
      }
    }
  }

  const manifestPath = path.join(path.dirname(outputPath), 'manifest.json')
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const entries = [
    { name: 'manifest.json', path: manifestPath },
    ...[...sources].map(([name, sourcePath]) => ({ name, path: sourcePath }))
  ]

  const archive = await writeStoreZip({
    outputPath,
    entries,
    onProgress: options.onProgress
  })

  let volumes = null
  if (!options.noSplit) {
    const prefix = path.basename(outputPath, '.zip')
    const split = await splitVolumes({ archivePath: outputPath, volumeBytes, prefix })
    const archiveHash = await hashFile(outputPath)
    volumes = {
      archive: path.basename(outputPath),
      archiveBytes: split.bytes,
      archiveSha256: archiveHash.sha256,
      volumeBytes,
      parts: split.parts.map((part) => ({
        index: part.index,
        name: part.name,
        size: part.size,
        sha256: part.sha256
      }))
    }
    await writeFile(
      path.join(path.dirname(outputPath), `${prefix}-volumes.json`),
      `${JSON.stringify(volumes, null, 2)}\n`,
      'utf8'
    )
  }

  const manifestHash = await hashFile(manifestPath)
  return {
    outputPath,
    manifestPath,
    manifest,
    manifestSha256: manifestHash.sha256,
    archiveBytes: archive.bytes,
    entryCount: archive.entries.length,
    volumes
  }
}

async function assertFile(filePath, message) {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) throw new Error(message)
}

export function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--platform') options.platform = argv[++index]
    else if (flag === '--output') options.output = argv[++index]
    else if (flag === '--volume-bytes') options.volumeBytes = Number.parseInt(argv[++index], 10)
    else if (flag === '--package-version') options.packageVersion = argv[++index]
    else if (flag === '--no-split') options.noSplit = true
    else if (flag === '--help' || flag === '-h') options.help = true
    else throw new Error(`未知参数：${flag}`)
  }
  return options
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log(`用法：node scripts/index-tts/build-package.mjs [选项]

  --platform <key>        目标平台，默认 ${process.platform}-${process.arch}
  --output <path>         ZIP 输出路径
  --volume-bytes <n>      分卷大小，默认 2 GiB - 1 MiB
  --package-version <v>   覆盖 assets.json 中的包版本
  --no-split              只生成单个 ZIP，不切分卷
`)
    process.exit(0)
  }
  try {
    const result = await buildPackage(options)
    console.log(`[index-tts] package written: ${result.outputPath} (${result.entryCount} entries)`)
    console.log(`[index-tts] manifest sha256: ${result.manifestSha256}`)
    if (result.volumes) {
      console.log(
        `[index-tts] archive ${result.volumes.archiveSha256} split into ${result.volumes.parts.length} volume(s)`
      )
      for (const part of result.volumes.parts) {
        console.log(`  ${part.name}  ${part.size} B  ${part.sha256}`)
      }
    }
  } catch (error) {
    console.error(`[index-tts] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
