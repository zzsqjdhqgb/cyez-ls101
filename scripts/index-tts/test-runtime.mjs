/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import integrity from '../asset-integrity.js'
import { externalRoot, loadConfig, root, runtimeTarget } from './config.mjs'
import { validateManifest } from './install-runtime.mjs'
import { sampleResources } from './runtime-metrics.mjs'

export function parseOptions(argv) {
  const options = { cycles: 1, device: 0 }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index],
      value = argv[index + 1]
    const key = {
      '--backend': 'backend',
      '--cycles': 'cycles',
      '--device': 'device',
      '--output': 'outputDirectory'
    }[flag]
    if (!key || !value || value.startsWith('--') || seen.has(flag))
      throw new Error('Invalid runtime validation options')
    seen.add(flag)
    options[key] = ['cycles', 'device'].includes(key)
      ? /^\d+$/.test(value)
        ? Number(value)
        : NaN
      : value
  }
  if (
    !['cpu', 'cuda'].includes(options.backend) ||
    !Number.isInteger(options.cycles) ||
    options.cycles < 1 ||
    options.cycles > 20 ||
    !Number.isInteger(options.device) ||
    options.device < 0 ||
    options.device > 31
  )
    throw new Error(
      'Usage: yarn index-tts:test-runtime --backend cuda|cpu [--cycles 1..20] [--device 0..31] [--output <directory>]'
    )
  return options
}

function inspectWav(bytes, rate) {
  if (
    bytes.length < 46 ||
    bytes.length > 100 * 1024 ** 2 ||
    rate !== 22050 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== rate ||
    bytes.readUInt32LE(28) !== rate * 2 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString('ascii', 36, 40) !== 'data' ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    (bytes.length - 44) % 2 !== 0
  )
    throw new Error('Invalid mono PCM16 synthesis result')
  let peak = 0,
    squares = 0
  for (let offset = 44; offset < bytes.length; offset += 2) {
    const sample = bytes.readInt16LE(offset) / 32768
    peak = Math.max(peak, Math.abs(sample))
    squares += sample * sample
  }
  if (peak === 0) throw new Error('Synthesis returned silent audio')
  return {
    durationMs: ((bytes.length - 44) / (rate * 2)) * 1000,
    peakAmplitude: peak,
    rmsAmplitude: Math.sqrt(squares / ((bytes.length - 44) / 2))
  }
}

