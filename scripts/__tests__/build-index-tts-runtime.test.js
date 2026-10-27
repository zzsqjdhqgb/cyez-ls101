/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 覆盖 IndexTTS CPU helper 的 ISA 可移植契约：
 * - 默认构建不绑定构建机 ISA（ENGINE_ENABLE_NATIVE_CPU=OFF）
 * - --native-cpu 显式 opt-in 才允许 -march=native
 * - Linux CPU 产物落地后的 ymm/zmm 基线断言判定与计数语义
 * - native/index-tts/CMakeLists.txt 的可移植默认值锚点
 */

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const modulePromise = import('../index-tts/build-runtime.mjs')

const baseBuild = {
  backend: 'cpu',
  nativeCpu: false,
  cmakeGenerator: undefined,
  compilerLauncher: undefined,
  cudaArchitectures: '75;86-real;89-real;120a-real',
  projectDirectory: '/repo/native/index-tts',
  buildDirectory: '/repo/externals/ai/index-tts/downloads/index-tts-helper-build-cpu',
  sourceDirectory: '/repo/externals/ai/index-tts/downloads/audio.cpp'
}

test('imports without starting a build', async () => {
  const runtime = await modulePromise
  assert.equal(typeof runtime.parseArguments, 'function')
  assert.equal(typeof runtime.cmakeConfigureArguments, 'function')
})

test('parses the backend and the --native-cpu opt-in', async () => {
  const { parseArguments } = await modulePromise
  assert.deepEqual(parseArguments(['--backend', 'cpu']), { backend: 'cpu', nativeCpu: false })
  assert.deepEqual(parseArguments(['--backend', 'cpu', '--native-cpu']), {
    backend: 'cpu',
    nativeCpu: true
  })
  assert.deepEqual(parseArguments(['--native-cpu', '--backend', 'cuda']), {
    backend: 'cuda',
    nativeCpu: true
  })
})

test('rejects malformed command lines with the usage contract', async () => {
  const { parseArguments } = await modulePromise
  const usage = 'Usage: yarn index-tts:build-runtime --backend cpu|cuda [--native-cpu]'
  for (const args of [[], ['--backend'], ['--backend', 'gpu'], ['--backend', 'cpu', '--foo']]) {
    assert.throws(
      () => parseArguments(args),
      (error) => error.message === usage,
      `expected usage error for ${JSON.stringify(args)}`
    )
  }
})

test('configures cmake with the portable CPU baseline by default', async () => {
  const { cmakeConfigureArguments } = await modulePromise
  const args = cmakeConfigureArguments({ ...baseBuild })
  assert.ok(args.includes('-DCMAKE_BUILD_TYPE=Release'))
  assert.ok(args.includes('-DENGINE_ENABLE_NATIVE_CPU=OFF'))
  assert.ok(!args.includes('-DENGINE_ENABLE_NATIVE_CPU=ON'))
  assert.ok(args.includes('-DENGINE_ENABLE_CUDA=OFF'))
  assert.ok(args.includes('-DGGML_CUDA=OFF'))
  assert.ok(args.includes('-DAUDIOCPP_SOURCE_DIR=/repo/externals/ai/index-tts/downloads/audio.cpp'))
  assert.ok(!args.includes('-DGGML_CUDA_NO_VMM=ON'))
  assert.ok(!args.some((argument) => argument.startsWith('-DCMAKE_CUDA_ARCHITECTURES=')))
  assert.ok(!args.some((argument) => argument.startsWith('-DCMAKE_CUDA_COMPILER_LAUNCHER=')))
  assert.ok(!args.includes('-G'))
})

test('passes the host ISA switch only with --native-cpu', async () => {
  const { cmakeConfigureArguments } = await modulePromise
  const native = cmakeConfigureArguments({ ...baseBuild, nativeCpu: true })
  assert.ok(native.includes('-DENGINE_ENABLE_NATIVE_CPU=ON'))
  assert.ok(!native.includes('-DENGINE_ENABLE_NATIVE_CPU=OFF'))
})

