/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawnSync } from 'node:child_process'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import integrity from '../asset-integrity.js'
import { externalRoot, loadConfig, runtimeTarget } from './config.mjs'
import { selectRuntimeAssets } from './download-release-assets.mjs'

export function parseOptions(argv) {
  const options = { target: runtimeTarget() }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index],
      value = argv[index + 1]
    const key = { '--artifact-dir': 'artifactDirectory', '--target': 'target' }[flag]
    if (!key || !value || value.startsWith('--') || seen.has(flag))
      throw new Error(
        'Usage: yarn index-tts:install-runtime --artifact-dir <directory> [--target linux-x64|win32-x64]'
      )
    seen.add(flag)
    options[key] = value
  }
  if (!options.artifactDirectory || !['linux-x64', 'win32-x64'].includes(options.target))
    throw new Error('An artifact directory and supported target are required')
  return options
}

export function validateManifest(manifest, target, config) {
  if (
    manifest.revision !== config.runtime.revision ||
    manifest.ggmlTree !== config.runtime.ggmlTree ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.some((asset) => asset.target !== target)
  )
    throw new Error('Runtime manifest differs from the pinned source or target')
  const assets = selectRuntimeAssets(
    { runtimeRelease: { ...config.runtimeRelease, assets: manifest.assets } },
    target
  )
  for (const asset of assets) {
    if (
      ['.', '..', 'artifact-manifest.json'].includes(asset.path) ||
      asset.name !== `${target}-${asset.path}`
    )
      throw new Error('Invalid CI runtime asset filename')
  }
  const names = assets.map((asset) => asset.path)
  const windows = target === 'win32-x64'
  const dependencies = ['cublas', 'cublasLt', 'cudart', 'cufft', 'nvJitLink']
  for (const dependency of dependencies) {
    const pattern = windows
      ? new RegExp(`^${dependency}[0-9_]+\\.dll$`, 'i')
      : new RegExp(`^lib${dependency}\\.so(?:\\.\\d+)+$`)
    if (!names.some((name) => pattern.test(name)))
      throw new Error(`Missing CUDA dependency: ${dependency}`)
  }
  if (
    !names.includes('build-cuda.json') ||
    !names.some((name) =>
      windows ? name === 'audiocpp.dll' : /^libaudiocpp\.so(?:\.\d+)*$/.test(name)
    )
  )
    throw new Error('Missing IndexTTS library or build metadata')
  if (!names.some((name) => /^LICENSE\.NVIDIA-CUDA\.(?:txt|html)$/.test(name)))
    throw new Error('Missing NVIDIA CUDA license')
  if (
    windows &&
    ['msvcp', 'vcruntime'].some(
      (prefix) =>
        !names.some(
          (name) => name.toLowerCase().startsWith(prefix) && name.toLowerCase().endsWith('.dll')
        )
    )
  )
    throw new Error('Missing Windows MSVC runtime dependency')
  return assets
}

export function probeRuntime(directory, target) {
  if (target !== runtimeTarget()) return { status: 'not-run', reason: 'Different host platform' }
  const helper = path.join(
    directory,
    `ls101-index-tts-helper-cuda${target.startsWith('win32') ? '.exe' : ''}`
  )
  const env = { ...process.env }
  if (process.platform === 'linux')
    env.LD_LIBRARY_PATH = [directory, env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter)
  const result = spawnSync(helper, [], { encoding: 'utf8', env, windowsHide: true, timeout: 30000 })
  if (result.status !== 1 || !result.stderr?.includes('An absolute --model path is required'))
    throw new Error(
      `Runtime startup failed: ${result.error?.message || result.stderr || result.status}`
    )
  return { status: 'passed' }
}

export async function installRuntime({
  artifactDirectory,
  target = runtimeTarget(),
  config = loadConfig(),
  runtimeRoot = path.join(externalRoot, 'runtime'),
  probe = probeRuntime
}) {
  if (!['linux-x64', 'win32-x64'].includes(target)) throw new Error('Unsupported runtime target')
  const manifest = JSON.parse(
    await readFile(path.join(artifactDirectory, `${target}-manifest.json`), 'utf8')
  )
  const assets = validateManifest(manifest, target, config)
  await mkdir(runtimeRoot, { recursive: true })
  const staging = await mkdtemp(path.join(runtimeRoot, `.${target}-install-`))
  const destination = path.join(runtimeRoot, target)
  const backup = `${staging}.previous`
  try {
    for (const asset of assets) {
      const input = path.join(artifactDirectory, asset.name)
      await integrity.assertAssetFile(input, asset)
      const output = path.join(staging, asset.path)
      await copyFile(input, output)
      await integrity.assertAssetFile(output, asset)
      if (asset.path === 'ls101-index-tts-helper-cuda') await chmod(output, 0o755)
    }
    const build = JSON.parse(await readFile(path.join(staging, 'build-cuda.json'), 'utf8'))
    if (
      build.sourceCommit !== config.runtime.revision ||
      build.ggmlTree !== config.runtime.ggmlTree ||
      build.target !== target ||
      build.backend !== 'cuda' ||
      build.cudaArchitectures !== config.runtime.cudaArchitectures
    )
      throw new Error('Runtime build metadata differs from the pinned configuration')
    const startup = await probe(staging, target)
    await writeFile(
      path.join(staging, 'artifact-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    const previous = await lstat(destination).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (previous && (!previous.isDirectory() || previous.isSymbolicLink()))
      throw new Error('Runtime destination must be a directory')
    if (previous) await rename(destination, backup)
    try {
      await rename(staging, destination)
    } catch (error) {
      if (previous) await rename(backup, destination)
      throw error
    }
    await rm(backup, { recursive: true, force: true })
    return { target, directory: destination, startup, manifest }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve()
    .then(() => installRuntime(parseOptions(process.argv.slice(2))))
    .then((result) => {
      console.log(
        `[index-tts] verified ${result.manifest.assets.length} assets; installed ${result.directory}; startup=${result.startup.status}`
      )
    })
    .catch((error) => {
      console.error(`[index-tts] runtime installation failed: ${error.message}`)
      process.exitCode = 1
    })
}
