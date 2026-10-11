const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { afterEach, test } = require('node:test')

const directories = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixture(mode = 'normal', backend = 'cpu') {
  const directory = await mkdtemp(path.join(tmpdir(), 'index-validation '))
  directories.push(directory)
  const { loadConfig } = await import('../index-tts/config.mjs')
  const config = structuredClone(loadConfig())
  const model = Buffer.from('GGUF validation fixture')
  Object.assign(config.model, {
    size: model.length,
    sha256: createHash('sha256').update(model).digest('hex')
  })
  const assetRoot = path.join(directory, 'assets')
  const target = `${process.platform}-${process.arch}`
  const runtime = path.join(assetRoot, backend === 'cpu' ? 'runtime-cpu' : 'runtime', target)
  await mkdir(runtime, { recursive: true })
  await mkdir(path.join(assetRoot, 'models'))
  await writeFile(path.join(assetRoot, 'models', config.model.file), model)
  await writeFile(
    path.join(runtime, `build-${backend}.json`),
    JSON.stringify({
      sourceCommit: config.runtime.revision,
      ggmlTree: config.runtime.ggmlTree,
      target,
      backend
    })
  )
  const script = path.join(
    runtime,
    `ls101-index-tts-helper-${backend}${process.platform === 'win32' ? '.exe' : ''}`
  )
  await writeFile(
    script,
    `
const fs = require('node:fs')
const path = require('node:path')
const mode = process.env.INDEX_TTS_VALIDATION_FIXTURE_MODE
const model = process.argv[process.argv.indexOf('--model') + 1]
if (!path.isAbsolute(model) || !model.includes('测试') || path.extname(model)) throw new Error('Wrong model path')
fs.writeFileSync(path.join(process.env.TMPDIR, 'materialized-tokenizer'), 'temporary')
process.stderr.write('fixture diagnostic ' + 'x'.repeat(20000) + '\\n')
if (mode !== 'hang') process.stdout.write('READY 1\\n')
let buffer = Buffer.alloc(0), count = 0
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf(10)
    if (end < 0) return
    const [, id, length] = buffer.subarray(0, end).toString().split(' ')
    if (buffer.length < end + 1 + Number(length)) return
    const payload = JSON.parse(buffer.subarray(end + 1, end + 1 + Number(length)).toString())
    buffer = buffer.subarray(end + 1 + Number(length))
    if (!fs.existsSync(payload.voicePath)) {
      const bytes = Buffer.from('Cannot open reference WAV')
      process.stdout.write(Buffer.concat([Buffer.from('ERROR ' + id + ' ' + bytes.length + '\\n'), bytes]))
      continue
    }
    const bytes = Buffer.alloc(64)
    bytes.write('RIFF'); bytes.writeUInt32LE(56, 4); bytes.write('WAVEfmt ', 8)
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(22050, 24); bytes.writeUInt32LE(44100, 28)
    bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(20, 40)
    let value = payload.voicePath.includes('american-woman') ? 2000 : 1000
    if (mode === 'vary-A' && count === 2) value++
    if (mode !== 'silent') for (let offset = 44; offset < 64; offset += 2) bytes.writeInt16LE(value, offset)
    const resultId = mode === 'bad-id' ? 'wrong' : id
    process.stdout.write(Buffer.concat([Buffer.from('RESULT ' + resultId + ' 22050 ' + bytes.length + '\\n'), mode === 'truncated' ? bytes.subarray(0, 50) : bytes]))
    count++
    if (mode === 'truncated') process.exit(0)
  }
})
`
  )
  let child, invocation
  const options = {
    backend,
    config,
    assetRoot,
    outputDirectory: path.join(directory, 'reports'),
    spawnHelper: (_executable, args, opts) => {
      invocation = { args, opts }
      child = spawn(
        mode === 'spawn-error' ? path.join(directory, 'missing-executable') : process.execPath,
        [script, ...args],
        { ...opts, env: { ...opts.env, INDEX_TTS_VALIDATION_FIXTURE_MODE: mode } }
      )
      return child
    },
    sample: async () => ({
      residentMemoryBytes: 1234,
      peakResidentMemoryBytes: 2345,
      gpuProcesses: [],
      errors: []
    })
  }
  return { options, getChild: () => child, getInvocation: () => invocation }
}

async function savedReport(options) {
  const runs = await readdir(options.outputDirectory)
  assert.equal(runs.length, 1)
  const directory = path.join(options.outputDirectory, runs[0])
  return {
    directory,
    report: JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'))
  }
}

