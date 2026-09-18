/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * Pure helpers for the lab acceptance run inside the disposable VM.
 *
 * These live in Node rather than PowerShell so they can be executed by `yarn vm:test` in the container.
 * The PowerShell versions of exactly these functions produced three defects that only surfaced after a
 * full VM rebuild: a JSON reader that returned the first character of a one-line payload, an assertion
 * helper that could not bind a one-item pipeline result, and a configuration variable that PowerShell
 * silently coerced to text. None of those are expressible here, and all of them are now testable.
 *
 * Node builtins only: the guest has the base box runtime but no node_modules.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Probes print one marked line, so their payload is found by prefix rather than by guessing which line
// looks like JSON. PowerShell's ConvertTo-Json pretty-prints by default, which is why the marker and a
// compressed payload are both required.
export const PROBE_PREFIX = 'LS101PROBE|'

// Keys the phase script reads. A missing one must name itself here rather than becoming `undefined`
// somewhere downstream.
export const REQUIRED_CONFIG_KEYS = [
  'installer',
  'driver',
  // The protocol driver is required from milestone M2 on: the phase run cannot reach the service
  // without it, so a configuration that omits it must fail at parse time rather than mid-run.
  'protocolDriver',
  'harness',
  'probes',
  'invitationFile',
  'releaseVersion',
  'port',
  'hostTime',
  'node',
  'serviceName',
  'serviceAccount',
  'programDir',
  'dataRoot',
  'dataDir',
  'resultsDir'
]

export class AssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AssertionError'
  }
}

// Assertions take a real boolean. PowerShell's parameter binding refused to convert a string to [bool],
// and its collections follow "non-empty is true", so a helper that accepted anything made an assertion
// about a collection behave differently depending on how many items matched. Requiring a boolean keeps
// that decision at the call site, where it is visible.
export function assertThat(condition, message, details) {
  if (condition !== true) {
    const suffix =
      details === undefined
        ? ''
        : `\n${typeof details === 'string' ? details : JSON.stringify(details, null, 2)}`
    throw new AssertionError(`${message}${suffix}`)
  }
}

// "At least one entry satisfies this" is the shape most assertions actually need.
export function assertSome(entries, predicate, message) {
  const list = Array.isArray(entries) ? entries : []
  assertThat(list.some(predicate), message, list)
}

export function assertNone(entries, predicate, message) {
  const list = Array.isArray(entries) ? entries : []
  assertThat(!list.some(predicate), message, list)
}

// PowerShell 5.1 renders a one-element array as a bare scalar inside ConvertTo-Json, so a probe that
// found exactly one listener and a probe that found none produced different shapes. Normalising here,
// in tested code, keeps that quirk out of every assertion.
export function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

// Reads the last line that parses as JSON. A single line is the common case and is exactly what the
// PowerShell version got wrong, so it is covered directly by the tests.
export function extractJsonPayload(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index])
    } catch {
      // Not this line; the payload may sit above a trailing warning.
    }
  }
  throw new Error(`No JSON payload was found in the command output:\n${text}`)
}

// Probes are addressed by marker, so a PowerShell warning or a progress line can never be mistaken for
// the payload, and a pretty-printed object cannot be split across lines by accident.
export function extractProbePayload(text) {
  const line = String(text ?? '')
    .split(/\r?\n/)
    .find((entry) => entry.trimStart().startsWith(PROBE_PREFIX))
  if (line === undefined) {
    throw new Error(`No ${PROBE_PREFIX} payload was found in the probe output:\n${text}`)
  }
  return JSON.parse(line.trimStart().slice(PROBE_PREFIX.length))
}

// The host writes UTF-8 without a BOM, but PowerShell 5.1 writes UTF-8 *with* one and older cmdlets
// emit UTF-16LE, so the reader has to accept all three.
export function decodeGuestText(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.subarray(2).toString('utf16le')
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return buffer.subarray(3).toString('utf8')
  if (buffer.length >= 2 && buffer[1] === 0x00) return buffer.toString('utf16le')
  return buffer.toString('utf8')
}

export function parseConfig(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`The lab configuration is not valid JSON: ${error.message}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The lab configuration must be a JSON object')
  }
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !(key in value))
  if (missing.length > 0) {
    throw new Error(`The lab configuration is missing: ${missing.join(', ')}`)
  }
  return value
}

// Never rejects on a non-zero exit: every step judges the exit code itself, and a rejected promise here
// would turn an expected failure into an unhandled one.
export function runProcess(file, args = [], { input, timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        encoding: 'buffer'
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
          timedOut: Boolean(error?.killed),
          stdout: decodeGuestText(stdout ?? Buffer.alloc(0)),
          stderr: decodeGuestText(stderr ?? Buffer.alloc(0))
        })
      }
    )
    if (input !== undefined) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

// Writes the three files the host polls and collects. Every phase is published before it starts, so a
// run that dies still shows how far it got.
export class LabRun {
  constructor(resultsDir) {
    this.resultsDir = resultsDir
    mkdirSync(resultsDir, { recursive: true })
    this.logPath = join(resultsDir, 'lab-acceptance.log')
    this.progressPath = join(resultsDir, 'lab-progress.txt')
    this.resultsPath = join(resultsDir, 'lab-results.json')
    this.statusPath = join(resultsDir, 'lab-status.txt')
    this.results = {}
    writeFileSync(this.logPath, '')
    writeFileSync(this.progressPath, '')
    writeFileSync(this.resultsPath, '')
  }

  log(message) {
    appendFileSync(this.logPath, `${message}\n`)
  }

  phase(message) {
    const stamp = new Date().toISOString().slice(11, 19)
    appendFileSync(this.progressPath, `${stamp} ${message.replaceAll('|', '/')}\n`)
    this.log(`== ${message}`)
  }

  async step(name, body) {
    this.phase(name)
    try {
      const value = await body()
      this.results[name] = value === undefined ? { status: 'passed' } : { status: 'passed', value }
      return value
    } catch (error) {
      this.results[name] = { status: 'failed', error: String(error?.message ?? error) }
      throw error
    }
  }

  finish() {
    this.results.finishedAt = new Date().toISOString()
    writeFileSync(this.resultsPath, `${JSON.stringify(this.results, null, 2)}\n`)
  }

  status(value) {
    writeFileSync(this.statusPath, value)
  }
}

// Written before the configuration is read, using only literal paths, so a run that cannot start still
// explains what it was given. The PowerShell version printed `@{installer=...}` here once, which is what
// identified a variable-shadowing bug that had produced an unrelated null-argument error.
export function writeStartupRecord(resultsDir, configArgument) {
  mkdirSync(resultsDir, { recursive: true })
  const path = join(resultsDir, 'lab-startup.txt')
  const exists = Boolean(configArgument) && existsSync(configArgument)
  const lines = [
    `time=${new Date().toISOString()}`,
    `pid=${process.pid}`,
    `node=${process.version}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    `execPath=${process.execPath}`,
    `configArgument=${configArgument ?? ''}`,
    `configExists=${exists}`,
    `configBytes=${exists ? readFileSync(configArgument).length : 0}`,
    `cwd=${process.cwd()}`
  ]
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}

export function readArgument(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

export function ensureDirectory(path) {
  mkdirSync(dirname(path), { recursive: true })
}
