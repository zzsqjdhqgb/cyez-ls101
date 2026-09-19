/*
 * Guest-side driver for the lab VM acceptance run (docs/lab-vm-acceptance-design.md, milestone M1).
 *
 * It plays the role the teacher main process plays in production: it owns the control channel, spawns
 * the packaged elevated helper `manager.cjs`, and answers exactly one `request` and one `complete`.
 * The channel protocol itself is imported from the product rather than reimplemented, so the wire
 * format cannot drift. See apps/lab-teacher/main/local-service.ts for the production parent.
 *
 * Two further probes live here because they need a real TLS stack and no product code:
 *   pipe-name   derives the service control-pipe name from the product's own controlPath()
 *   verify-tls  connects, recomputes the SPKI fingerprint, and optionally fetches /api/v1/info
 *
 * Secrets (the invitation code and the management password) arrive through files and travel only
 * inside the encrypted channel. They are never printed, logged, or embedded in an error message.
 */
import { randomBytes, createHash, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { connect } from 'node:tls'
import { Agent, request as httpsRequest } from 'node:https'
import { controlPath, listenLocalControl } from '../../packages/lab-server/src/control'
import { PROBE_PATH, buildProbeHeaders } from './probe-headers.mjs'

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    fail(`${file} is not a JSON object`)
  return parsed as Record<string, unknown>
}

function spkiFingerprint(certificate: X509Certificate): string {
  return `sha256:${createHash('sha256')
    .update(certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex')}`
}

// --- pipe-name ---------------------------------------------------------------------------------

function pipeName(args: string[]): void {
  if (process.platform !== 'win32') fail('pipe-name is only meaningful on Windows')
  const root = option(args, '--root')
  if (!root) fail('pipe-name requires --root <data directory>')
  const path = controlPath(root!)
  // PowerShell needs the bare name for NamedPipeClientStream, not the \\.\pipe\ device path.
  process.stdout.write(`${path.replace(/^\\\\\.\\pipe\\/, '')}\n`)
}

// --- verify-tls --------------------------------------------------------------------------------

interface ProbeResult {
  fingerprint: string
  serverId?: string
  releaseVersion?: string
  statusCode?: number
  errorCode?: string
  errorMessage?: string
}

// Resolves with the observed identity, or rejects with the reason. `--expect-connect-failure` turns
// both outcomes into an exit code so PowerShell can assert a refusal without parsing messages.
function probeTls(
  url: string,
  fingerprint: string,
  { caVerify, withRequest, version }: { caVerify: boolean; withRequest: boolean; version: string }
): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const pinned = target.pathname
    if (pinned !== '/' && pinned !== '') return reject(new Error('URL must have an empty path'))
    const socket = connect({
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: Number(target.port || 443),
      rejectUnauthorized: caVerify,
      minVersion: 'TLSv1.2'
    })
    socket.setTimeout(10000, () => socket.destroy(new Error('TLS connection timed out')))
    socket.once('error', reject)
    socket.once('secureConnect', () => {
      let observed: string
      try {
        const peer = socket.getPeerCertificate()
        if (!peer.raw) throw new Error('Service certificate missing')
        const certificate = new X509Certificate(peer.raw)
        observed = spkiFingerprint(certificate)
        if (
          Date.parse(certificate.validTo) < Date.now() ||
          Date.parse(certificate.validFrom) > Date.now()
        )
          throw new Error('Service certificate expired or not yet valid')
      } catch (error) {
        socket.destroy()
        reject(error as Error)
        return
      }
      // The pin is checked before any request exists, so a wrong pin never sends credentials.
      if (observed !== fingerprint) {
        socket.destroy()
        reject(new Error('Service public key changed'))
        return
      }
      socket.setTimeout(0)
      if (!withRequest) {
        socket.destroy()
        resolve({ fingerprint: observed })
        return
      }
      // The already-pinned socket is handed to a one-shot agent, mirroring the product transport:
      // no second connection is opened, so the request cannot bypass the pin check above.
      const agent = new Agent({ keepAlive: false })
      agent.createConnection = () => socket
      const request = httpsRequest(
        `${target.origin}${PROBE_PATH}`,
        { method: 'GET', headers: buildProbeHeaders(version), agent },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8')
            let parsed: Record<string, unknown> = {}
            try {
              parsed = JSON.parse(body) as Record<string, unknown>
            } catch {
              parsed = {}
            }
            // The rejection reason travels with the result. A bare status code once cost a full VM rebuild
            // to explain, because the service's own error envelope is where the cause lives.
            const error = (parsed.error ?? {}) as Record<string, unknown>
            resolve({
              fingerprint: observed,
              statusCode: response.statusCode,
              serverId: typeof parsed.serverId === 'string' ? parsed.serverId : undefined,
              releaseVersion:
                typeof parsed.releaseVersion === 'string' ? parsed.releaseVersion : undefined,
              errorCode: typeof error.code === 'string' ? error.code : undefined,
              errorMessage: typeof error.message === 'string' ? error.message : undefined
            })
          })
        }
      )
      request.on('error', reject)
      request.end()
    })
  })
}

