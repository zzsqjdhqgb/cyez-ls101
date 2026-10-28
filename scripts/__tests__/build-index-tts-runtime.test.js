/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/*
 * 覆盖 IndexTTS CPU helper 的 ISA 可移植契约：
 * - 默认构建不绑定构建机 ISA（ENGINE_ENABLE_NATIVE_CPU=OFF）
 * - --native-cpu 显式 opt-in 才允许 -march=native
 * - Linux CPU 产物落地后的 post-SSE2 静态反汇编门禁（含 XMM VEX/EVEX）
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

function instruction(mnemonic, operands = '') {
  return `  401000:\t c5 f8 58 c1          \t ${mnemonic} ${operands}`
}

test('detects VEX/EVEX regardless of vector width and AVX-512 opmask instructions', async () => {
  const { findPortableIsaViolations } = await modulePromise
  const cases = [
    ['vmovdqa', '%xmm0,%xmm1'],
    ['vaddps', '%xmm0,%xmm1,%xmm2'],
    ['vmovdqa64', '%zmm0,%zmm1'],
    ['vfmadd132ps', '%xmm0,%xmm1,%xmm2'],
    ['vcvtph2ps', '%xmm0,%xmm1'],
    ['vzeroupper'],
    ['kmovw', '%k1,%k2'],
    ['kortestq', '%k1,%k2']
  ]
  for (const [mnemonic, operands] of cases) {
    const violations = findPortableIsaViolations(instruction(mnemonic, operands))
    assert.equal(violations.length, 1, mnemonic)
    assert.equal(violations[0].mnemonic, mnemonic)
    assert.equal(violations[0].line, 1)
  }
})

test('detects legacy post-SSE2 SIMD, BMI, crypto and other common ISA extensions', async () => {
  const { findPortableIsaViolations } = await modulePromise
  const cases = [
    'addsubpd', // SSE3
    'monitor',
    'mwait',
    'pshufb', // SSSE3
    'roundss', // SSE4.1
    'pcmpestri', // SSE4.2
    'gf2p8affineinvqb', // GFNI
    'gf2p8mulb',
    'popcnt',
    'lzcnt',
    'andn', // BMI1
    'blsr',
    'bzhi', // BMI2
    'pext',
    'rorx',
    'movbe',
    'aesenc',
    'pclmulqdq',
    'sha256rnds2',
    'adcx',
    'rdrand',
    'rdtscp',
    'clflushopt',
    'movdiri',
    'enqcmd',
    'tpause',
    'encodekey128',
    'ldtilecfg',
    'tdpbf16ps',
    'monitorx',
    'rdpkru',
    'xsave'
  ]
  const disassembly = cases.map((mnemonic) => instruction(mnemonic)).join('\n')
  const violations = findPortableIsaViolations(disassembly)
  assert.deepEqual(
    violations.map(({ mnemonic }) => mnemonic),
    cases
  )
  assert.equal(violations.at(-1).line, cases.length)
})

test('parses Intel syntax and instruction prefixes without inspecting operands', async () => {
  const { findPortableIsaViolations } = await modulePromise
  const disassembly = [
    '  401000:\t c5 f9 6f c1          \t vmovdqa xmm1,xmm0',
    '  401005:\t f3 0f 1e fa          \t rep movbe eax,DWORD PTR [rdx]',
    '  40100a:\t f0 0f 01 c1          \t lock xsave BYTE PTR [rcx]',
    '  40100f:\t 0f 05                \t syscall # <vaddps@plt>'
  ].join('\n')
  assert.deepEqual(
    findPortableIsaViolations(disassembly).map(({ mnemonic }) => mnemonic),
    ['vmovdqa', 'movbe', 'xsave']
  )
})

test('skips segment override prefixes before checking the real instruction', async () => {
  const { findPortableIsaViolations } = await modulePromise
  const disassembly = [
    // Exact GNU objdump output for bytes 2e c5 f8 58 c1.
    '   0:\t2e c5 f8 58 c1       \tcs vaddps %xmm1,%xmm0,%xmm0',
    '   5:\t64 c5 f9 6f c1       \tfs vmovdqa xmm0,xmm1',
    '   a:\t65 c5 f9 6f c1       \tgs vmovdqa xmm0,xmm1',
    '   f:\t3e c5 f9 6f c1       \tds vmovdqa xmm0,xmm1',
    '  14:\t26 c5 f9 6f c1       \tes vmovdqa xmm0,xmm1',
    '  19:\t36 c5 f9 6f c1       \tss vmovdqa xmm0,xmm1'
  ].join('\n')
  assert.deepEqual(
    findPortableIsaViolations(disassembly).map(({ mnemonic }) => mnemonic),
    ['vaddps', 'vmovdqa', 'vmovdqa', 'vmovdqa', 'vmovdqa', 'vmovdqa']
  )
})

test('accepts SSE2 baseline and ignores comments, symbols, labels and malformed lines', async () => {
  const { findPortableIsaViolations } = await modulePromise
  const baseline = [
    'Disassembly of section .text:',
    '0000000000401000 <vaddps@plt>:',
    '0000000000401020 <aesenc_helper>:',
    'vaddps %ymm0,%ymm1',
    'note: vmovdqa %xmm0,%xmm1 and popcnt %eax',
    '  401000:\t 48 89 e5             \t mov %rsp,%rbp # vaddps %xmm0,%xmm1',
    '  401003:\t 0f 6f c1             \t movq %mm0,%mm1',
    '  401007:\t 66 0f 6f c1          \t movdqa %xmm0,%xmm1',
    '  40100c:\t 0f 58 c1             \t addps %xmm0,%xmm1',
    '  40100f:\t f3 0f 10 00          \t movss (%rax),%xmm0',
    '  401014:\t f2 0f 5e c1          \t divsd %xmm1,%xmm0',
    '  401018:\t 90                   \t nop # palignr %xmm1,%xmm0',
    // REP BSF remains backward compatible on pre-BMI CPUs; the compiler only
    // emits it here for nonzero std::gcd inputs where BSF/TZCNT results agree.
    '  401019:\t f3 48 0f bc fa       \t tzcnt %rdx,%rdi',
    '  40101e:\t 66 0f c5 c0 00       \t pextrw $0x0,%xmm0,%eax',
    '  401024:\t 66 0f c4 c1 00       \t pinsrw $0x0,%ecx,%xmm0',
    '  40102a:\t 0f 00 e0             \t verr %ax',
    '  40102d:\t 0f 00 e8             \t verw %ax',
    '  401030:\t c3                   \t ret',
    ''
  ].join('\n')
  // Annotations alone must not trigger; the real SSSE3 mnemonic is covered by
  // the negative test above.
  assert.deepEqual(findPortableIsaViolations(baseline), [])
  assert.deepEqual(findPortableIsaViolations(''), [])
})

test('stages the complete third-party license closure and records the runtime version', async () => {
  const { STAGED_RUNTIME_LICENSES } = await modulePromise
  assert.deepEqual(STAGED_RUNTIME_LICENSES, [
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
  for (const name of STAGED_RUNTIME_LICENSES) {
    assert.ok(
      readFileSync(path.join(__dirname, '..', '..', 'native', 'index-tts', 'licenses', name)).length
    )
  }
  const source = readFileSync(path.join(__dirname, '..', 'index-tts', 'build-runtime.mjs'), 'utf8')
  assert.match(source, /runtimeVersion:\s*assetConfig\.runtimeRelease\.version/)
})

test('embeds the upstream UTF-8 process code page manifest on Windows', () => {
  const cmakeLists = readFileSync(
    path.join(__dirname, '..', '..', 'native', 'index-tts', 'CMakeLists.txt'),
    'utf8'
  )
  assert.match(
    cmakeLists,
    /target_sources\(ls101-index-tts-helper PRIVATE\s+"\$\{AUDIOCPP_SOURCE_DIR\}\/tools\/cmake\/audiocpp_utf8\.manifest"/
  )
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