test('records A → B → A, separate Chinese inference and request-error recovery with one helper', async () => {
  const { validateRuntime } = await import('../index-tts/test-runtime.mjs')
  const fixtureValue = await fixture()
  const { report, directory } = await validateRuntime(fixtureValue.options)
  assert.equal(report.status, 'passed')
  assert.equal(report.requests.length, 6)
  assert.deepEqual(
    report.requests.slice(0, 3).map((entry) => entry.language),
    ['en', 'en', 'en']
  )
  assert.equal(report.requests[3].language, 'zh')
  assert.equal(report.requests[4].status, 'expected-error')
  assert.equal(report.requests[5].status, 'passed')
  assert.equal(new Set(report.requests.map((entry) => entry.processId)).size, 1)
  assert.equal(report.comparisons[0].fixedSeedMatch, true)
  assert.equal(report.manualAcceptance.voiceQuality, 'pending')
  assert.equal(report.exit.code, 0)
  assert.ok(report.resources.length > 0)
  assert.ok((await readFile(path.join(directory, 'helper-stderr.log'))).length > 16384)
  assert.ok(report.stderrTail.length <= 16384)
  await assert.rejects(stat(path.join(directory, fixtureValue.options.config.model.sha256)), {
    code: 'ENOENT'
  })
  await assert.rejects(stat(fixtureValue.getInvocation().opts.env.TMPDIR), { code: 'ENOENT' })
  assert.equal(
    (await readdir(directory)).filter((file) => file.startsWith('request') && file.endsWith('.wav'))
      .length,
    5
  )
})

test('saves failures and cleans up on bad IDs, truncated output, silent audio and spawn errors', async () => {
  const { validateRuntime } = await import('../index-tts/test-runtime.mjs')
  for (const mode of ['bad-id', 'truncated', 'silent', 'spawn-error']) {
    const fixtureValue = await fixture(mode)
    await assert.rejects(
      validateRuntime(fixtureValue.options),
      /response ID|Helper closed|silent audio|ENOENT/
    )
    const { directory, report } = await savedReport(fixtureValue.options)
    assert.equal(report.status, 'failed')
    assert.ok(report.error)
    assert.ok(
      fixtureValue.getChild().exitCode !== null || fixtureValue.getChild().signalCode !== null
    )
    await assert.rejects(stat(path.join(directory, fixtureValue.options.config.model.sha256)), {
      code: 'ENOENT'
    })
    await assert.rejects(stat(fixtureValue.getInvocation().opts.env.TMPDIR), { code: 'ENOENT' })
  }
})

test('startup timeouts terminate the helper and still produce a failure report', async () => {
  const { validateRuntime } = await import('../index-tts/test-runtime.mjs')
  const fixtureValue = await fixture('hang')
  await assert.rejects(
    validateRuntime({ ...fixtureValue.options, timeoutMs: 200 }),
    /timed out during startup/
  )
  const { report } = await savedReport(fixtureValue.options)
  assert.equal(report.status, 'failed')
  assert.ok(report.exit.signal || report.exit.code !== 0)
})

test('a corrupt model fails before spawning and leaves a distinct report', async () => {
  const { validateRuntime } = await import('../index-tts/test-runtime.mjs')
  const fixtureValue = await fixture()
  await writeFile(
    path.join(fixtureValue.options.assetRoot, 'models', fixtureValue.options.config.model.file),
    'corrupt'
  )
  await assert.rejects(validateRuntime(fixtureValue.options), /大小|SHA-256/)
  assert.equal(fixtureValue.getChild(), undefined)
  assert.equal((await savedReport(fixtureValue.options)).report.status, 'failed')
})

test('CPU repeat mismatches fail, while CUDA mismatches remain visible for review', async () => {
  const { validateRuntime } = await import('../index-tts/test-runtime.mjs')
  const cpu = await fixture('vary-A')
  await assert.rejects(validateRuntime(cpu.options), /Fixed-seed A output changed/)
  const cuda = await fixture('vary-A', 'cuda')
  const { report } = await validateRuntime(cuda.options)
  assert.equal(report.status, 'review')
  assert.equal(report.comparisons[0].fixedSeedMatch, false)
  assert.equal(report.manualAcceptance.voiceQuality, 'pending')
})

test('samples Windows working sets and reports unavailable WDDM GPU memory without inventing a value', async () => {
  const { sampleResources } = await import('../index-tts/runtime-metrics.mjs')
  const result = await sampleResources(123, 'cuda', {
    platform: 'win32',
    run: async (command) => ({
      stdout:
        command === 'powershell.exe'
          ? '{"WorkingSet64":1024,"PeakWorkingSet64":2048}'
          : '123, GPU-one, N/A\n999, GPU-two, 400\n123, GPU-three, 12\n'
    })
  })
  assert.equal(result.residentMemoryBytes, 1024)
  assert.equal(result.peakResidentMemoryBytes, 2048)
  assert.deepEqual(result.gpuProcesses, [
    { gpuUuid: 'GPU-one', memoryBytes: null },
    { gpuUuid: 'GPU-three', memoryBytes: 12 * 1024 ** 2 }
  ])
})

test('reads Linux resident and peak memory and preserves GPU query failures', async () => {
  const { sampleResources } = await import('../index-tts/runtime-metrics.mjs')
  const result = await sampleResources(123, 'cuda', {
    platform: 'linux',
    read: async () => 'VmRSS:\t12 kB\nVmHWM:\t24 kB\n',
    run: async () => {
      throw new Error('nvidia-smi unavailable')
    }
  })
  assert.equal(result.residentMemoryBytes, 12 * 1024)
  assert.equal(result.peakResidentMemoryBytes, 24 * 1024)
  assert.match(result.errors[0], /nvidia-smi unavailable/)
})