async function verifyTls(args: string[]): Promise<void> {
  const url = option(args, '--url')
  const fingerprint = option(args, '--fingerprint')
  const version = option(args, '--version')
  if (!url || !fingerprint) fail('verify-tls requires --url and --fingerprint')
  // Required rather than optional: every operation declares this header, and omitting it is answered
  // with 400 rather than with a hint.
  if (!version)
    fail('verify-tls requires --version, the client version the contract expects on every request')
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint!)) fail('--fingerprint must be sha256:<64 hex>')
  const expectFailure = args.includes('--expect-connect-failure')
  const caVerify = args.includes('--ca-verify')
  try {
    const result = await probeTls(url!, fingerprint!, {
      caVerify,
      withRequest: !caVerify,
      version: version!
    })
    if (expectFailure) fail('the connection succeeded but a refusal was required')
    // A non-200 is reported with the service's own error code and message instead of the status alone.
    if (result.statusCode !== 200) {
      const detail = [result.errorCode, result.errorMessage].filter(Boolean).join(': ')
      fail(`the service answered ${result.statusCode}${detail ? ` (${detail})` : ''}`)
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    if (expectFailure) {
      process.stdout.write(`${JSON.stringify({ refused: (error as Error).message })}\n`)
      return
    }
    fail((error as Error).message)
  }
}

// --- prepare-install ---------------------------------------------------------------------------
//
// The second entry point of the same `manager.cjs`: no channel, no parent process, and the answer is
// the process exit code. `install-windows.ps1` runs exactly this before it touches the installed
// program directory, so a version-change install whose durable preparation is missing stops with this
// exit code instead of replacing the runtime under a running service. Milestone M4 has to observe that
// decision, which is why the driver runs the command rather than reimplementing it.
//
// stdout and stderr are returned verbatim: on failure `manager-cli.ts` writes the code/detail envelope
// to stderr, and that envelope is the only place the refusal names itself.
function prepareInstall(runtime: string, timeoutMs: number): void {
  const executable = join(runtime, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  const child = spawnSync(executable, [join(runtime, 'manager.cjs'), '--prepare-install'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  })
  process.stdout.write(
    `${JSON.stringify({
      exitCode: child.status,
      signal: child.signal ?? null,
      timedOut: Boolean(
        child.error && (child.error as { code?: string }).code === 'ETIMEDOUT'
      ),
      stdout: (child.stdout ?? '').trim(),
      stderr: (child.stderr ?? '').trim(),
      error: child.error ? String(child.error.message ?? child.error) : null
    })}\n`
  )
}

// --- manage ------------------------------------------------------------------------------------

interface HelperResult {
  ok: boolean
  value?: unknown
  error?: string
  detail?: string
}

function runHelper(
  runtime: string,
  manager: string,
  channel: string,
  timeoutMs: number
): Promise<{ code: number | null }> {
  const executable = join(runtime, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  return new Promise((resolve) => {
    const child = spawn(executable, [manager, '--channel', channel], {
      stdio: 'ignore',
      shell: false
    })
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: null })
    }, timeoutMs)
    child.once('error', () => {
      clearTimeout(timer)
      resolve({ code: null })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code })
    })
  })
}

