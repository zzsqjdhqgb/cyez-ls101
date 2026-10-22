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
// The sccache action exports SCCACHE_PATH without the Windows .exe suffix;
// append it when that is the file that actually exists.
const rawCompilerLauncher = process.env.SCCACHE_PATH?.trim()
const compilerLauncher =
  rawCompilerLauncher && process.platform === 'win32' && !existsSync(rawCompilerLauncher)
    ? `${rawCompilerLauncher}.exe`
    : rawCompilerLauncher
const patchPath = path.join(root, 'native', 'index-tts', 'content-addressed-gguf.patch')
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))
const minimumHelperBytes = 1_000_000

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
          ...(backend === 'cuda'
            ? [
                // qwen parity: CUDA compilation goes through sccache too. This
                // requires sccache >= 0.18.0 (the workflow pins it): 0.17.0
                // cannot parse the escaped string defines the two engine .cu
                // files carry (-DYAML_VERSION_STRING=\"...\") and fails them
                // with "Could not parse shell line". qwen is unaffected on
                // 0.17.0 because its .cu set is pure ggml kernels.
                `-DCMAKE_CUDA_COMPILER_LAUNCHER=${compilerLauncher}`
              ]
            : [])
        ]
      : []),
    `-DENGINE_ENABLE_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    ...(backend === 'cuda'
      ? [
          `-DCMAKE_CUDA_ARCHITECTURES=${cudaArchitectures}`,
          // Mirror qwen-tts: without NO_VMM ggml-cuda links CUDA::cuda_driver
          // (libcuda.so.1 / nvcuda.dll), which GPU-less CI runners cannot
          // resolve, so the no-argument smoke test would fail at load time.
          '-DGGML_CUDA_NO_VMM=ON',
          '-DGGML_CUDA_NCCL=OFF'
        ]
      : []),
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

// CUDA runtime staging (spec §5.1): the closure is DISCOVERED from the built
// helper — ldd on Linux, dumpbin /DEPENDENTS on Windows — and copied beside
// the helper from the toolkit directory named by INDEX_TTS_CUDA_REDIST_DIR.
// Discovery, never a hardcoded list: the set differs per platform (Linux
// static-links cuBLAS/cuBLASLt under GGML_STATIC=ON, so only the engine's
// cuDART/cuFFT are dynamic), and the family assertion refuses to publish an
// incomplete closure.
const cudaLicenseUrl = 'https://docs.nvidia.com/cuda/eula/index.html'

function cudaDependencyPattern() {
  return process.platform === 'win32'
    ? /^(cublas|cublasLt|cudart|cufft|nvJitLink)[._0-9][^/\\]*\.dll$/i
    : /^lib(cublasLt|cublas|cudart|cufft|nvJitLink)(?:[._0-9][^/]*)?\.so/i
}

function cudaFamilyOf(name) {
  const normalized = path
    .basename(name)
    .toLowerCase()
    .replace(/^lib/, '')
    .replace(/\.so.*$/, '')
    .replace(/\.dll$/, '')
  return /^[a-z]+/.exec(normalized)?.[0] ?? ''
}

// Windows: every family is dynamic (the toolkit ships no static cuBLAS).
// Linux: GGML_STATIC=ON links cuBLAS/cuBLASLt into the helper statically, so
// only the engine's cuDART/cuFFT can appear in ldd output. Deviation from the
// five-family rule, with evidence, recorded in the delivery notes.
const requiredCudaFamilies =
  process.platform === 'win32'
    ? ['cublas', 'cublaslt', 'cudart', 'cufft', 'nvjitlink']
    : ['cudart', 'cufft']

// cuDART is a thin loader (< 1 MiB in CUDA 12.8), so it keeps the 100 KB
// floor the smoke test uses for the helper; the other families carry kernels
// and stay at qwen's 1 MiB floor.
const cudaMinimumBytes = {
  cublas: 1024 * 1024,
  cublaslt: 1024 * 1024,
  cudart: 100 * 1024,
  cufft: 1024 * 1024,
  nvjitlink: 1024 * 1024
}

function cudaLoaderEnvironment(...directories) {
  const existing = process.env.LD_LIBRARY_PATH
  return {
    ...process.env,
    LD_LIBRARY_PATH: [...directories, existing].filter(Boolean).join(path.delimiter)
  }
}

function resolveCudaRedistributable() {
  if (backend !== 'cuda') return null
  const directory = process.env.INDEX_TTS_CUDA_REDIST_DIR?.trim()
  if (!directory || !existsSync(directory)) {
    throw new Error(
      'INDEX_TTS_CUDA_REDIST_DIR must point to the CUDA 12.8 runtime library ' +
        `directory for a cuda build (received: ${directory || 'unset'})`
    )
  }
  console.log(`[index-tts] CUDA runtime library directory: ${directory}`)
  return directory
}

function assertCudaDependencyFamilies(dependencies) {
  const present = new Set(dependencies.map((name) => cudaFamilyOf(name)))
  const missing = requiredCudaFamilies.filter((family) => !present.has(family))
  if (missing.length) {
    throw new Error(
      `CUDA dependency closure is missing families: ${missing.join(', ')}; refusing to publish`
    )
  }
}

function lddOutput(file, environment) {
  const result = spawnSync('ldd', [file], { encoding: 'utf8', env: environment })
  const text = `${result.stdout || ''}\n${result.stderr || ''}`
  const unresolved = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('not found'))
  if (unresolved.length) {
    throw new Error(
      `${file} has dependencies the toolkit directory does not resolve:\n${unresolved.join('\n')}`
    )
  }
  if (result.status !== 0) {
    throw new Error(`ldd failed for ${file} (status ${result.status}):\n${text.trim()}`)
  }
  return result.stdout || ''
}

function dumpbinDependents(file) {
  const result = spawnSync('dumpbin', ['/DEPENDENTS', file], { encoding: 'utf8' })
  if (result.error) {
    throw new Error(
      'dumpbin is required to discover the Windows CUDA dependency closure; ' +
        'run the build from a Visual Studio developer prompt'
    )
  }
  if (result.status !== 0) {
    throw new Error(`dumpbin /DEPENDENTS failed for ${file}:\n${result.stderr || result.stdout}`)
  }
  return [...`${result.stdout}`.matchAll(/^\s+([^\s]+\.dll)\s*$/gim)].map((match) => match[1])
}

function discoverCudaDependencies(redistributable) {
  const pattern = cudaDependencyPattern()
  const helper = path.join(outputDir, helperExecutableName())
  const closure = new Set()
  if (process.platform === 'win32') {
    // dumpbin lists DIRECT imports only; cuBLASLt and nvJitLink enter through
    // cublas64_12.dll, so the closure must be walked transitively.
    const pending = [helper]
    while (pending.length) {
      for (const name of dumpbinDependents(pending.pop())) {
        if (closure.has(name) || !pattern.test(name)) continue
        const source = path.join(redistributable, name)
        if (!existsSync(source)) {
          throw new Error(`CUDA runtime dependency is missing from ${redistributable}: ${name}`)
        }
        closure.add(name)
        pending.push(source)
      }
    }
  } else {
    for (const line of lddOutput(helper, cudaLoaderEnvironment(redistributable)).split('\n')) {
      const name = /^\s*(\S+) =>/.exec(line)?.[1]
      if (name && pattern.test(name)) closure.add(name)
    }
  }
  return [...closure].sort()
}

function stageCudaRuntimeDependencies(redistributable) {
  if (backend !== 'cuda') return
  const dependencies = discoverCudaDependencies(redistributable)
  assertCudaDependencyFamilies(dependencies)
  console.log(`[index-tts] staging CUDA dependencies: ${dependencies.join(', ')}`)
  for (const dependency of dependencies) {
    const source = path.join(redistributable, dependency)
    const stats = statSync(source)
    const family = cudaFamilyOf(dependency)
    const minimumBytes = cudaMinimumBytes[family] ?? 1024 * 1024
    if (stats.size < minimumBytes) {
      throw new Error(
        `CUDA runtime dependency is unexpectedly small: ${source} ` +
          `(${stats.size} bytes, below the ${minimumBytes}-byte ${family} floor)`
      )
    }
    copyFileSync(source, path.join(outputDir, dependency))
    console.log(`[index-tts] staged CUDA dependency: ${dependency} (${stats.size} bytes)`)
  }
  if (process.platform !== 'win32') {
    // Spec §5.1: with LD_LIBRARY_PATH pointing at the staged directory, ldd
    // must not report any "not found" — the staged closure is loadable.
    const helper = path.join(outputDir, helperExecutableName())
    lddOutput(helper, cudaLoaderEnvironment(outputDir))
    console.log('[index-tts] staged CUDA runtime resolves with no missing libraries')
  }
  const license = 'LICENSE.NVIDIA-CUDA.html'
  const target = path.join(outputDir, license)
  if (!existsSync(target)) {
    run('curl', [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      cudaLicenseUrl,
      '--output',
      target
    ])
  }
  if (statSync(target).size < 1024) {
    throw new Error(`${license} is unexpectedly small`)
  }
  console.log(`[index-tts] staged ${license}`)
}

function smokeTestHelper() {
  const helperPath = path.join(outputDir, helperExecutableName())
  // Linux cuda builds run against the staged shared libraries (the loader has
  // no $ORIGIN search), so the smoke test exercises exactly what ships.
  const environment =
    backend === 'cuda' && process.platform !== 'win32'
      ? cudaLoaderEnvironment(outputDir)
      : undefined
  const result = spawnSync(helperPath, [], { encoding: 'utf8', env: environment })
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
const cudaRedistributable = resolveCudaRedistributable()
ensurePinnedSource()
configureAndBuild()
copyResult()
stageRuntimeMetadata()
stageLicenses()
stageCudaRuntimeDependencies(cudaRedistributable)
smokeTestHelper()
assertStaticCpuBuild()
verifyStagedRuntime()
console.log(`[index-tts] ${backend} runtime ready under ${outputDir}`)
