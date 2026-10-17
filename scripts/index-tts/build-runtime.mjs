/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..', '..')
const downloadDirectory = path.join(root, 'externals', 'ai', 'index-tts', 'downloads')
const sourceDir = path.join(downloadDirectory, 'audio.cpp')
const backend = parseBackend(process.argv.slice(2))
const helperBuildDir = path.join(downloadDirectory, `index-tts-helper-build-${backend}`)
const outputDir = path.join(
  root,
  'externals',
  'ai',
  'index-tts',
  'runtime',
  `${process.platform}-${process.arch}`
)
const assetConfig = loadAssetConfig()
const repository = assetConfig.runtime.repository
const commit = assetConfig.runtime.revision
const ggmlTree = assetConfig.runtime.ggmlRevision
const cudaArchitectures = '75;86-real;89-real;120a-real'
const cmakeGenerator = process.env.INDEX_TTS_CMAKE_GENERATOR?.trim()
const compilerLauncher = process.env.SCCACHE_PATH?.trim()
const patchPath = path.join(root, 'native', 'index-tts', 'content-addressed-gguf.patch')
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))
const minimumHelperBytes = 1_000_000
const cudaLicenseUrl = 'https://docs.nvidia.com/cuda/eula/index.html'

function parseBackend(args) {
  if (args.length !== 2 || args[0] !== '--backend' || !['cpu', 'cuda'].includes(args[1])) {
    throw new Error('Usage: yarn index-tts:build-runtime --backend cpu|cuda')
  }
  return args[1]
}

function loadAssetConfig() {
  const file = path.join(import.meta.dirname, 'assets.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    typeof value.runtime?.repository !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.revision ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.ggmlRevision ?? '')
  ) {
    throw new Error(`Invalid IndexTTS asset configuration: ${file}`)
  }
  return value
}

function requireCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error(`${command} is required to build the IndexTTS runtime`)
  }
}

function run(command, args, options = {}) {
  console.log(`[index-tts] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options })
}

function output(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

function ensurePinnedSource() {
  if (!existsSync(path.join(sourceDir, '.git'))) {
    mkdirSync(path.dirname(sourceDir), { recursive: true })
    run('git', ['clone', '--filter=blob:none', repository, sourceDir])
  }
  run('git', ['-C', sourceDir, 'fetch', '--depth', '1', 'origin', commit])
  run('git', ['-C', sourceDir, 'checkout', '--detach', '--force', commit])
  if (output('git', ['-C', sourceDir, 'rev-parse', 'HEAD']) !== commit) {
    throw new Error('audio.cpp checkout does not match the pinned commit')
  }
  // external/ggml is vendored in the tree, so its identity is a tree hash rather
  // than a submodule commit. `git submodule update` is deliberately NOT run: the
  // only real submodule (external/audio.cpp-server-frontends) registers an SSH
  // URL that hosted runners cannot clone, and this build never references it.
  if (output('git', ['-C', sourceDir, 'rev-parse', 'HEAD:external/ggml']) !== ggmlTree) {
    throw new Error('audio.cpp vendored GGML tree does not match the pinned tree')
  }
  applyPatch()
}

function applyPatch() {
  const patch = readFileSync(patchPath, 'utf8')
  try {
    execFileSync('git', ['-C', sourceDir, 'apply', '--check', '-'], {
      input: patch,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    execFileSync('git', ['-C', sourceDir, 'apply', '-'], {
      input: patch,
      stdio: ['pipe', 'inherit', 'inherit']
    })
    console.log('[index-tts] applied content-addressed-gguf.patch')
  } catch {
    // Either the patch is already applied or the tree carries unrelated local
    // changes. The reverse check below tells the two apart so a dirty checkout
    // fails loudly instead of silently building the wrong code.
    execFileSync('git', ['-C', sourceDir, 'apply', '--reverse', '--check', '-'], {
      input: patch,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    console.log('[index-tts] content-addressed-gguf.patch is already applied')
  }
}

function configureAndBuild() {
  rmSync(helperBuildDir, { recursive: true, force: true })
  run('cmake', [
    ...(cmakeGenerator ? ['-G', cmakeGenerator] : []),
    '-S',
    path.join(root, 'native', 'index-tts'),
    '-B',
    helperBuildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    ...(compilerLauncher
      ? [
          `-DCMAKE_C_COMPILER_LAUNCHER=${compilerLauncher}`,
          `-DCMAKE_CXX_COMPILER_LAUNCHER=${compilerLauncher}`,
          ...(backend === 'cuda' ? [`-DCMAKE_CUDA_COMPILER_LAUNCHER=${compilerLauncher}`] : [])
        ]
      : []),
    `-DENGINE_ENABLE_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    ...(backend === 'cuda' ? [`-DCMAKE_CUDA_ARCHITECTURES=${cudaArchitectures}`] : []),
    `-DAUDIOCPP_SOURCE_DIR=${sourceDir}`
  ])
  run('cmake', [
    '--build',
    helperBuildDir,
    '--config',
    'Release',
    '--target',
    'ls101-index-tts-helper',
    '--parallel',
    jobs
  ])
}