export async function validateRuntime({
  backend,
  cycles = 1,
  device = 0,
  outputDirectory = path.join(root, 'dist', `index-tts-validation-${backend}`),
  config = loadConfig(),
  assetRoot = externalRoot,
  spawnHelper = spawn,
  sample = sampleResources,
  timeoutMs = 30 * 60_000
}) {
  parseOptions(['--backend', backend, '--cycles', String(cycles), '--device', String(device)])
  await mkdir(outputDirectory, { recursive: true })
  // Unique reports and Unicode paths keep repeated platform/offline runs reviewable.
  const directory = await mkdtemp(path.join(path.resolve(outputDirectory), 'run-测试 '))
  console.log(`[index-tts] validation output: ${directory}`)
  const started = performance.now()
  const report = {
    status: 'running',
    startedAt: new Date().toISOString(),
    backend,
    target: runtimeTarget(),
    device,
    cycles,
    runtimeRevision: config.runtime.revision,
    modelSha256: config.model.sha256,
    requests: [],
    comparisons: [],
    resources: [],
    manualAcceptance: {
      voiceQuality: 'pending',
      modelReloadCount: 'pending',
      memoryTrend: 'pending',
      offlineFirstInference: 'pending'
    }
  }
  const model = path.join(directory, config.model.sha256)
  let child, closed, temporaryDirectory, timeout, monitor, pendingSample, failure, spawnError
  let phase = 'preflight',
    stderr = ''
  const log = createWriteStream(path.join(directory, 'helper-stderr.log'))
  log.on('error', (error) => {
    failure ??= error
    child?.kill('SIGKILL')
  })
  const interrupted = (signal) => {
    failure = new Error(`Validation interrupted by ${signal} during ${phase}`)
    child?.kill('SIGKILL')
  }
  const onInterrupt = () => interrupted('SIGINT')
  const onTerminate = () => interrupted('SIGTERM')
  const recordSample = () => {
    if (pendingSample || !child?.pid || child.exitCode !== null || child.signalCode !== null)
      return pendingSample
    const label = phase
    pendingSample = sample(child.pid, backend)
      .then((resources) => {
        report.resources.push({
          elapsedMs: Math.round(performance.now() - started),
          phase: label,
          ...resources
        })
      })
      .catch((error) => {
        report.resources.push({ phase: label, errors: [error.message] })
      })
      .finally(() => {
        pendingSample = undefined
      })
    return pendingSample
  }
  try {
    if (!report.target) throw new Error('Unsupported runtime platform')
    const runtime = path.join(
      assetRoot,
      backend === 'cpu' ? 'runtime-cpu' : 'runtime',
      report.target
    )
    const executable = path.join(
      runtime,
      `ls101-index-tts-helper-${backend}${process.platform === 'win32' ? '.exe' : ''}`
    )
    report.build = JSON.parse(await readFile(path.join(runtime, `build-${backend}.json`), 'utf8'))
    if (
      report.build.sourceCommit !== config.runtime.revision ||
      report.build.ggmlTree !== config.runtime.ggmlTree ||
      report.build.target !== report.target ||
      report.build.backend !== backend
    )
      throw new Error('Runtime build metadata differs from the pinned configuration')
    const artifact = await readFile(path.join(runtime, 'artifact-manifest.json'), 'utf8').catch(
      (error) => {
        if (error.code !== 'ENOENT') throw error
        return null
      }
    )
    if (artifact) {
      report.artifactManifest = JSON.parse(artifact)
      for (const asset of validateManifest(report.artifactManifest, report.target, config))
        await integrity.assertAssetFile(path.join(runtime, asset.path), asset)
    }
    report.helperSha256 = await integrity.sha256File(executable)
    await integrity.assertAssetFile(path.join(assetRoot, 'models', config.model.file), config.model)
    await copyFile(path.join(assetRoot, 'models', config.model.file), model)
    const voices = []
    for (const voice of config.voices.slice(0, 2)) {
      const input = path.resolve(root, voice.file)
      const bytes = await readFile(input)
      if (createHash('sha256').update(bytes).digest('hex') !== voice.sha256)
        throw new Error(`Reference integrity differs: ${voice.id}`)
      const filename = path.join(directory, `参考 ${voice.id}.wav`)
      await writeFile(filename, bytes)
      voices.push({ ...voice, filename })
    }
    if (voices.length !== 2) throw new Error('A → B → A validation requires two voices')
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'index-tts-native-validation-'))
    if (failure) throw failure
    phase = 'startup'
    const loadStarted = performance.now()
    child = spawnHelper(
      executable,
      [
        '--model',
        model,
        '--backend',
        backend,
        '--device',
        String(device),
        '--threads',
        '4',
        '--low-memory',
        '1'
      ],
      {
        env: {
          ...process.env,
          ...(process.platform === 'linux'
            ? {
                LD_LIBRARY_PATH: [runtime, process.env.LD_LIBRARY_PATH]
                  .filter(Boolean)
                  .join(path.delimiter)
              }
            : {}),
          TMPDIR: temporaryDirectory,
          TEMP: temporaryDirectory,
          TMP: temporaryDirectory
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    report.processId = child.pid
    closed = new Promise((resolve) =>
      child.once('close', (code, signal) => resolve({ code, signal }))
    )
    child.once('error', (error) => {
      spawnError = error
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16384)
    })
    child.stderr.pipe(log)
    child.stdin.on('error', () => undefined)
    process.once('SIGINT', onInterrupt)
    process.once('SIGTERM', onTerminate)
    timeout = setTimeout(() => {
      failure = new Error(`Validation timed out during ${phase}`)
      child.kill('SIGKILL')
    }, timeoutMs)
    monitor = setInterval(recordSample, 1000)
    const output = child.stdout[Symbol.asyncIterator]()
    let buffered = Buffer.alloc(0)
    async function readBytes(size) {
      while (buffered.length < size) {
        const next = await output.next()
        if (next.done)
          throw failure ?? spawnError ?? new Error(`Helper closed during ${phase}: ${stderr}`)
        buffered = Buffer.concat([buffered, next.value])
        if (buffered.length > 100 * 1024 ** 2 + 4096) throw new Error('Oversized helper output')
      }
      const bytes = buffered.subarray(0, size)
      buffered = buffered.subarray(size)
      return bytes
    }
    async function header() {
      let text = ''
      for (;;) {
        const byte = (await readBytes(1))[0]
        if (byte === 10) return text
        if (text.length >= 4096) throw new Error('Oversized helper header')
        text += String.fromCharCode(byte)
      }
    }
    if ((await header()) !== 'READY 1') throw new Error('Unexpected helper handshake')
    report.startupMs = Math.round(performance.now() - loadStarted)
    console.log(`[index-tts] model ready in ${report.startupMs} ms; pid=${child.pid}`)
    await recordSample()
    async function request(voice, language = 'en', invalid = false) {
      const id = `request${report.requests.length}`
      phase = id
      const entry = {
        id,
        processId: child.pid,
        voice: voice.id,
        language,
        text: language === 'zh' ? '你好。' : 'Hello.',
        status: 'running'
      }
      report.requests.push(entry)
      const payload = Buffer.from(
        JSON.stringify({
          text: entry.text,
          language,
          voicePath: invalid ? path.join(directory, 'missing-reference.wav') : voice.filename,
          maxTokens: 128,
          seed: 42
        })
      )
      const start = performance.now()
      child.stdin.write(
        Buffer.concat([Buffer.from(`SYNTHESIZE ${id} ${payload.length}\n`), payload])
      )
      const fields = (await header()).split(' ')
      const size = Number(fields.at(-1))
      if (
        fields[1] !== id ||
        !/^[0-9]+$/.test(fields.at(-1)) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > 100 * 1024 ** 2
      )
        throw new Error('Invalid response ID or size')
      if (
        !(
          (fields[0] === 'RESULT' && fields.length === 4) ||
          (fields[0] === 'ERROR' && fields.length === 3)
        )
      )
        throw new Error('Invalid result header')
      const bytes = await readBytes(size)
      entry.elapsedMs = Math.round(performance.now() - start)
      if (invalid) {
        if (fields[0] !== 'ERROR' || !bytes.toString().includes('Cannot open reference WAV'))
          throw new Error('Invalid reference was not rejected as expected')
        Object.assign(entry, { status: 'expected-error', error: bytes.toString() })
      } else {
        if (fields[0] === 'ERROR') throw new Error(bytes.toString())
        const rate = Number(fields[2])
        const audio = inspectWav(bytes, rate)
        const filename = `${id}-${voice.id}-${language}.wav`
        await writeFile(path.join(directory, filename), bytes)
        Object.assign(entry, audio, {
          status: 'passed',
          filename,
          sampleRate: rate,
          audioBytes: bytes.length,
          audioSha256: createHash('sha256').update(bytes).digest('hex')
        })
      }
      console.log(
        `[index-tts] ${id} ${voice.id} ${language}: ${entry.status}, ${entry.elapsedMs} ms`
      )
      await recordSample()
      return entry
    }
    for (let cycle = 0; cycle < cycles; cycle++) {
      const first = await request(voices[0])
      const second = await request(voices[1])
      const third = await request(voices[0])
      const equal = first.audioSha256 === third.audioSha256
      report.comparisons.push({
        cycle,
        first: first.id,
        second: second.id,
        third: third.id,
        fixedSeedMatch: equal
      })
      if (first.audioSha256 === second.audioSha256)
        throw new Error('Different voices returned identical audio; investigate reference handling')
      if (!equal && backend === 'cpu')
        throw new Error('Fixed-seed A output changed after B; investigate reference state leakage')
      if (!equal)
        console.log('[index-tts] CUDA A results differ; review the WAVs and runtime diagnostics')
    }
    await request(voices[0], 'zh')
    await request(voices[0], 'en', true)
    await request(voices[1])
    report.status = report.comparisons.every((comparison) => comparison.fixedSeedMatch)
      ? 'passed'
      : 'review'
  } catch (error) {
    failure = error
  } finally {
    clearTimeout(timeout)
    clearInterval(monitor)
    await pendingSample
    if (child) {
      phase = 'cleanup'
      if (failure) child.kill('SIGKILL')
      else child.stdin.end()
      const forcedExit = setTimeout(() => {
        failure ??= new Error('Helper did not exit after stdin closed')
        child.kill('SIGKILL')
      }, 5000)
      try {
        report.exit = await closed
        if (!failure && report.exit.code !== 0)
          failure = new Error(
            `Helper exited with code ${report.exit.code}, signal ${report.exit.signal}`
          )
      } finally {
        clearTimeout(forcedExit)
      }
    }
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    try {
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
      await rm(model, { force: true })
    } catch (error) {
      failure ??= error
    }
    if (!log.writableEnded) log.end()
    await finished(log).catch((error) => {
      failure ??= error
    })
    if (failure) {
      report.status = 'failed'
      report.error = failure.message
      const active = report.requests.find((entry) => entry.status === 'running')
      if (active) Object.assign(active, { status: 'failed', error: failure.message })
    }
    report.stderrTail = stderr
    report.finishedAt = new Date().toISOString()
    report.elapsedMs = Math.round(performance.now() - started)
    await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(`[index-tts] ${report.status}; report: ${path.join(directory, 'report.json')}`)
  }
  if (failure) throw failure
  return { directory, report }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve()
    .then(() => validateRuntime(parseOptions(process.argv.slice(2))))
    .then(({ report }) => {
      if (report.status === 'review') process.exitCode = 2
    })
    .catch((error) => {
      console.error(`[index-tts] runtime validation failed: ${error.message}`)
      process.exitCode = 1
    })
}