test('forwards the CUDA configuration only for cuda builds', async () => {
  const { cmakeConfigureArguments } = await modulePromise
  const args = cmakeConfigureArguments({
    ...baseBuild,
    backend: 'cuda',
    cmakeGenerator: 'Ninja',
    compilerLauncher: '/opt/sccache'
  })
  assert.equal(args[args.indexOf('-G') + 1], 'Ninja')
  assert.ok(args.includes('-DENGINE_ENABLE_CUDA=ON'))
  assert.ok(args.includes('-DGGML_CUDA=ON'))
  assert.ok(args.includes('-DCMAKE_C_COMPILER_LAUNCHER=/opt/sccache'))
  assert.ok(args.includes('-DCMAKE_CXX_COMPILER_LAUNCHER=/opt/sccache'))
  assert.ok(args.includes('-DCMAKE_CUDA_COMPILER_LAUNCHER=/opt/sccache'))
  assert.ok(args.some((argument) => argument.startsWith('-DCMAKE_CUDA_ARCHITECTURES=75;86-real')))
  assert.ok(args.includes('-DGGML_CUDA_NO_VMM=ON'))
  assert.ok(args.includes('-DGGML_CUDA_NCCL=OFF'))
})

test('guards the ISA baseline assertion to default Linux CPU builds', async () => {
  const { requiresPortableIsaBaseline } = await modulePromise
  assert.equal(
    requiresPortableIsaBaseline({ backend: 'cpu', platform: 'linux', nativeCpu: false }),
    true
  )
  assert.equal(
    requiresPortableIsaBaseline({ backend: 'cpu', platform: 'linux', nativeCpu: true }),
    false
  )
  assert.equal(
    requiresPortableIsaBaseline({ backend: 'cuda', platform: 'linux', nativeCpu: false }),
    false
  )
  assert.equal(
    requiresPortableIsaBaseline({ backend: 'cpu', platform: 'win32', nativeCpu: false }),
    false
  )
  assert.equal(
    requiresPortableIsaBaseline({ backend: 'cpu', platform: 'darwin', nativeCpu: false }),
    false
  )
})

test('counts disassembly lines with grep -c semantics', async () => {
  const { countLinesContaining } = await modulePromise
  assert.equal(countLinesContaining('ymm ymm\nymm\nplain\n', 'ymm'), 2)
  assert.equal(countLinesContaining('ymm\nymm\nymm\n', 'ymm'), 3)
  assert.equal(countLinesContaining('no vectors here\n', 'ymm'), 0)
  assert.equal(countLinesContaining('', 'ymm'), 0)
  assert.equal(countLinesContaining('tail ymm', 'ymm'), 1)

  const disassembly = [
    '  401000:\t c5 fd 6f 05 ...\t vmovdqa %ymm0,%ymm0',
    '  40100a:\t 48 89 e5       \t mov %rsp,%rbp',
    '  40100d:\t 62 f1 7d 48 ...\t vmovdqa64 %zmm0,%zmm1'
  ].join('\n')
  assert.equal(countLinesContaining(disassembly, 'ymm'), 1)
  assert.equal(countLinesContaining(disassembly, 'zmm'), 1)
})

test('anchors the portable baseline in the helper CMakeLists', async () => {
  const cmakeLists = readFileSync(
    path.join(__dirname, '..', '..', 'native', 'index-tts', 'CMakeLists.txt'),
    'utf8'
  )
  const normalized = cmakeLists.replace(/\s+/g, ' ')
  // 默认值必须锚定在上游开关上：上游会按 ENGINE_ENABLE_NATIVE_CPU 的值 FORCE
  // 覆盖 GGML_NATIVE，单独 set(GGML_NATIVE OFF) 会被静默压掉。
  assert.match(normalized, /if\(NOT DEFINED ENGINE_ENABLE_NATIVE_CPU\)/)
  assert.match(normalized, /set\(ENGINE_ENABLE_NATIVE_CPU OFF CACHE BOOL/)
  assert.match(normalized, /set\(GGML_NATIVE \$\{ENGINE_ENABLE_NATIVE_CPU\} CACHE BOOL/)
  // ggml 的显式 ISA 选项一并压回 OFF，避免 -mavx2 等旗标混进默认构建。
  const isaOptions = [
    'GGML_SSE42',
    'GGML_AVX',
    'GGML_AVX_VNNI',
    'GGML_AVX2',
    'GGML_BMI2',
    'GGML_FMA',
    'GGML_F16C'
  ]
  for (const isaOption of isaOptions) {
    assert.match(
      normalized,
      new RegExp(`\\b${isaOption}\\b`),
      `${isaOption} must stay in the forced-off ISA option list`
    )
  }
})
