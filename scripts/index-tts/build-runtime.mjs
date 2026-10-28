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
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..', '..')
const downloadDirectory = path.join(root, 'externals', 'ai', 'index-tts', 'downloads')
const sourceDir = path.join(downloadDirectory, 'audio.cpp')
// Argument validation only happens when this module runs as the CLI. When tests
// import the module, process.argv belongs to the test runner, so the derived
// paths below fall back to a harmless default instead.
const invokedAsCli = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
const { backend, nativeCpu } = invokedAsCli
  ? parseArguments(process.argv.slice(2))
  : { backend: 'cpu', nativeCpu: false }
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
// Patches applied to the pinned audio.cpp checkout, in order. Both are
// idempotent (a reverse check distinguishes "already applied" from a dirty
// tree) and must stay applicable on the pinned revision.
const patchPaths = [
  path.join(root, 'native', 'index-tts', 'content-addressed-gguf.patch'),
  // UTF-8 model paths: without it audiocpp_model_load builds the model path
  // with the ANSI code page on Windows and fails for non-ASCII user dirs.
  path.join(root, 'native', 'index-tts', 'utf8-model-path.patch')
]
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))
const minimumHelperBytes = 1_000_000
export const STAGED_RUNTIME_LICENSES = Object.freeze([
  'LICENSE.IndexTTS.txt',
  'DISCLAIMER.IndexTTS.txt',
  'LICENSE.audio-cpp.txt',
  'LICENSE.cJSON.txt',
  'LICENSE.sentencepiece.txt',
  'LICENSE.absl.txt',
  'LICENSE.darts-clone.txt',
  'LICENSE.protobuf-lite.txt',
  'LICENSE.libyaml.txt'
])

// --native-cpu is the explicit development-machine opt-in for host-specific ISA
// flags (-march=native); the default build stays on the portable baseline.
export function parseArguments(args) {
  const nativeCpu = args.includes('--native-cpu')
  const backendArguments = args.filter((argument) => argument !== '--native-cpu')
  if (
    backendArguments.length !== 2 ||
    backendArguments[0] !== '--backend' ||
    !['cpu', 'cuda'].includes(backendArguments[1])
  ) {
    throw new Error('Usage: yarn index-tts:build-runtime --backend cpu|cuda [--native-cpu]')
  }
  return { backend: backendArguments[1], nativeCpu }
}

