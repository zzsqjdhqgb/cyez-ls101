/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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
const cudaArchitectures = '75;86-real;89-real;120a-real'
const cmakeGenerator = process.env.INDEX_TTS_CMAKE_GENERATOR?.trim()
const compilerLauncher = process.env.SCCACHE_PATH?.trim()
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))

function parseBackend(args) {
  if (args.length !== 2 || args[0] !== '--backend' || !['cpu', 'cuda'].includes(args[1])) {
    throw new Error('Usage: node scripts/index-tts/build-runtime.mjs --backend cpu|cuda')
  }
  return args[1]
}

function loadAssetConfig() {
  const file = path.join(import.meta.dirname, 'assets.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (
    value?.schemaVersion !== 2 ||
    typeof value.runtime?.repository !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.revision ?? '')
  ) {
    throw new Error(`Invalid Index TTS asset configuration: ${file}`)
  }
  return value
}

function requireCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error(`${command} is required to build the Index TTS runtime`)
  }
}

function run(command, args, options = {}) {
  console.log(`[index-tts] ${command} ${args.join(' ')}`)
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options })
}

function output(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function ensurePinnedSource() {
  if (!existsSync(path.join(sourceDir, '.git'))) {
    mkdirSync(path.dirname(sourceDir), { recursive: true })
    run('git', ['clone', '--filter=blob:none', repository, sourceDir])
  }
  run('git', ['-C', sourceDir, 'fetch', '--filter=blob:none', 'origin', commit])
  run('git', ['-C', sourceDir, 'checkout', '--detach', '--force', commit])
  if (output('git', ['-C', sourceDir, 'rev-parse', 'HEAD']) !== commit) {
    throw new Error('audio.cpp checkout does not match the pinned commit')
  }
  run('git', ['-C', sourceDir, 'submodule', 'update', '--init', '--recursive'])
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
          `-DCMAKE_CUDA_COMPILER_LAUNCHER=${compilerLauncher}`
        ]
      : []),
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_STATIC=ON',
    '-DGGML_NATIVE=OFF',
    '-DGGML_METAL=OFF',
    `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    ...(backend === 'cuda' ? [`-DCMAKE_CUDA_ARCHITECTURES=${cudaArchitectures}`] : []),
    '-DGGML_OPENMP=OFF',
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

function copyResult() {
  const executable =
    process.platform === 'win32' ? 'ls101-index-tts-helper.exe' : 'ls101-index-tts-helper'
  const candidates = [
    path.join(helperBuildDir, executable),
    path.join(helperBuildDir, 'Release', executable)
  ]
  const source = candidates.find(existsSync)
  if (!source) throw new Error(`built helper was not found under ${helperBuildDir}`)
  mkdirSync(outputDir, { recursive: true })
  const extension = process.platform === 'win32' ? '.exe' : ''
  const target = path.join(outputDir, `ls101-index-tts-helper-${backend}${extension}`)
  rmSync(path.join(outputDir, `ls101-index-tts-helper${extension}`), { force: true })
  copyFileSync(source, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
  console.log(`[index-tts] runtime written: ${target}`)
}

requireCommand('git')
requireCommand('cmake')
ensurePinnedSource()
configureAndBuild()
copyResult()
