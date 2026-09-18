/*
 * Shared runtime for the lab protocol driver (docs/lab-vm-acceptance-design.md, milestone M2).
 *
 * The driver speaks the real protocol through the product's own `PinnedTransport` and `LabClient`, so
 * what is under test is the shipped pinning, header, archive and error-code behaviour rather than a
 * reimplementation of it. Requests the product transport refuses to make on purpose — the login
 * endpoint, and requests that must carry a forged header — go through `pinnedSocket`, the same
 * pin-before-anything primitive the transport itself uses.
 *
 * The driver only *observes*. Every command writes one JSON object to stdout describing what the
 * service answered; `guest/lab-acceptance.mjs` decides whether that is a pass. Keeping the judgements
 * in the phase script is what makes them reviewable and unit-testable without a VM.
 *
 * Secrets (management password, local proof, device credentials) travel through files, are read once
 * and are never printed, logged, or embedded in an error message.
 */
import { createHash, X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Agent, request as httpsRequest } from 'node:https'
import {
  pinnedSocket,
  PinnedTransport,
  type TrustedTarget
} from '../../../packages/lab-desktop-host/src/transport'
import { LabClient } from '../../../packages/lab-client/src'
import type { Schema } from '../../../packages/lab-contracts/src'

export function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

export function required(args: string[], name: string): string {
  const value = option(args, name)
  if (value === undefined) fail(`${name} is required`)
  return value
}

export function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

export function numberOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a positive number`)
  return value
}

// A secret is read from a file so it never reaches a command line, where any process on the machine
// could read it.
export async function secret(file: string): Promise<string> {
  const value = (await readFile(file, 'utf8')).trim()
  if (!value) fail(`${file} is empty`)
  return value
}

// Accepts any byte source: the archive encoders hand back a plain Uint8Array, while the transport and
// the filesystem hand back Buffers, and both have to hash the same way.
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isRecord(parsed)) fail(`${file} is not a JSON object`)
  return parsed as Record<string, unknown>
}

// Device identities have to survive between processes: the phase script starts one process per
// registration and one per heartbeat, which is the point of N3 and N11.
export async function writeState(file: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(file, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function readState(file: string): Promise<Record<string, unknown>> {
  return await readJsonFile(file)
}

// --- transport ---------------------------------------------------------------------------------

export interface Session {
  transport: PinnedTransport
  client: LabClient
  connectionId: string
  info: Schema<'Info'>
  target: TrustedTarget
  version: string
  directory: string
  close(): Promise<void>
}

export function targetFrom(args: string[]): TrustedTarget {
  const baseUrl = required(args, '--url')
  const fingerprint = required(args, '--fingerprint')
  const serverId = option(args, '--server-id')
  return serverId ? { baseUrl, fingerprint, serverId } : { baseUrl, fingerprint }
}

export function versionFrom(args: string[]): string {
  return required(args, '--version')
}

// Opens a pinned connection with the product transport. `role` decides which operations the client
// layer will allow; `token` is the session token for the two authenticated roles.
export async function openSession(
  args: string[],
  role: 'teacher' | 'student' | 'public',
  token?: string
): Promise<Session> {
  const target = targetFrom(args)
  const version = versionFrom(args)
  const directory = await mkdtemp(`${tmpdir()}/ls101-protocol-`)
  const transport = new PinnedTransport(directory, version)
  await transport.initialize()
  let opened: Awaited<ReturnType<PinnedTransport['open']>>
  try {
    opened = await transport.open(target, role, token)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return {
    transport,
    client: new LabClient(opened.connectionId, transport),
    connectionId: opened.connectionId,
    info: opened.info,
    target,
    version,
    directory,
    close: async () => {
      await transport.close(opened.connectionId)
      await rm(directory, { recursive: true, force: true })
    }
  }
}

// A teacher session needs a credential. The local proof is single use and expires 30 s after it is
// issued, which is why the phase script fetches one immediately before starting this driver.
export async function openTeacher(
  args: string[],
  credentials: { passwordFile?: string; localProofFile?: string }
): Promise<Session> {
  const session = await openSession(args, 'public')
  const password = credentials.passwordFile ? await secret(credentials.passwordFile) : undefined
  const localProof = credentials.localProofFile
    ? await secret(credentials.localProofFile)
    : undefined
  if (Boolean(password) === Boolean(localProof))
    fail('exactly one of --password-file and --local-proof-file is required')
  try {
    await session.transport.authenticate(session.connectionId, password, localProof)
  } catch (error) {
    await session.close()
    throw error
  }
  return session
}

export interface RawResult {
  status: number
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  text: string
  refused?: string
}

// Makes a request the product transport deliberately refuses to make: the login endpoint itself, and
// requests whose headers must be forged on purpose. The pin is still verified first, with the same
// primitive the transport uses, so a wrong pin cannot send anything.
export async function rawRequest(
  target: TrustedTarget,
  options: {
    method: string
    path: string
    version: string
    headers?: Record<string, string>
    body?: string
  }
): Promise<RawResult> {
  const origin = new URL(target.baseUrl).origin
  const socket = await pinnedSocket(target, undefined)
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = () => socket
  try {
    return await new Promise<RawResult>((resolve, reject) => {
      const call = httpsRequest(
        `${origin}${options.path}`,
        {
          method: options.method,
          agent,
          headers: {
            'X-LS101-Client-Version': options.version,
            ...(options.body === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': String(Buffer.byteLength(options.body))
                }),
            ...options.headers
          }
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let body: unknown
            try {
              body = text ? JSON.parse(text) : undefined
            } catch {
              body = undefined
            }
            const headers: Record<string, string | string[] | undefined> = {}
            for (const [key, value] of Object.entries(response.headers)) headers[key] = value
            resolve({ status: response.statusCode ?? 0, headers, body, text })
          })
        }
      )
      call.on('error', (error: Error) => reject(error))
      if (options.body !== undefined) call.write(options.body)
      call.end()
    })
  } finally {
    agent.destroy()
    socket.destroy()
  }
}

export function spkiOf(certificate: X509Certificate): string {
  return `sha256:${sha256Hex(certificate.publicKey.export({ type: 'spki', format: 'der' }))}`
}

// The error envelope is the only place the cause of a rejection is named, so every negative case
// reports it instead of just the status code.
// `null` rather than `undefined` for a missing code: every report in this driver carries the field, so
// a consumer can print `code ?? 'none'` without having to distinguish "absent" from "not reported".
// The service nests the diagnosis: `error.details.blockers` is where a refusal names the resources
// holding it. Reading `error.blockers` would always come back empty and silently turn every blocker
// assertion into a pass, so the details object is read first and also returned for cases that need
// more of it than the blocker list.
export function errorOf(result: { status: number; body?: unknown }): {
  status: number
  code: string | null
  message: string | null
  blockers: unknown[]
  details?: Record<string, unknown>
} {
  const body = result.body
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
  const details = isRecord(error?.details) ? error.details : undefined
  return {
    status: result.status,
    code: typeof error?.code === 'string' ? error.code : null,
    message: typeof error?.message === 'string' ? error.message : null,
    blockers: Array.isArray(details?.blockers) ? details.blockers : [],
    details
  }
}

export function report(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export type CommandHandler = (args: string[]) => Promise<unknown>

// Re-exported so a command module has one import site for the shared surface: the runtime helpers and
// the product types they hand back. Command modules are bundled together, so this costs nothing.
export type { TrustedTarget, Connection } from '../../../packages/lab-desktop-host/src/transport'
export type { OperationInput, TransportResponse } from '../../../packages/lab-client/src'
export type { OperationId, Schema } from '../../../packages/lab-contracts/src'
