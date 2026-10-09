/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { externalRoot, loadConfig, root } from './config.mjs'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--backend' || !['cuda', 'cpu'].includes(args[1]))
  throw new Error('Usage: yarn index-tts:test-runtime --backend cuda|cpu')
const backend = args[1],
  config = loadConfig()
const directory = path.join(root, 'dist', `index-tts-validation-${backend}`)
await mkdir(directory, { recursive: true })
// Exercise the exact extensionless filename convention used by the model store.
const model = path.join(directory, config.model.sha256)
await copyFile(path.join(externalRoot, 'models', config.model.file), model)
const executable = path.join(
  externalRoot,
  backend === 'cpu' ? 'runtime-cpu' : 'runtime',
  `${process.platform}-${process.arch}`,
  `ls101-index-tts-helper-${backend}${process.platform === 'win32' ? '.exe' : ''}`
)
const started = performance.now()
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'index-tts-native-validation-'))
const child = spawn(
  executable,
  ['--model', model, '--backend', backend, '--threads', '4', '--low-memory', '1'],
  {
    env: {
      ...process.env,
      ...(process.platform === 'linux'
        ? {
            LD_LIBRARY_PATH: [path.dirname(executable), process.env.LD_LIBRARY_PATH]
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
const closed = once(child, 'close')
void closed.catch(() => undefined)
const output = child.stdout[Symbol.asyncIterator]()
let buffered = Buffer.alloc(0),
  stderr = ''
child.stderr.on('data', (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-16384)
})
child.stdin.on('error', () => undefined)
const timeout = setTimeout(() => child.kill('SIGKILL'), 30 * 60_000)
async function readBytes(size) {
  while (buffered.length < size) {
    const next = await output.next()
    if (next.done) throw new Error(`Helper closed: ${stderr}`)
    buffered = Buffer.concat([buffered, next.value])
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
try {
  if ((await header()) !== 'READY 1') throw new Error('Unexpected helper handshake')
  console.log(
    `[index-tts] model ready in ${Math.round(performance.now() - started)} ms; pid=${child.pid}`
  )
  const report = {
    backend,
    runtimeRevision: config.runtime.revision,
    modelSha256: config.model.sha256,
    processId: child.pid,
    startupMs: Math.round(performance.now() - started),
    requests: []
  }
  for (const [index, voice] of [config.voices[0], config.voices[1], config.voices[0]].entries()) {
    const text = index === 1 ? '你好。' : 'Hello.'
    const payload = Buffer.from(
      JSON.stringify({
        text,
        language: index === 1 ? 'zh' : 'en',
        voicePath: path.resolve(root, voice.file),
        maxTokens: 128,
        seed: 42
      })
    )
    const start = performance.now()
    child.stdin.write(
      Buffer.concat([Buffer.from(`SYNTHESIZE request${index} ${payload.length}\n`), payload])
    )
    const fields = (await header()).split(' ')
    const size = Number(fields.at(-1))
    if (!Number.isSafeInteger(size) || size < 0 || size > 100 * 1024 * 1024)
      throw new Error('Invalid result size')
    const bytes = await readBytes(size)
    if (fields[0] === 'ERROR') throw new Error(bytes.toString())
    if (
      fields[0] !== 'RESULT' ||
      fields[1] !== `request${index}` ||
      size < 46 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.readUInt32LE(40) !== bytes.length - 44
    )
      throw new Error('Invalid synthesis result')
    const filename = `${index}-${voice.id}.wav`
    await writeFile(path.join(directory, filename), bytes)
    const processStatus =
      process.platform === 'linux'
        ? await readFile(`/proc/${child.pid}/status`, 'utf8').catch(() => '')
        : ''
    report.requests.push({
      voice: voice.id,
      text,
      filename,
      elapsedMs: Math.round(performance.now() - start),
      sampleRate: Number(fields[2]),
      audioBytes: bytes.length,
      audioSha256: createHash('sha256').update(bytes).digest('hex'),
      residentMemory: processStatus.match(/^VmRSS:.*$/m)?.[0],
      peakResidentMemory: processStatus.match(/^VmHWM:.*$/m)?.[0]
    })
    console.log(`[index-tts] ${JSON.stringify(report.requests.at(-1))}`)
  }
  if (report.requests[0].audioSha256 !== report.requests[2].audioSha256)
    throw new Error('Fixed-seed A output changed after B; investigate reference state leakage')
  await writeFile(path.join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `[index-tts] real A → B → A validation written to ${directory}; listen to the WAVs for quality acceptance`
  )
} finally {
  clearTimeout(timeout)
  child.stdin.end()
  const forcedExit = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await closed
  } finally {
    clearTimeout(forcedExit)
    await rm(temporaryDirectory, { recursive: true, force: true })
    await rm(model, { force: true })
  }
}
