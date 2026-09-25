/*
 * N12: the IPv6 boundaries of the deployment (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * Three boundaries are pinned here, and only the ones that can be reached from a driver with no
 * Electron, no IPv6 listener and no business rewriting the service's advertised address:
 *
 *   hosts    `RuntimeConfig.host` is a closed set of two IPv4 literals, so a deployment cannot ask the
 *            service to bind IPv6 at all. Its refusal carries the bare error code as its message, which
 *            is why the readable diagnosis has to come from the caller — reported, not asserted on.
 *   targets  Both ends accept a bracketed IPv6 literal, and the client strips the brackets before it
 *            connects. An unbracketed one is rejected by the URL parser, which is the only place the
 *            failure is named at all.
 *   joinFile The student client reads a `.lsjoin` by splitting it into three parts and verifying the
 *            fingerprint inside it, then connects to the address the payload names *before* it verifies
 *            the signature. A file naming an IPv6 address therefore has to fail with a diagnosis rather
 *            than a stack trace, because that message is all the operator sees.
 *
 * The enrollment path is exercised through `BindingStore.enroll` with the same file contents the
 * Electron main process passes it; the renderer and main wiring that reads the file off disk lives
 * inside the packaged app and is out of reach from here, which the report says in `notes`.
 */
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BindingStore } from '../../../../packages/lab-desktop-host/src/binding'
import {
  PinnedTransport,
  validateTarget
} from '../../../../packages/lab-desktop-host/src/transport'
import { validateRuntimeConfig } from '../../../../packages/lab-server/src/runtime-config'
import { LabService } from '../../../../packages/lab-server/src/service'
import {
  errorOf,
  isRecord,
  option,
  rawRequest,
  required,
  secret,
  versionFrom,
  type CommandHandler
} from '../context'
import { API_PREFIX, operationDefinitions } from '../../../../packages/lab-contracts/src'
import type { TrustedTarget } from '../../../../packages/lab-desktop-host/src/transport'

// The documented default port: the boundary is about the host, so the value only has to be a valid one.
const CONFIG_PORT = 8443
const SERVER_ID = '00000000-0000-4000-8000-000000000000'
const UNREACHABLE_V6 = '[::1]'

export interface Boundary {
  accepted: boolean
  // The product's own words when it refused, null when it accepted. Never a value derived here.
  message: string | null
}

export interface Ipv6Report {
  hosts: { zeroZeroZeroZero: Boundary; loopback: Boundary; ipv6Literal: Boundary }
  targets: { bracketedIpv6: Boundary; unbracketedIpv6: Boundary; serviceBracketedIpv6: Boundary }
  joinFile: { bracketedIpv6: Boundary; unbracketedIpv6: Boundary }
  // Read from the service itself when a password was supplied: the address every issued `.lsjoin`
  // embeds verbatim, which is what makes a rewritten file a faithful stand-in for an issued one.
  settings?: { advertisedBaseUrl?: string; refused?: string }
  notes: string[]
}

interface EnrollmentPayload extends Record<string, unknown> {
  formatVersion: number
  purpose: string
  baseUrl: string
  publicKeyFingerprint: string
}