function helperExecutableName() {
  const extension = process.platform === 'win32' ? '.exe' : ''
  return `ls101-index-tts-helper-${backend}${extension}`
}

function copyResult() {
  const executable = `ls101-index-tts-helper${process.platform === 'win32' ? '.exe' : ''}`
  const candidates = [
    path.join(helperBuildDir, executable),
    path.join(helperBuildDir, 'bin', executable),
    path.join(helperBuildDir, 'Release', executable)
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  if (!source) throw new Error(`built helper was not found under ${helperBuildDir}`)
  mkdirSync(outputDir, { recursive: true })
  const target = path.join(outputDir, helperExecutableName())
  rmSync(target, { force: true })
  copyFileSync(source, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
  const size = statSync(target).size
  console.log(`[index-tts] runtime written: ${target} (${size} bytes)`)
  if (size < minimumHelperBytes) {
    throw new Error(`built helper is unexpectedly small: ${size} bytes`)
  }
}

function stageRuntimeMetadata() {
  const metadata = {
    schemaVersion: 1,
    backend,
    target: `${process.platform}-${process.arch}`,
    sourceCommit: commit,
    ggmlRevision: ggmlTree,
    repository,
    executable: helperExecutableName(),
    toolchain: {
      cmake: safeOutput('cmake', ['--version']).split('\n')[0] || undefined,
      compiler:
        safeOutput(process.platform === 'win32' ? 'cl' : 'c++', ['--version']).split('\n')[0] ||
        undefined
    }
  }
  const target = path.join(outputDir, `build-${backend}.json`)
  writeFileSync(target, `${JSON.stringify(metadata, null, 2)}\n`)
  console.log(`[index-tts] runtime metadata written: ${target}`)
}

function stageLicenses() {
  for (const name of ['LICENSE.IndexTTS.txt', 'DISCLAIMER.IndexTTS.txt', 'LICENSE.audio-cpp.txt']) {
    const source = path.join(root, 'native', 'index-tts', 'licenses', name)
    if (!existsSync(source)) throw new Error(`missing license file: ${source}`)
    copyFileSync(source, path.join(outputDir, name))
  }
}

function safeOutput(command, args) {
  try {
    return output(command, args)
  } catch {
    return ''
  }
}

const requiredCudaFamilies = ['cublas', 'cublaslt', 'cudart', 'cufft', 'nvjitlink']

function cudaFamily(name) {
  const normalized = path
    .basename(name)
    .toLowerCase()
    .replace(/^lib/, '')
    .replace(/\.so.*$/, '')
    .replace(/\.dll$/, '')
  return /^[a-z]+/.exec(normalized)?.[0] ?? ''
}

function assertCudaDependencyFamilies(dependencies) {
  const present = new Set(dependencies.map((name) => cudaFamily(name)))
  const missing = requiredCudaFamilies.filter((family) => !present.has(family))
  if (missing.length) {
    throw new Error(
      `CUDA dependency closure is missing families: ${missing.join(', ')}; refusing to publish`
    )
  }
}

// Mirrors the Qwen TTS Windows DLL staging but generalizes it to both platforms:
// the closure is discovered from the built binary rather than hardcoded so a
// CUDA toolkit update cannot silently drop a dependency.
function stageCudaRuntimeDependencies() {
  if (backend !== 'cuda') return
  const redistributable = process.env.INDEX_TTS_CUDA_REDIST_DIR?.trim()
  if (!redistributable || !existsSync(redistributable)) {
    throw new Error(
      'INDEX_TTS_CUDA_REDIST_DIR must point to the CUDA 12.8 runtime library directory ' +
        `for a cuda build (received: ${redistributable || 'unset'})`
    )
  }
  const helperPath = path.join(outputDir, helperExecutableName())
  const dependencies =
    process.platform === 'win32'
      ? windowsCudaDependencies(helperPath)
      : linuxCudaDependencies(helperPath, outputDir)
  if (!dependencies.length) {
    throw new Error('no CUDA runtime dependencies were discovered beside the helper')
  }
  assertCudaDependencyFamilies(dependencies)
  for (const dependency of dependencies) {
    const source = path.join(redistributable, dependency)
    const stats = statSync(source)
    if (!stats.isFile()) throw new Error(`CUDA runtime dependency is missing: ${source}`)
    if (stats.size < 1024 * 1024) {
      throw new Error(`CUDA runtime dependency is unexpectedly small: ${source}`)
    }
    copyFileSync(source, path.join(outputDir, dependency))
    console.log(`[index-tts] staged CUDA dependency: ${dependency} (${stats.size} bytes)`)
  }
  const license = 'LICENSE.NVIDIA-CUDA.html'
  const previous = path.join(outputDir, license)
  if (!existsSync(previous)) {
    run('curl', [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      cudaLicenseUrl,
      '--output',
      previous
    ])
  }
  if (statSync(previous).size < 1024) {
    throw new Error(`${license} is unexpectedly small`)
  }
  console.log(`[index-tts] staged ${license}`)
}

function windowsCudaDependencies(helperPath) {
  const dumpbin = findDumpbin()
  if (!dumpbin) {
    throw new Error('dumpbin is required to discover Windows CUDA dependencies')
  }
  const listing = output(dumpbin, ['/DEPENDENTS', helperPath])
  const wanted = /^(cublas|cublasLt|cudart|cufft|nvJitLink)([^\\/]*)\.dll$/i
  const dependencies = new Set()
  for (const line of listing.split(/\r?\n/)) {
    const match = /\s([A-Za-z0-9_.-]+\.dll)$/.exec(line.trim())
    if (match && wanted.test(match[1])) dependencies.add(match[1])
  }
  return [...dependencies].sort()
}

function findDumpbin() {
  const candidates = [
    process.env.INDEX_TTS_DUMPBIN?.trim(),
    path.join(process.env.CUDA_PATH ?? '', 'bin', 'dumpbin.exe')
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function linuxCudaDependencies(helperPath, stagingDirectory) {
  const dependencies = new Set()
  const queue = [helperPath]
  const visited = new Set()
  const environment = {
    ...process.env,
    LD_LIBRARY_PATH: [stagingDirectory, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
  }
  while (queue.length) {
    const current = queue.shift()
    if (visited.has(current)) continue
    visited.add(current)
    const listing = output('ldd', [current], { env: environment })
    for (const line of listing.split('\n')) {
      const resolved = /=>\s*(\/\S+\.so\S*)\s*\(/.exec(line)
      if (!resolved) continue
      const file = resolved[1]
      const name = path.basename(file)
      if (!visited.has(file)) queue.push(file)
      if (/^lib(cublas|cublasLt|cudart|cufft|nvJitLink)/i.test(name)) dependencies.add(name)
    }
  }
  return [...dependencies].sort()
}

function smokeTestHelper() {
  const helperPath = path.join(outputDir, helperExecutableName())
  const result = spawnSync(helperPath, [], { encoding: 'utf8' })
  if (result.status !== 1 || !result.stderr?.includes('An absolute --model path is required')) {
    const status =
      result.status === null ? 'null' : `${result.status} (0x${(result.status >>> 0).toString(16)})`
    throw new Error(
      `helper smoke test failed (status=${status}, signal=${result.signal ?? 'none'}): ` +
        `${result.stderr || result.stdout || result.error || 'no process output'}`
    )
  }
  console.log(`[index-tts] smoke-tested ${helperPath} (missing --model contract)`)
}

// The product path is a single static executable: on Linux a CPU build must not
// carry dynamic dependencies beyond the C/C++ runtime.
function assertStaticCpuBuild() {
  if (backend !== 'cpu' || process.platform !== 'linux') return
  const helperPath = path.join(outputDir, helperExecutableName())
  const allowed = /^(libc|libstdc\+\+|libm|libgcc_s|libdl|libpthread|ld-linux)/
  const offenders = output('ldd', [helperPath])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('=>') || line.includes('not found'))
    .filter((line) => {
      const library = /^\s*([^\s]+)\s*=>/.exec(line)?.[1] ?? line.split(' ')[0]
      return !allowed.test(path.basename(library))
    })
  if (offenders.length) {
    throw new Error(
      `CPU helper must not depend on dynamic libraries beyond the C/C++ runtime:\n${offenders.join('\n')}`
    )
  }
  console.log('[index-tts] CPU helper has no unexpected dynamic library dependencies')
}

function verifyStagedRuntime() {
  const expected = [
    helperExecutableName(),
    `build-${backend}.json`,
    'LICENSE.IndexTTS.txt',
    'DISCLAIMER.IndexTTS.txt',
    'LICENSE.audio-cpp.txt'
  ]
  for (const name of expected) {
    if (!existsSync(path.join(outputDir, name))) {
      throw new Error(`staged runtime is missing ${name}`)
    }
  }
  const metadata = JSON.parse(readFileSync(path.join(outputDir, `build-${backend}.json`), 'utf8'))
  if (metadata.sourceCommit !== commit || metadata.ggmlRevision !== ggmlTree) {
    throw new Error('staged runtime metadata does not match the pinned revisions')
  }
}

requireCommand('git')
requireCommand('cmake')
ensurePinnedSource()
configureAndBuild()
copyResult()
stageRuntimeMetadata()
stageLicenses()
stageCudaRuntimeDependencies()
smokeTestHelper()
assertStaticCpuBuild()
verifyStagedRuntime()
console.log(`[index-tts] ${backend} runtime ready under ${outputDir}`)
