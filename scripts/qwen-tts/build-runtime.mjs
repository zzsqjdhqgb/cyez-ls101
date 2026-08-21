/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..', '..')
const downloadDirectory = path.join(root, 'externals', 'ai', 'qwen3-tts', 'downloads')
const sourceDir = path.join(downloadDirectory, 'qwen3-tts.cpp')
const backend = parseBackend(process.argv.slice(2))
const helperBuildDir = path.join(downloadDirectory, `qwen3-tts-helper-build-${backend}`)
const outputDir = path.join(
  root,
  'externals',
  'ai',
  'qwen3-tts',
  'runtime',
  `${process.platform}-${process.arch}`
)
const assetConfig = loadAssetConfig()
const repository = assetConfig.runtime.repository
const commit = assetConfig.runtime.revision
const ggmlCommit = assetConfig.runtime.ggmlRevision
const patchPaths = [
  'portable-cpu.patch',
  'explicit-model-paths.patch',
  'strict-explicit-backend.patch'
].map((file) => path.join(root, 'native', 'qwen-tts', file))
const jobs = String(Math.max(1, Math.min(os.availableParallelism?.() ?? os.cpus().length, 16)))

function parseBackend(args) {
  if (args.length !== 2 || args[0] !== '--backend' || !['cpu', 'cuda'].includes(args[1])) {
    throw new Error('Usage: yarn qwen-tts:build-runtime --backend cpu|cuda')
  }
  return args[1]
}

function loadAssetConfig() {
  const file = path.join(import.meta.dirname, 'assets.json')
  const value = JSON.parse(readFileSync(file, 'utf8'))
  if (
    value?.schemaVersion !== 2 ||
    typeof value.runtime?.repository !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.revision ?? '') ||
    !/^[a-f0-9]{40}$/.test(value.runtime?.ggmlRevision ?? '')
  ) {
    throw new Error(`Invalid Qwen TTS asset configuration: ${file}`)
  }
  return value
}

function requireCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error(`${command} is required to build the Qwen TTS runtime`)
  }
}

function run(command, args, options = {}) {
  console.log(`[qwen-tts] ${command} ${args.join(' ')}`)
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
    run('git', ['clone', '--no-checkout', repository, sourceDir])
  }
  run('git', ['-C', sourceDir, 'fetch', '--depth', '1', 'origin', commit])
  run('git', ['-C', sourceDir, 'checkout', '--detach', '--force', commit])
  if (output('git', ['-C', sourceDir, 'rev-parse', 'HEAD']) !== commit) {
    throw new Error('qwen3-tts.cpp checkout does not match the pinned commit')
  }
  run('git', ['-C', sourceDir, 'submodule', 'update', '--init'])
  if (output('git', ['-C', path.join(sourceDir, 'ggml'), 'rev-parse', 'HEAD']) !== ggmlCommit) {
    throw new Error('qwen3-tts.cpp GGML checkout does not match the pinned commit')
  }

  for (const patchPath of patchPaths) applyPatch(patchPath)
}

function applyPatch(patchPath) {
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
  } catch {
    execFileSync('git', ['-C', sourceDir, 'apply', '--reverse', '--check', '-'], {
      input: patch,
      stdio: ['pipe', 'ignore', 'pipe']
    })
  }
}

function configureAndBuild() {
  rmSync(helperBuildDir, { recursive: true, force: true })
  run('cmake', [
    '-S',
    path.join(root, 'native', 'qwen-tts'),
    '-B',
    helperBuildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_STATIC=ON',
    '-DGGML_NATIVE=OFF',
    '-DGGML_METAL=OFF',
    `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    '-DGGML_CUDA_NCCL=OFF',
    '-DGGML_VULKAN=OFF',
    '-DGGML_OPENMP=OFF',
    `-DQWEN3_TTS_SOURCE_DIR=${sourceDir}`
  ])
  run('cmake', [
    '--build',
    helperBuildDir,
    '--config',
    'Release',
    '--target',
    'ls101-qwen-tts-helper',
    '--parallel',
    jobs
  ])
}

function copyResult() {
  const executable =
    process.platform === 'win32' ? 'ls101-qwen-tts-helper.exe' : 'ls101-qwen-tts-helper'
  const candidates = [
    path.join(helperBuildDir, executable),
    path.join(helperBuildDir, 'Release', executable)
  ]
  const source = candidates.find(existsSync)
  if (!source) throw new Error(`built helper was not found under ${helperBuildDir}`)
  mkdirSync(outputDir, { recursive: true })
  const extension = process.platform === 'win32' ? '.exe' : ''
  const target = path.join(outputDir, `ls101-qwen-tts-helper-${backend}${extension}`)
  rmSync(path.join(outputDir, `ls101-qwen-tts-helper${extension}`), { force: true })
  copyFileSync(source, target)
  if (process.platform !== 'win32') chmodSync(target, 0o755)
  console.log(`[qwen-tts] runtime written: ${target}`)
}

requireCommand('git')
requireCommand('cmake')
ensurePinnedSource()
configureAndBuild()
copyResult()
