/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { externalRoot, loadConfig, root, runtimeTarget } from './config.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--backend' || !['cpu', 'cuda'].includes(args[1]))
  throw new Error(
    'Usage: yarn index-tts:build-runtime --backend cuda|cpu (CPU is for native development)'
  )
const backend = args[1]
const config = loadConfig()
const target = runtimeTarget()
if (!target) throw new Error('IndexTTS supports Linux/Windows x64')
const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
const output = (command, commandArgs) =>
  execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim()
for (const tool of ['git', 'cmake', 'ninja', ...(backend === 'cuda' ? ['nvcc'] : [])]) {
  try {
    output(tool, ['--version'])
  } catch {
    throw new Error(`${tool} is required to build IndexTTS`)
  }
}
const source = path.join(
  externalRoot,
  'downloads',
  `audio.cpp-${config.runtime.revision.slice(0, 7)}`
)
const build = path.join(externalRoot, 'downloads', `build-${backend}`)
if (!existsSync(path.join(source, '.git'))) {
  mkdirSync(path.dirname(source), { recursive: true })
  run('git', [
    'clone',
    '--depth',
    '1',
    '--no-checkout',
    '--filter=blob:none',
    config.runtime.repository,
    source
  ])
}
if (output('git', ['-C', source, 'rev-parse', 'HEAD']) !== config.runtime.revision) {
  run('git', ['-C', source, 'fetch', '--depth', '1', 'origin', config.runtime.revision])
  run('git', ['-C', source, 'checkout', '--detach', config.runtime.revision])
}
if (
  output('git', ['-C', source, 'rev-parse', 'HEAD']) !== config.runtime.revision ||
  output('git', ['-C', source, 'rev-parse', 'HEAD:external/ggml']) !== config.runtime.ggmlTree
)
  throw new Error('IndexTTS checkout or vendored GGML differs from pinned revision')
const patch = readFileSync(
  path.join(root, 'native', 'index-tts', 'content-addressed-gguf.patch'),
  'utf8'
).trim()
const currentDiff = output('git', ['-C', source, 'diff', '--no-ext-diff', '--binary'])
if (currentDiff && currentDiff !== patch)
  throw new Error('IndexTTS upstream checkout has unexpected local changes')
if (!currentDiff)
  run('git', ['-C', source, 'apply', '-'], {
    input: `${patch}\n`,
    stdio: ['pipe', 'inherit', 'inherit']
  })
