/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// Builds the native IndexTTS 2.5 helper against a local audio.cpp checkout and
// stages it under externals/ai/index-tts/runtime/<platform>-<arch>/.
//
//   yarn index-tts:build-runtime --backend cpu|cuda
//
// The source checkout is expected at externals/ai/index-tts/downloads/audio.cpp
// (override with LS101_INDEX_TTS_SOURCE_DIR). Set LS101_INDEX_TTS_STUB_ENGINE=1
// to build the synthetic tone engine instead, which needs no audio.cpp, CUDA or
// model file and is what the Electron contract test runs against.
const root = path.resolve(import.meta.dirname, '..', '..')
const indexTtsDirectory = path.join(root, 'externals', 'ai', 'index-tts')
const sourceDir =
  process.env.LS101_INDEX_TTS_SOURCE_DIR?.trim() ||
  path.join(indexTtsDirectory, 'downloads', 'audio.cpp')
const cudaArchitectures = '75;86-real;89-real;120a-real'
const cmakeGenerator = process.env.LS101_INDEX_TTS_CMAKE_GENERATOR?.trim()
const compilerLauncher = process.env.SCCACHE_PATH?.trim()
const stubEngine = ['1', 'true'].includes(process.env.LS101_INDEX_TTS_STUB_ENGINE?.trim() ?? '')
const helperName =
  process.platform === 'win32' ? 'ls101-index-tts-helper.exe' : 'ls101-index-tts-helper'
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))

function parseBackend(args) {
  if (args.length !== 2 || args[0] !== '--backend' || !['cpu', 'cuda'].includes(args[1])) {
    throw new Error('用法：yarn index-tts:build-runtime --backend cpu|cuda')
  }
  return args[1]
}

function requireCommand(command, message) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error(message)
  }
}

function requireCompiler() {
  if (process.platform === 'win32') return // CMake locates the MSVC toolchain itself.
  for (const candidate of ['c++', 'g++', 'clang++']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return
    } catch {
      // Try the next compiler.
    }
  }
  throw new Error(
    '缺少 C++ 编译器（c++/g++/clang++），无法构建 IndexTTS 原生运行时；请安装构建工具链后重试'
  )
}

function run(command, args, options = {}) {
  console.log(`[index-tts] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options })
}

function requireSource() {
  const header = path.join(sourceDir, 'include', 'audiocpp.h')
  if (!existsSync(header)) {
    throw new Error(
      `缺少 audio.cpp 源码：${sourceDir}；请克隆 https://github.com/0xShug0/audio.cpp 到该目录，` +
        '或用 LS101_INDEX_TTS_SOURCE_DIR 指定路径'
    )
  }
}

function configureAndBuild(backend, buildDir) {
  rmSync(buildDir, { recursive: true, force: true })
  const configureArgs = [
    ...(cmakeGenerator ? ['-G', cmakeGenerator] : []),
    '-S',
    path.join(root, 'native', 'index-tts'),
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    ...(compilerLauncher
      ? [
          `-DCMAKE_C_COMPILER_LAUNCHER=${compilerLauncher}`,
          `-DCMAKE_CXX_COMPILER_LAUNCHER=${compilerLauncher}`,
          `-DCMAKE_CUDA_COMPILER_LAUNCHER=${compilerLauncher}`
        ]
      : []),
    ...(stubEngine
      ? ['-DLS101_INDEX_TTS_STUB_ENGINE=ON']
      : [
          `-DAUDIOCPP_SOURCE_DIR=${sourceDir}`,
          '-DAUDIOCPP_BUILD_C_API=ON',
          '-DAUDIOCPP_MODEL_SET=custom',
          '-DAUDIOCPP_MODELS=index_tts2',
          // Portable CPU kernels: this binary ships to other machines.
          '-DENGINE_ENABLE_NATIVE_CPU=OFF',
          `-DENGINE_ENABLE_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
          ...(backend === 'cuda' ? [`-DCMAKE_CUDA_ARCHITECTURES=${cudaArchitectures}`] : [])
        ])
  ]
  run('cmake', configureArgs)
  run('cmake', [
    '--build',
    buildDir,
    '--config',
    'Release',
    '--target',
    'ls101-index-tts-helper',
    '--parallel',
    jobs
  ])
}

function findBuiltHelper(buildDir) {
  const candidates = [
    path.join(buildDir, helperName),
    path.join(buildDir, 'Release', helperName),
    path.join(buildDir, 'bin', helperName),
    path.join(buildDir, 'bin', 'Release', helperName)
  ]
  const source = candidates.find(existsSync)
  if (!source) throw new Error(`未找到构建产物：${helperName}（构建目录 ${buildDir}）`)
  return source
}

// libaudiocpp is a shared library, so the helper needs it next to itself at
// runtime. CUDA runtime libraries (cudart/cublas) come from the toolkit and are
// declared as separate runtime-library assets by the model package.
function copySharedLibraries(buildDir, outputDir) {
  const searchDirectories = [
    buildDir,
    path.join(buildDir, 'bin'),
    path.join(buildDir, 'Release'),
    path.join(buildDir, 'bin', 'Release')
  ]
  const pattern = /^(lib)?audiocpp(\.\d+)*\.(so|dylib|dll)(\.\d+)*$/
  const copied = []
  for (const directory of searchDirectories) {
    if (!existsSync(directory)) continue
    for (const entry of readdirSync(directory)) {
      if (!pattern.test(entry)) continue
      const source = path.join(directory, entry)
      if (!statSync(source).isFile()) continue
      copyFileSync(source, path.join(outputDir, entry))
      copied.push(entry)
    }
  }
  if (copied.length) console.log(`[index-tts] runtime libraries copied: ${copied.join(', ')}`)
}

function copyResult(backend, buildDir, outputDir) {
  const source = findBuiltHelper(buildDir)
  mkdirSync(outputDir, { recursive: true })
  const extension = process.platform === 'win32' ? '.exe' : ''
  const target = path.join(outputDir, `ls101-index-tts-helper-${backend}${extension}`)
  rmSync(path.join(outputDir, `ls101-index-tts-helper${extension}`), { force: true })
  copyFileSync(source, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
  if (!stubEngine) copySharedLibraries(buildDir, outputDir)
  console.log(`[index-tts] runtime written: ${target}`)
}

function main() {
  const backend = parseBackend(process.argv.slice(2))
  const buildDir = path.join(indexTtsDirectory, `build-${backend}`)
  const outputDir = path.join(indexTtsDirectory, 'runtime', `${process.platform}-${process.arch}`)

  requireCommand(
    'cmake',
    '缺少 CMake，无法构建 IndexTTS 原生运行时；请安装 CMake 3.20 或更高版本后重试'
  )
  requireCompiler()
  if (backend === 'cuda') {
    requireCommand(
      'nvcc',
      '缺少 CUDA 工具链（nvcc），无法构建 CUDA 版 IndexTTS 原生运行时；请安装 CUDA 12.8 或更高版本后重试'
    )
  }
  if (!stubEngine) requireSource()
  configureAndBuild(backend, buildDir)
  copyResult(backend, buildDir, outputDir)
}

try {
  main()
} catch (error) {
  console.error(`[index-tts] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
