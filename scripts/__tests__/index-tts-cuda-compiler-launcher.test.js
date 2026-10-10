const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const launcher = path.resolve(__dirname, '../index-tts/cuda-compiler-launcher.mjs')
const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

test('configures the Windows selector and keeps Linux and uncached builds direct', async () => {
  const { cudaCompilerLauncher } = await import('../index-tts/cuda-compiler-launcher.mjs')
  const cache = 'C:\\cache tools\\缓存\\sccache.exe'
  assert.deepEqual(cudaCompilerLauncher(cache, 'win32').split(';'), [
    process.execPath,
    launcher,
    cache
  ])
  assert.equal(cudaCompilerLauncher(cache, 'linux'), cache)
  for (const platform of ['win32', 'linux']) {
    assert.equal(cudaCompilerLauncher(undefined, platform), '')
    assert.equal(cudaCompilerLauncher('', platform), '')
  }
})

test('bypasses only the GGML mmvf input, including Windows paths and response-file flags', async () => {
  const { compilerInvocation } = await import('../index-tts/cuda-compiler-launcher.mjs')
  for (const source of [
    'D:\\build tree\\external\\ggml\\src\\ggml-cuda\\mmvf.cu',
    'D:/build tree/external/ggml/src/ggml-cuda/mmvf.cu',
    'D:/build tree/external/ggml/src/GGML-CUDA/MMVF.CU',
    '../external/ggml/src/ggml-cuda/mmvf.cu'
  ]) {
    const args = ['--options-file', 'flags with spaces.rsp', '-c', source, '-o', `${source}.obj`]
    const invocation = compilerInvocation('sccache.exe', 'nvcc.exe', args)
    assert.equal(invocation.bypassCache, true, source)
    assert.equal(invocation.command, 'nvcc.exe')
    assert.deepEqual(invocation.args, args)
  }
})

test('caches other CUDA files without confusing mmvf defines, outputs or response files', async () => {
  const { compilerInvocation } = await import('../index-tts/cuda-compiler-launcher.mjs')
  const args = [
    '-DTEST_SOURCE=D:/external/ggml/src/ggml-cuda/mmvf.cu',
    '-ID:/include/ggml-cuda/mmvf.cu',
    '@ggml-cuda/mmvf.cu',
    '@D:/flags/ggml-cuda/mmvf.cu',
    '-c',
    'D:/external/ggml/src/ggml-cuda/mmv.cu',
    '-o',
    'D:/external/ggml/src/ggml-cuda/mmvf.cu.obj'
  ]
  const invocation = compilerInvocation('sccache.exe', 'nvcc.exe', args)
  assert.equal(invocation.bypassCache, false)
  assert.equal(invocation.command, 'sccache.exe')
  assert.deepEqual(invocation.args, ['nvcc.exe', ...args])
  const other = compilerInvocation('sccache.exe', 'nvcc.exe', ['-c', 'other/mmvf.cu'])
  assert.equal(other.command, 'sccache.exe')
})

async function recorder() {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-cuda 缓存 '))
  directories.push(directory)
  const script = path.join(directory, 'compiler recorder.cjs')
  await writeFile(
    script,
    `console.log(JSON.stringify({ argv: process.argv.slice(1), environment: process.env.INDEX_TTS_LAUNCHER_TEST }))
process.stderr.write('compiler diagnostic\\n')
process.exitCode = Number(process.env.INDEX_TTS_LAUNCHER_TEST_EXIT || 0)
`
  )
  return script
}

function launch(args, exitCode = 0) {
  return spawnSync(process.execPath, [launcher, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      INDEX_TTS_LAUNCHER_TEST: 'inherited environment',
      INDEX_TTS_LAUNCHER_TEST_EXIT: String(exitCode)
    }
  })
}

test('direct compilation preserves arguments, environment, diagnostics and compiler exit code', async () => {
  const script = await recorder()
  const args = [
    script,
    '-DNAME="space value"',
    'literal $() `text` & | ;',
    '-c',
    'D:\\源码 with spaces\\ggml-cuda\\mmvf.cu',
    '-o',
    'mmvf.cu.obj'
  ]
  // A nonexistent cache proves that the bypass never starts it.
  const result = launch(
    [path.join(path.dirname(script), 'missing-sccache'), process.execPath, ...args],
    23
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 23)
  const lines = result.stdout.trim().split('\n')
  assert.match(lines[0], /mmvf\.cu: bypassing sccache/)
  assert.deepEqual(JSON.parse(lines[1]), {
    argv: args,
    environment: 'inherited environment'
  })
  assert.equal(result.stderr, 'compiler diagnostic\n')
})

test('cached compilation prepends the compiler and preserves cache output and exit code', async () => {
  const compiler = await recorder()
  const args = ['-c', 'D:\\源码 with spaces\\ggml-cuda\\norm.cu', '-o', 'norm.cu.obj']
  // Node acts as the cache recorder; it receives the compiler as its first argument.
  for (const exitCode of [0, 37]) {
    const result = launch([process.execPath, compiler, ...args], exitCode)
    assert.equal(result.error, undefined)
    assert.equal(result.status, exitCode)
    assert.deepEqual(JSON.parse(result.stdout), {
      argv: [compiler, ...args],
      environment: 'inherited environment'
    })
    assert.equal(result.stderr, 'compiler diagnostic\n')
  }
})

test('launcher usage and process startup errors fail the build with a readable diagnostic', async () => {
  const script = await recorder()
  for (const args of [
    [],
    [process.execPath],
    [path.join(path.dirname(script), 'missing-cache'), 'nvcc.exe', '-c', 'ggml-cuda/norm.cu'],
    [process.execPath, path.join(path.dirname(script), 'missing-nvcc'), '-c', 'ggml-cuda/mmvf.cu']
  ]) {
    const result = launch(args)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /CUDA compiler launcher failed: (Usage:|spawnSync .* ENOENT)/)
  }
})