run('cmake', [
  '-S',
  path.join(root, 'native', 'index-tts'),
  '-B',
  build,
  '-G',
  'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  `-DAUDIOCPP_SOURCE_DIR=${source}`,
  `-DENGINE_ENABLE_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
  '-DENGINE_ENABLE_OPENMP=OFF',
  '-DGGML_OPENMP=OFF',
  '-DBUILD_TESTING=ON',
  ...(backend === 'cuda'
    ? [
        `-DCMAKE_CUDA_ARCHITECTURES=${config.runtime.cudaArchitectures}`,
        '-DGGML_CUDA_NCCL=OFF',
        '-DGGML_CUDA_NO_VMM=ON'
      ]
    : [])
])
run('cmake', [
  '--build',
  build,
  '--target',
  'ls101-index-tts-helper',
  'index-tts-audio-test',
  '--parallel',
  String(Math.min(os.availableParallelism(), 8))
])
run('ctest', ['--test-dir', build, '-R', '^index-tts-audio$', '--output-on-failure'])

// CPU validation must never replace the CUDA library shipped with the app.
const runtimeRoot = path.join(externalRoot, backend === 'cuda' ? 'runtime' : 'runtime-cpu')
mkdirSync(runtimeRoot, { recursive: true })
const destination = path.join(runtimeRoot, target)
const runtime = mkdtempSync(path.join(runtimeRoot, `.${target}-`))
const helper = `ls101-index-tts-helper-${backend}${process.platform === 'win32' ? '.exe' : ''}`
try {
  const [binary, library] = readFileSync(path.join(build, 'runtime-files.txt'), 'utf8')
    .trim()
    .split(/\r?\n/)
  copyFileSync(binary, path.join(runtime, helper))
  if (process.platform !== 'win32') chmodSync(path.join(runtime, helper), 0o755)
  copyFileSync(library, path.join(runtime, path.basename(library)))
  for (const name of readdirSync(path.join(root, 'native', 'index-tts', 'licenses')))
    copyFileSync(path.join(root, 'native', 'index-tts', 'licenses', name), path.join(runtime, name))
  for (const [relative, filename] of [
    ['external/ggml/LICENSE', 'LICENSE.GGML.txt'],
    ['external/cJSON/LICENSE', 'LICENSE.cJSON.txt'],
    ['external/libyaml/License', 'LICENSE.libyaml.txt'],
    ['external/sentencepiece/LICENSE', 'LICENSE.sentencepiece.txt'],
    ['external/sentencepiece/third_party/absl/LICENSE', 'LICENSE.absl.txt'],
    ['external/sentencepiece/third_party/darts_clone/LICENSE', 'LICENSE.darts-clone.txt'],
    ['external/sentencepiece/third_party/esaxx/LICENSE', 'LICENSE.esaxx.txt'],
    ['external/sentencepiece/third_party/protobuf-lite/LICENSE', 'LICENSE.protobuf.txt']
  ])
    copyFileSync(path.join(source, relative), path.join(runtime, filename))

  // Dependency closure is supplied from a Toolkit redist directory in CUDA CI.
  // Linux system libraries and the NVIDIA driver stay provided by the target OS.
  if (backend === 'cuda') {
    const redistributable = process.env.INDEX_TTS_CUDA_REDIST_DIR
    if (!redistributable)
      throw new Error(
        'Set INDEX_TTS_CUDA_REDIST_DIR to the CUDA runtime redistributable directory before staging a CUDA runtime'
      )
    for (const name of readdirSync(redistributable)) {
      if (
        (process.platform === 'linux'
          ? /^lib(?:cublas|cublasLt|cudart|cufft|nvJitLink)\.so\.\d+$/.test(name)
          : /^(?:cublas|cudart|cufft|nvJitLink).*\.dll$/.test(name)) ||
        /^LICENSE/.test(name)
      )
        copyFileSync(path.join(redistributable, name), path.join(runtime, name))
    }
    const names = readdirSync(runtime)
    for (const dependency of ['cublas', 'cublasLt', 'cudart', 'cufft', 'nvJitLink']) {
      if (!names.some((name) => name.includes(dependency)))
        throw new Error(`Missing CUDA runtime dependency: ${dependency}`)
    }
    const license =
      process.env.INDEX_TTS_CUDA_LICENSE_FILE ?? path.resolve(redistributable, '..', 'EULA.txt')
    copyFileSync(
      license,
      path.join(
        runtime,
        path.extname(license) === '.html' ? 'LICENSE.NVIDIA-CUDA.html' : 'LICENSE.NVIDIA-CUDA.txt'
      )
    )
    if (process.platform === 'win32') {
      const crt =
        process.env.INDEX_TTS_MSVC_REDIST_DIR ??
        (process.env.VCToolsRedistDir &&
          path.join(process.env.VCToolsRedistDir, 'x64', 'Microsoft.VC143.CRT'))
      if (!crt)
        throw new Error(
          'INDEX_TTS_MSVC_REDIST_DIR or VCToolsRedistDir is required to stage the Windows runtime dependencies'
        )
      for (const name of readdirSync(crt)) {
        if (/\.dll$/i.test(name)) copyFileSync(path.join(crt, name), path.join(runtime, name))
      }
    }
  }
  writeFileSync(
    path.join(runtime, `build-${backend}.json`),
    `${JSON.stringify({ sourceCommit: config.runtime.revision, ggmlTree: config.runtime.ggmlTree, backend, target, cmake: output('cmake', ['--version']).split('\n')[0], toolchain: JSON.parse(readFileSync(path.join(build, 'toolchain.json'), 'utf8')), cudaArchitectures: backend === 'cuda' ? config.runtime.cudaArchitectures : undefined, lowLevelBackends: { cuda: backend === 'cuda', openmp: false, nativeCpu: false }, helper, builtFrom: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version }, null, 2)}\n`
  )
  const backup = `${runtime}.previous`
  if (existsSync(destination)) renameSync(destination, backup)
  try {
    renameSync(runtime, destination)
  } catch (error) {
    if (existsSync(backup)) renameSync(backup, destination)
    throw error
  }
  rmSync(backup, { recursive: true, force: true })
  console.log(`[index-tts] runtime staged in ${destination}`)
} finally {
  rmSync(runtime, { recursive: true, force: true })
}