async function manage(args: string[]): Promise<void> {
  const manager = option(args, '--manager')
  const runtime = option(args, '--runtime')
  const operation = option(args, '--operation')
  const resultFile = option(args, '--result')
  const inputFile = option(args, '--input-file')
  const passwordFile = option(args, '--password-file')
  const activationFile = option(args, '--activation-file')
  const timeoutMs = Number(option(args, '--timeout-ms') ?? 120000)
  if (!manager || !runtime || !operation || !resultFile)
    fail('manage requires --manager, --runtime, --operation and --result')

  // The control channel distinguishes "no input" from "an empty object": the runtime requires
  // `input === undefined` for the parameterless operations (status, connection, shutdown, cancel-stop,
  // prepare-stop) and validates the object for the rest. The teacher main process forwards whatever the
  // caller passed, so a driver that always sends `{}` cannot reach `connection` at all — which is
  // exactly what the first milestone-M2 run found.
  const noInput = args.includes('--input-none')
  if (noInput && (inputFile || passwordFile || activationFile))
    fail('--input-none cannot be combined with an input file')
  const input: Record<string, unknown> | undefined = noInput
    ? undefined
    : inputFile
      ? await readJson(inputFile)
      : {}
  if (input) {
    if (passwordFile) input.password = (await readFile(passwordFile, 'utf8')).trim()
    if (activationFile) input.activationCode = (await readFile(activationFile, 'utf8')).trim()
  }

  const channel = await mkdtemp(join(tmpdir(), 'ls101-manager-'))
  let listener: Awaited<ReturnType<typeof listenLocalControl>> | undefined
  let result: HelperResult | undefined
  let requested = false
  try {
    const key = randomBytes(32)
    await writeFile(join(channel, 'control.key'), key, { mode: 0o600, flag: 'wx', flush: true })
    listener = await listenLocalControl(channel, key, async (method, value) => {
      if (method === 'request' && !requested && value === undefined) {
        requested = true
        return { operation, input }
      }
      if (
        method === 'complete' &&
        requested &&
        !result &&
        value &&
        typeof value === 'object' &&
        typeof (value as { ok?: unknown }).ok === 'boolean'
      ) {
        result = value as HelperResult
        return null
      }
      throw new Error('INVALID_REQUEST')
    })
    const outcome = await runHelper(runtime!, manager!, channel, timeoutMs)
    if (outcome.code === null) fail('LOCAL_HELPER_INCOMPLETE')
    if (!result) fail('LOCAL_HELPER_INCOMPLETE')
    const helperResult: HelperResult = result!
    await writeFile(resultFile!, `${JSON.stringify(helperResult)}\n`, 'utf8')
    if (!helperResult.ok) {
      // Only the code and, for install/upgrade, the bounded installer detail. Never the input.
      const code =
        helperResult.error && /^[A-Z_]+$/.test(helperResult.error)
          ? helperResult.error
          : 'LOCAL_OPERATION_FAILED'
      const detail =
        ['install', 'upgrade'].includes(operation!) && typeof helperResult.detail === 'string'
          ? helperResult.detail.slice(0, 8192).trim()
          : ''
      // `--raw` turns the refusal into the command's result instead of its exit status. M4 needs to
      // read the refusal *code* (uninstall must be RESOURCE_BUSY while the service runs), and a code
      // carried in an exit status would have to be parsed back out of a message.
      if (args.includes('--raw')) {
        process.stdout.write(`${JSON.stringify(helperResult)}\n`)
        return
      }
      fail(detail ? `${code}\n${detail}` : code)
    } else if (args.includes('--raw')) {
      process.stdout.write(`${JSON.stringify(helperResult)}\n`)
    }
  } finally {
    try {
      await listener?.close()
    } finally {
      await rm(channel, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

// --- entry -------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2)
if (command === 'pipe-name') pipeName(rest)
else if (command === 'verify-tls') await verifyTls(rest)
else if (command === 'prepare-install') {
  const runtime = option(rest, '--runtime')
  if (!runtime) fail('prepare-install requires --runtime <installed or unpacked runtime directory>')
  prepareInstall(runtime!, Number(option(rest, '--timeout-ms') ?? 180000))
} else if (command === 'manage') await manage(rest)
else
  fail(
    'Usage: manager-driver.mjs pipe-name|verify-tls|prepare-install|manage [options]'
  )