function boundary(run: () => void): Boundary {
  try {
    run()
    return { accepted: true, message: null }
  } catch (error) {
    return { accepted: false, message: (error as Error).message }
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

// A compact JWS is three dot-separated parts and the client reaches the connect before it looks at the
// signature, so rewriting the payload keeps the file on exactly the code path an issued one takes.
function rename(file: string, baseUrl: string): string {
  const parts = file.trim().split('.')
  if (parts.length !== 3) throw new Error('--enroll-file is not an enrollment file')
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
  if (!isRecord(payload) || typeof payload.baseUrl !== 'string')
    throw new Error('--enroll-file carries no enrollment payload')
  return `${parts[0]}.${encodeJson({ ...payload, baseUrl })}.${parts[2]}`
}

function synthesize(fingerprint: string, baseUrl: string): string {
  return `${encodeJson({ alg: 'ES256', typ: 'ls101-device-enrollment+jws', kid: fingerprint })}.${encodeJson(
    {
      formatVersion: 1,
      purpose: 'ls101-device-enrollment',
      baseUrl,
      publicKeyFingerprint: fingerprint,
      serverId: SERVER_ID,
      enrollmentId: randomUUID()
    } satisfies EnrollmentPayload
  )}.`
}

async function enroll(file: string, fingerprint: string, version: string): Promise<Boundary> {
  const root = await mkdtemp(join(tmpdir(), 'ls101-ipv6-'))
  const transport = new PinnedTransport(root, version)
  await transport.initialize()
  try {
    await new BindingStore(root, transport).enroll(file, fingerprint)
    return { accepted: true, message: null }
  } catch (error) {
    return { accepted: false, message: (error as Error).message }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

// Read-only: the address the service advertises is what its next enrollment file will name. It is not
// rewritten here, because every later case in the run depends on it still being reachable.
async function advertisedBaseUrl(
  target: TrustedTarget,
  version: string,
  password: string
): Promise<string> {
  const session = await rawRequest(target, {
    method: 'POST',
    path: `${API_PREFIX}${operationDefinitions.postTeacherSessions.route}`,
    version,
    body: JSON.stringify({ password })
  })
  if (session.status !== 200 || !isRecord(session.body) || typeof session.body.token !== 'string')
    throw new Error(`teacher login failed: ${errorOf(session).code ?? session.status}`)
  const settings = await rawRequest(target, {
    method: 'GET',
    path: `${API_PREFIX}${operationDefinitions.getTeacherSettings.route}`,
    version,
    headers: { Authorization: `Bearer ${session.body.token}` }
  })
  if (
    settings.status !== 200 ||
    !isRecord(settings.body) ||
    typeof settings.body.baseUrl !== 'string'
  )
    throw new Error(`teacher settings failed: ${errorOf(settings).code ?? settings.status}`)
  return settings.body.baseUrl
}

export const ipv6: CommandHandler = async (args): Promise<Ipv6Report> => {
  const version = versionFrom(args)
  const fingerprint = required(args, '--fingerprint')
  const url = required(args, '--url')
  const notes: string[] = []
  // A loopback literal keeps the case fast and deterministic: the failure under test is how the client
  // handles a bracketed IPv6 address, not whether some IPv6 peer answers.
  const port = new URL(url).port || '443'
  const bracketed = `https://${UNREACHABLE_V6}:${port}/`
  const unbracketed = `https://::1:${port}/`

  const hosts = {
    zeroZeroZeroZero: boundary(() =>
      validateRuntimeConfig({ schemaVersion: 1, port: CONFIG_PORT, host: '0.0.0.0' })
    ),
    loopback: boundary(() =>
      validateRuntimeConfig({ schemaVersion: 1, port: CONFIG_PORT, host: '127.0.0.1' })
    ),
    ipv6Literal: boundary(() =>
      validateRuntimeConfig({ schemaVersion: 1, port: CONFIG_PORT, host: '::1' })
    )
  }
  if (hosts.ipv6Literal.message === 'INVALID_REQUEST')
    notes.push(
      'the runtime config refusal is the bare code, so an IPv6 host has no readable diagnosis at this layer'
    )

  const targets = {
    bracketedIpv6: boundary(() => validateTarget({ baseUrl: bracketed, fingerprint })),
    unbracketedIpv6: boundary(() => validateTarget({ baseUrl: unbracketed, fingerprint })),
    // The server side of the same boundary: an operator can advertise an address the runtime could
    // never have been configured to bind.
    serviceBracketedIpv6: boundary(() => LabService.validateBaseUrl(bracketed))
  }

  const source = option(args, '--enroll-file')
  let template: string
  if (source === undefined) {
    notes.push('joinFile used a synthesized payload: no --enroll-file was supplied')
    template = synthesize(fingerprint, bracketed)
  } else {
    template = await readFile(source, 'utf8')
  }
  const joinFile = {
    bracketedIpv6: await enroll(rename(template, bracketed), fingerprint, version),
    unbracketedIpv6: await enroll(rename(template, unbracketed), fingerprint, version)
  }
  notes.push(
    'no Electron process reads the .lsjoin off disk here: its contents go straight to BindingStore.enroll'
  )

  const report: Ipv6Report = { hosts, targets, joinFile, notes }
  const passwordFile = option(args, '--password-file')
  if (passwordFile !== undefined) {
    const password = await secret(passwordFile)
    try {
      report.settings = {
        advertisedBaseUrl: await advertisedBaseUrl({ baseUrl: url, fingerprint }, version, password)
      }
    } catch (error) {
      // Auxiliary evidence, so a service that refuses the credential must not cost the three boundary
      // observations above; the refusal is reported instead.
      report.settings = { refused: (error as Error).message }
    }
  }
  return report
}