function loadAssetConfig() {
  const file = path.join(import.meta.dirname, 'assets.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    typeof value.runtime?.repository !== 'string' ||
    !/^[a-zA-Z0-9_.-]+$/.test(value.runtimeRelease?.version ?? '') ||
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
  applyPatches()
}

function applyPatches() {
  for (const patchPath of patchPaths) applyPatch(patchPath)
}

function applyPatch(patchPath) {
  const patch = readFileSync(patchPath, 'utf8')
  const patchName = path.basename(patchPath)
  try {
    execFileSync('git', ['-C', sourceDir, 'apply', '--check', '-'], {
      input: patch,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    execFileSync('git', ['-C', sourceDir, 'apply', '-'], {
      input: patch,
      stdio: ['pipe', 'inherit', 'inherit']
    })
    console.log(`[index-tts] applied ${patchName}`)
  } catch {
    // Either the patch is already applied or the tree carries unrelated local
    // changes. The reverse check below tells the two apart so a dirty checkout
    // fails loudly instead of silently building the wrong code.
    execFileSync('git', ['-C', sourceDir, 'apply', '--reverse', '--check', '-'], {
      input: patch,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    console.log(`[index-tts] ${patchName} is already applied`)
  }
}

// The cmake configure contract of this script. ENGINE_ENABLE_NATIVE_CPU is the
// ISA portability switch: the upstream audio.cpp CMakeLists FORCEs GGML_NATIVE
// to its value (see native/index-tts/CMakeLists.txt), so OFF anchors the helper
// to the portable x86-64 baseline while --native-cpu (ON) opts into the build
// host ISA for development machines.
export function cmakeConfigureArguments(build) {
  const cuda = build.backend === 'cuda'
  return [
    ...(build.cmakeGenerator ? ['-G', build.cmakeGenerator] : []),
    '-S',
    build.projectDirectory,
    '-B',
    build.buildDirectory,
    '-DCMAKE_BUILD_TYPE=Release',
    ...(build.compilerLauncher
      ? [
          `-DCMAKE_C_COMPILER_LAUNCHER=${build.compilerLauncher}`,
          `-DCMAKE_CXX_COMPILER_LAUNCHER=${build.compilerLauncher}`,
          ...(cuda
            ? [
                // qwen parity: CUDA compilation goes through sccache too. This
                // requires sccache >= 0.18.0 (the workflow pins it): 0.17.0
                // cannot parse the escaped string defines the two engine .cu
                // files carry (-DYAML_VERSION_STRING=\"...\") and fails them
                // with "Could not parse shell line". qwen is unaffected on
                // 0.17.0 because its .cu set is pure ggml kernels.
                `-DCMAKE_CUDA_COMPILER_LAUNCHER=${build.compilerLauncher}`
              ]
            : [])
        ]
      : []),
    `-DENGINE_ENABLE_CUDA=${cuda ? 'ON' : 'OFF'}`,
    `-DGGML_CUDA=${cuda ? 'ON' : 'OFF'}`,
    ...(cuda
      ? [
          `-DCMAKE_CUDA_ARCHITECTURES=${build.cudaArchitectures}`,
          // Mirror qwen-tts: without NO_VMM ggml-cuda links CUDA::cuda_driver
          // (libcuda.so.1 / nvcuda.dll), which GPU-less CI runners cannot
          // resolve, so the no-argument smoke test would fail at load time.
          '-DGGML_CUDA_NO_VMM=ON',
          '-DGGML_CUDA_NCCL=OFF'
        ]
      : []),
    `-DENGINE_ENABLE_NATIVE_CPU=${build.nativeCpu ? 'ON' : 'OFF'}`,
    `-DAUDIOCPP_SOURCE_DIR=${build.sourceDirectory}`
  ]
}

function configureAndBuild() {
  rmSync(helperBuildDir, { recursive: true, force: true })
  run(
    'cmake',
    cmakeConfigureArguments({
      backend,
      nativeCpu,
      cmakeGenerator,
      compilerLauncher,
      cudaArchitectures,
      projectDirectory: path.join(root, 'native', 'index-tts'),
      buildDirectory: helperBuildDir,
      sourceDirectory: sourceDir
    })
  )
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
    runtimeVersion: assetConfig.runtimeRelease.version,
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
  for (const name of STAGED_RUNTIME_LICENSES) {
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
// Discovery, never a hardcoded list: the linker dead-strips unreferenced
// objects, so the closure reflects what the linked model composite actually
// uses, and the post-stage ldd check plus the smoke test guarantee the
// staged runtime loads.
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

// Windows: ggml-cuda links cuBLAS dynamically (MSVC toolkits ship no static
// cuBLAS), and cublas64_12.dll imports cublasLt64_12.dll, so both families
// are always discovered. Linux: GGML_STATIC=ON static-links
// cuBLAS/cuBLASLt/cuDART, and the index_tts2 composite uses the Vocos
// vocoder with the HOST iSTFT — the cuFFT runtime belongs to model families
// (fsq/miocodec/neutts) this build does not link, so istft_cuda_runtime.o
// dead-strips and NOTHING CUDA is dynamic. An empty closure is the correct,
// verified state on Linux; the post-stage ldd check and the no-argument
// smoke test still guarantee the helper loads and runs. (Deviation from the
// spec's five-family rule, with evidence, recorded in the delivery notes.)
const requiredCudaFamilies = process.platform === 'win32' ? ['cublas', 'cublaslt'] : []

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
  if (!dependencies.length && process.platform === 'win32') {
    throw new Error('no CUDA runtime dependencies were discovered beside the helper')
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
  // Linux cuda builds resolve against the staged directory (an empty closure
  // is valid — the CUDA libraries are statically linked — and the check below
  // then simply confirms the fully static helper resolves on its own).
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

// The distributed CPU helper must run on any x86-64 host. Check the actual
// disassembled mnemonics rather than registers or arbitrary text: AVX also has
// XMM encodings, and several post-SSE2 ISA families use only GPRs/XMM registers.
// The baseline is asserted after every default Linux CPU build; --native-cpu is
// the explicit development-machine opt-out.
export function requiresPortableIsaBaseline({ backend, platform, nativeCpu }) {
  return backend === 'cpu' && platform === 'linux' && !nativeCpu
}

// GNU objdump's AT&T and Intel output both start instructions with an address,
// a colon, and their encoded bytes. Restricting detection to that field avoids
// matching symbol names, source annotations, comments, or arbitrary input text.
const disassembledInstruction = /^\s*[0-9a-f]+:\t[^\t]*\t\s*([a-z][a-z0-9.]*)\b/i
const instructionPrefixes = new Set([
  'addr32',
  'bnd',
  // Segment overrides precede the mnemonic in GNU objdump output (for example,
  // `cs vaddps ...`). They do not make the following instruction baseline.
  'cs',
  'ds',
  'es',
  'fs',
  'gs',
  'ss',
  'data16',
  'lock',
  'notrack',
  'rep',
  'repne',
  'repnz',
  'repe',
  'repz'
])

const legacyPostSse2Instructions = new Set([
  // SSE3 / SSSE3
  'addsubpd',
  'addsubps',
  'fisttp',
  'haddpd',
  'haddps',
  'hsubpd',
  'hsubps',
  'lddqu',
  'movddup',
  'movshdup',
  'movsldup',
  'monitor',
  'mwait',
  'pabsb',
  'pabsd',
  'pabsw',
  'palignr',
  'phaddd',
  'phaddsw',
  'phaddw',
  'phsubd',
  'phsubsw',
  'phsubw',
  'pmaddubsw',
  'pmulhrsw',
  'pshufb',
  'psignb',
  'psignd',
  'psignw',
  // SSE4.1 / SSE4.2 (pextrw and pinsrw themselves are SSE2 and are omitted).
  'blendpd',
  'blendps',
  'blendvpd',
  'blendvps',
  'crc32',
  'dppd',
  'dpps',
  'extractps',
  'insertps',
  'movntdqa',
  'mpsadbw',
  'packusdw',
  'pblendvb',
  'pblendw',
  'pcmpeqq',
  'pcmpestri',
  'pcmpestrm',
  'pcmpgtq',
  'pcmpistri',
  'pcmpistrm',
  'pextrb',
  'pextrd',
  'pextrq',
  'phminposuw',
  'pinsrb',
  'pinsrd',
  'pinsrq',
  'pmaxsb',
  'pmaxsd',
  'pmaxud',
  'pmaxuw',
  'pminsb',
  'pminsd',
  'pminud',
  'pminuw',
  'pmovsxbd',
  'pmovsxbq',
  'pmovsxbw',
  'pmovsxdq',
  'pmovsxwd',
  'pmovsxwq',
  'pmovzxbd',
  'pmovzxbq',
  'pmovzxbw',
  'pmovzxdq',
  'pmovzxwd',
  'pmovzxwq',
  'pmuldq',
  'pmulld',
  'ptest',
  'roundpd',
  'roundps',
  'roundsd',
  'roundss',
  // GFNI (the legacy, non-VEX encodings).
  'gf2p8affineinvqb',
  'gf2p8affineqb',
  'gf2p8mulb',
  // POPCNT/LZCNT, BMI1/BMI2, MOVBE, AES/PCLMUL, SHA, ADX and RNG.
  // TZCNT is deliberately absent: its REP BSF encoding executes as BSF on
  // pre-BMI CPUs, and the compiler only relies on that compatible behavior
  // here (std::gcd inputs are nonzero), so rejecting it would be a false positive.
  'andn',
  'bextr',
  'blsi',
  'blsmsk',
  'blsr',
  'bzhi',
  'lzcnt',
  'movbe',
  'mulx',
  'pdep',
  'pext',
  'popcnt',
  'rorx',
  'sarx',
  'shlx',
  'shrx',
  'adcx',
  'adox',
  'rdrand',
  'rdseed',
  'aesdec',
  'aesdeclast',
  'aesenc',
  'aesenclast',
  'aesimc',
  'aeskeygenassist',
  'pclmulqdq',
  'sha1msg1',
  'sha1msg2',
  'sha1nexte',
  'sha1rnds4',
  'sha256msg1',
  'sha256msg2',
  'sha256rnds2',
  // Other non-VEX ISA extensions: cache control, timestamping, MOVDIR/ENQCMD,
  // WAITPKG, Key Locker and AMX. None belongs to the x86-64 SSE2 baseline.
  'cldemote',
  'clflushopt',
  'clwb',
  'pcommit',
  'prefetchwt1',
  'rdtscp',
  'movdiri',
  'movdir64b',
  'enqcmd',
  'enqcmds',
  'serialize',
  'tpause',
  'umonitor',
  'umwait',
  'encodekey128',
  'encodekey256',
  'loadiwkey',
  'ldtilecfg',
  'sttilecfg',
  'tilerelease',
  'tileloadd',
  'tileloaddt1',
  'tilestored',
  'tilezero',
  'tcmmimfp16ps',
  'tcmmrlfp16ps',
  'tdpbf16ps',
  'tdpfp16ps',
  'tdpbssd',
  'tdpbsud',
  'tdpbusd',
  'tdpbuud',
  // AMD SSE4a and other commonly encountered post-baseline system instructions.
  'extrq',
  'insertq',
  'movntsd',
  'movntss',
  'cmpxchg16b',
  'clzero',
  'monitorx',
  'mwaitx',
  'rdpru',
  'invpcid',
  'invlpgb',
  'pconfig',
  'ptwrite',
  'tlbsync',
  'wbnoinvd',
  'rdpid',
  'rdpkru',
  'wrpkru',
  'rdfsbase',
  'rdgsbase',
  'wrfsbase',
  'wrgsbase',
  'xgetbv',
  'xsetbv',
  'xrstor',
  'xrstor64',
  'xrstors',
  'xrstors64',
  'xsave',
  'xsave64',
  'xsavec',
  'xsavec64',
  'xsaveopt',
  'xsaveopt64',
  'xsaves',
  'xsaves64'
])

// AVX-512 opmask instructions do not use a v-prefixed mnemonic.
const avxOpmaskInstructions = new Set([
  'kaddb',
  'kaddd',
  'kaddq',
  'kaddw',
  'kandb',
  'kandd',
  'kandnb',
  'kandnd',
  'kandnq',
  'kandnw',
  'kandq',
  'kandw',
  'kmovb',
  'kmovd',
  'kmovq',
  'kmovw',
  'knotb',
  'knotd',
  'knotq',
  'knotw',
  'korb',
  'kord',
  'korq',
  'kortestb',
  'kortestd',
  'kortestq',
  'kortestw',
  'korw',
  'kshiftlb',
  'kshiftld',
  'kshiftlq',
  'kshiftlw',
  'kshiftrb',
  'kshiftrd',
  'kshiftrq',
  'kshiftrw',
  'ktestb',
  'ktestd',
  'ktestq',
  'ktestw',
  'kunpckbw',
  'kunpckdq',
  'kunpckwd',
  'kxnorb',
  'kxnord',
  'kxnorq',
  'kxnorw',
  'kxorb',
  'kxord',
  'kxorq',
  'kxorw'
])

function isPostSse2Instruction(mnemonic) {
  const normalized = mnemonic.toLowerCase()
  // verr/verw are the only legacy x86 mnemonics beginning with "v"; all other
  // v-prefixed instructions here require VEX, EVEX, XOP, or AVX10 encodings.
  return (
    (/^v[a-z0-9]/.test(normalized) && normalized !== 'verr' && normalized !== 'verw') ||
    legacyPostSse2Instructions.has(normalized) ||
    avxOpmaskInstructions.has(normalized)
  )
}

// Returns one entry per offending instruction, retaining line numbers and the
// original text for actionable build errors. This pure parser is also used by
// tests with both AT&T and Intel-style objdump snippets.
export function findPortableIsaViolations(disassembly) {
  const violations = []
  const lines = disassembly.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]
    const instruction = disassembledInstruction.exec(text)
    let mnemonic = instruction?.[1]?.toLowerCase()
    let mnemonicEnd = instruction ? instruction.index + instruction[0].length : 0
    while (mnemonic && instructionPrefixes.has(mnemonic)) {
      const remainder = text.slice(mnemonicEnd)
      const next = /^\s+([a-z][a-z0-9.]*)\b/i.exec(remainder)
      mnemonic = next?.[1]?.toLowerCase()
      mnemonicEnd += next?.[0].length ?? 0
    }
    if (mnemonic && isPostSse2Instruction(mnemonic)) {
      violations.push({ line: index + 1, mnemonic, text: text.trim() })
    }
  }
  return violations
}

function disassembleHelper(helperPath) {
  // The full disassembly of the ~8 MB helper is ~80 MB of text: far beyond the
  // default 1 MB execFileSync buffer, but comfortably within Node's string
  // limit, so the counting happens in memory instead of piping through a shell.
  return output('objdump', ['-d', helperPath], { maxBuffer: 256 * 1024 * 1024 })
}

function assertPortableCpuIsaBaseline() {
  if (!requiresPortableIsaBaseline({ backend, platform: process.platform, nativeCpu })) {
    if (nativeCpu) {
      console.log('[index-tts] --native-cpu: skipping the portable ISA baseline check')
    }
    return
  }
  requireCommand('objdump')
  const helperPath = path.join(outputDir, helperExecutableName())
  const disassembly = disassembleHelper(helperPath)
  const violations = findPortableIsaViolations(disassembly)
  if (violations.length > 0) {
    const examples = violations
      .slice(0, 20)
      .map(({ line, mnemonic }) => `line ${line}: ${mnemonic}`)
      .join(', ')
    throw new Error(
      `CPU helper is not ISA-portable: ${violations.length} post-SSE2 instructions in ` +
        `${helperPath} (${examples}${violations.length > 20 ? ', ...' : ''}). The default ` +
        'build must stay on the x86-64 baseline (see ENGINE_ENABLE_NATIVE_CPU / GGML_NATIVE ' +
        '/ GGML_AVX* in native/index-tts/CMakeLists.txt); pass --native-cpu to opt out ' +
        'deliberately.'
    )
  }
  console.log(
    `[index-tts] portable ISA baseline verified: 0 post-SSE2 instructions in ${helperPath}`
  )
}

function verifyStagedRuntime() {
  const expected = [helperExecutableName(), `build-${backend}.json`, ...STAGED_RUNTIME_LICENSES]
  for (const name of expected) {
    if (!existsSync(path.join(outputDir, name))) {
      throw new Error(`staged runtime is missing ${name}`)
    }
  }
  const metadata = JSON.parse(readFileSync(path.join(outputDir, `build-${backend}.json`), 'utf8'))
  if (metadata.runtimeVersion !== assetConfig.runtimeRelease.version) {
    throw new Error('staged runtime metadata does not match the application runtime version')
  }
  if (metadata.sourceCommit !== commit || metadata.ggmlRevision !== ggmlTree) {
    throw new Error('staged runtime metadata does not match the pinned revisions')
  }
}

function main() {
  requireCommand('git')
  requireCommand('cmake')
  if (nativeCpu) {
    console.log(
      '[index-tts] --native-cpu: building with host-specific CPU ISA flags (not portable)'
    )
  }
  const cudaRedistributable = resolveCudaRedistributable()
  ensurePinnedSource()
  configureAndBuild()
  copyResult()
  stageRuntimeMetadata()
  stageLicenses()
  stageCudaRuntimeDependencies(cudaRedistributable)
  smokeTestHelper()
  assertStaticCpuBuild()
  assertPortableCpuIsaBaseline()
  verifyStagedRuntime()
  console.log(`[index-tts] ${backend} runtime ready under ${outputDir}`)
}

// Errors intentionally stay uncaught, exactly like the previous top-level flow:
// a failed step aborts the build with a non-zero exit status.
if (invokedAsCli) {
  main()
}
