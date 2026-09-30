/*
 * N12 in-container: the IPv6 boundaries of the deployment (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The join-file case runs against a real enrollment file issued by the service in `harness.ts` and then
 * rewritten to name an IPv6 address, so what the client parses is the service's own payload rather than
 * a fixture that agrees with the test. The readable-error requirement is asserted here as it is meant
 * in the phase step: a diagnosis naming what failed, not a stack trace and not a bare error code.
 *
 * The runtime-config refusal is the one boundary whose message is the bare code; the spec pins that
 * fact instead of pretending the layer is readable, so a later change to it shows up as a change.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { openTeacher, isRecord } from './context'
import { HARNESS_PASSWORD, startHarness, type Harness } from './harness'
import { ipv6, type Ipv6Report } from './commands/ipv6'
import type { Schema } from '../../../packages/lab-contracts/src'

let harness: Harness
let passwordFile: string

function report(value: unknown): Ipv6Report {
  if (!isRecord(value) || !isRecord(value.hosts) || !isRecord(value.joinFile))
    throw new Error('ipv6 did not report its boundaries')
  return value as unknown as Ipv6Report
}

// A real issued file, copied out of the transport's download directory: the case is about what the
// client does with the payload the service actually signs.
async function issuedEnrollmentFile(): Promise<string> {
  const session = await openTeacher(harness.args(['--password-file', passwordFile]), {
    passwordFile
  })
  try {
    const created = await session.client.request<Schema<'EnrollmentCreated'>>(
      'postTeacherEnrollments',
      {
        body: { expectedModeRevision: 1, validForSeconds: 600 },
        idempotencyKey: randomUUID()
      }
    )
    const archive = await session.client.request<{ handle: string }>(
      'getTeacherEnrollmentsIdFile',
      {
        path: { id: created.enrollment.id }
      }
    )
    const file = harness.path('issued.lsjoin')
    // An enrollment file is a credential as a whole file, so it is written the way the product writes
    // credentials rather than with the default mode.
    await writeFile(file, await readFile(session.transport.file(archive.handle)), { mode: 0o600 })
    return file
  } finally {
    await session.close()
  }
}

beforeEach(async () => {
  harness = await startHarness()
  passwordFile = await harness.secret('password', HARNESS_PASSWORD)
})

afterEach(async () => {
  await harness.close()
})

describe('N12 IPv6 boundaries', () => {
  it('accepts only the two IPv4 hosts the runtime can bind', async () => {
    const observed = report(await ipv6(harness.args()))
    expect(observed.hosts.zeroZeroZeroZero).toEqual({ accepted: true, message: null })
    expect(observed.hosts.loopback).toEqual({ accepted: true, message: null })
    expect(observed.hosts.ipv6Literal.accepted).toBe(false)
    // The closed set is enforced, but its refusal names the code rather than the host: the phase step
    // can assert only that a rejection happened at this layer.
    expect(observed.hosts.ipv6Literal.message).toBe('INVALID_REQUEST')
  })

  it('accepts a bracketed IPv6 target and rejects an unbracketed one', async () => {
    const observed = report(await ipv6(harness.args()))
    expect(observed.targets.bracketedIpv6).toEqual({ accepted: true, message: null })
    // Both ends accept it, which is why the address can reach a join file even though the runtime
    // itself could never have been configured to bind it.
    expect(observed.targets.serviceBracketedIpv6).toEqual({ accepted: true, message: null })
    expect(observed.targets.unbracketedIpv6.accepted).toBe(false)
    expect(observed.targets.unbracketedIpv6.message).toBeTruthy()
  })

  it('fails a join file naming an IPv6 address with a readable error', async () => {
    const enrollFile = await issuedEnrollmentFile()
    const observed = report(
      await ipv6(harness.args(['--enroll-file', enrollFile, '--password-file', passwordFile]))
    )
    // The file the driver was given names the service itself; only the driver's rewrite names IPv6, so
    // the observation below is about the address the payload carries and not about the fixture.
    const issued = await readFile(enrollFile, 'utf8')
    const payload = JSON.parse(
      Buffer.from(issued.trim().split('.')[1], 'base64url').toString('utf8')
    )
    expect(payload).toMatchObject({
      baseUrl: harness.baseUrl,
      publicKeyFingerprint: harness.fingerprint
    })
    const joined = observed.joinFile.bracketedIpv6
    expect(joined.accepted).toBe(false)
    expect(joined.message).toBeTruthy()
    // A diagnosis, not a crash report and not the bare code the runtime-config layer produces.
    expect(joined.message).not.toMatch(/\n\s+at /)
    expect(joined.message).not.toMatch(/^[A-Z][A-Z0-9_]*$/)
    // It names the address it tried, which is what makes the message actionable.
    expect(joined.message).toContain('::1')
    expect(observed.joinFile.unbracketedIpv6.accepted).toBe(false)
    // The file was issued by this service, and the service still advertises the address it was
    // reachable at; only the rewritten payload names IPv6.
    expect(observed.settings?.advertisedBaseUrl).toBe(harness.baseUrl)
  })

  it('synthesizes the join file when none was issued and says so', async () => {
    const observed = report(await ipv6(harness.args()))
    expect(observed.joinFile.bracketedIpv6.accepted).toBe(false)
    expect(observed.joinFile.unbracketedIpv6.accepted).toBe(false)
    expect(observed.settings).toBeUndefined()
    expect(observed.notes.join(' ')).toContain('synthesized')
    expect(observed.notes.join(' ')).toContain('BindingStore')
  })
})
