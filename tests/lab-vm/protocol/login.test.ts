/*
 * N2 in-container: no password from a non-loopback peer, and no loopback exemption from a forged
 * forwarding header (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The product treats a peer as loopback by comparing the socket address with an exact list. The
 * harness binds 127.0.0.1 so its other cases stay isolated, but production binds 0.0.0.0, so the
 * non-loopback case starts the same product HTTPS server on 0.0.0.0 over the same service and reaches
 * it through the container's routable address. That is the same code path the host takes in the VM
 * when it points the driver at the guest's LAN address.
 *
 * A local proof is spent on first use, granted or not, so each proof-bearing case gets its own proof;
 * the spec asserts both the full run and the honest skipping of cases that were left without one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:https'
import { networkInterfaces } from 'node:os'
import { createLabHttpServer } from '../../../packages/lab-server/src/http'
import { isRecord } from './context'
import { HARNESS_PASSWORD, startHarness, type Harness } from './harness'
import { login, type LoginCase, type LoginReport } from './commands/login'

let harness: Harness
let passwordFile: string
let lan: Server | undefined
let lanUrl: string | undefined

// The first non-internal IPv4 address is the one a remote peer can reach; Node already knows it.
function routableAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
}

async function listenOnAllInterfaces(): Promise<void> {
  const address = routableAddress()
  if (!address) return
  const server = createLabHttpServer(harness.service)
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const bound = server.address()
  if (typeof bound !== 'object' || !bound) throw new Error('the LAN listener did not bind a port')
  lan = server
  lanUrl = `https://${address}:${bound.port}/`
}

function report(value: unknown): LoginReport {
  if (!isRecord(value) || !isRecord(value.cases)) throw new Error('login did not report cases')
  return value as unknown as LoginReport
}

function caseOf(observed: LoginReport, name: string): LoginCase {
  const entry = observed.cases[name]
  if (!entry) throw new Error(`login did not report ${name}`)
  return entry
}

// A port that has just been released: nothing listens there, so the connection is refused immediately.
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve))
  const address = server.address()
  if (typeof address !== 'object' || !address) throw new Error('the probe server did not bind')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

beforeEach(async () => {
  harness = await startHarness()
  passwordFile = await harness.secret('password', HARNESS_PASSWORD)
  await listenOnAllInterfaces()
})

afterEach(async () => {
  lan?.closeAllConnections()
  if (lan) await new Promise<void>((resolve) => lan!.close(() => resolve()))
  lan = undefined
  lanUrl = undefined
  await harness.close()
})

describe('N2 login', () => {
  it('refuses a password-free session and skips the cases it has no credential for', async () => {
    const observed = report(await login(harness.args()))
    expect(caseOf(observed, 'noCredential')).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      tokenIssued: false
    })
    expect(caseOf(observed, 'password')).toEqual({ skipped: true })
    expect(caseOf(observed, 'localProof')).toEqual({ skipped: true })
    expect(observed.cases.lanNoCredential).toBeUndefined()
    expect(observed.notes?.length).toBeGreaterThan(0)
  })

  it('grants a session to the password and to a local proof from loopback only', async () => {
    const observed = report(
      await login(
        harness.args([
          '--password-file',
          passwordFile,
          '--local-proof-file',
          await harness.secret('proof-loopback', harness.service.security.issueLocalProof())
        ])
      )
    )
    expect(caseOf(observed, 'noCredential')).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
    expect(caseOf(observed, 'password')).toMatchObject({ status: 200, tokenIssued: true })
    // The control: the exemption still works where the product says it should.
    expect(caseOf(observed, 'localProof')).toMatchObject({ status: 200, tokenIssued: true })
    expect(caseOf(observed, 'password').code).toBeUndefined()
  })

  it('refuses a local proof and a forged forwarding header from a non-loopback address', async () => {
    if (!lanUrl) {
      // No routable address in this environment; the VM and host runs are where this leg has meaning.
      return
    }
    const observed = report(
      await login([
        ...harness.args(['--password-file', passwordFile]),
        '--local-proof-file',
        await harness.secret('proof-loopback', harness.service.security.issueLocalProof()),
        '--local-proof-file',
        await harness.secret('proof-lan', harness.service.security.issueLocalProof()),
        '--local-proof-file',
        await harness.secret('proof-forged', harness.service.security.issueLocalProof()),
        '--url-lan',
        lanUrl
      ])
    )
    expect(caseOf(observed, 'noCredential')).toMatchObject({ status: 401, code: 'AUTH_REQUIRED' })
    expect(caseOf(observed, 'password')).toMatchObject({ status: 200, tokenIssued: true })
    expect(caseOf(observed, 'localProof')).toMatchObject({ status: 200, tokenIssued: true })
    expect(caseOf(observed, 'lanNoCredential')).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      tokenIssued: false
    })
    // Each of these spent a proof that was valid when it was sent, so the refusal is about the source
    // address and not about a proof the service had already deleted.
    expect(caseOf(observed, 'lanLocalProof')).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      tokenIssued: false
    })
    expect(caseOf(observed, 'lanForgedForwardedFor')).toMatchObject({
      status: 401,
      code: 'AUTH_REQUIRED',
      tokenIssued: false
    })
    expect(observed.notes).toBeUndefined()
  })

  it('spends each local proof on one case and reports an unreachable target as a refusal', async () => {
    const address = routableAddress()
    if (!address) return
    const observed = report(
      await login([
        ...harness.args([
          '--local-proof-file',
          await harness.secret('proof-only', harness.service.security.issueLocalProof())
        ]),
        '--url-lan',
        `https://${address}:${await closedPort()}/`
      ])
    )
    expect(caseOf(observed, 'localProof')).toMatchObject({ status: 200, tokenIssued: true })
    // The one proof was spent by the loopback case, so the LAN proof cases are reported as skipped
    // rather than as refusals that would have happened with or without the boundary under test.
    expect(caseOf(observed, 'lanLocalProof')).toEqual({ skipped: true })
    expect(caseOf(observed, 'lanForgedForwardedFor')).toEqual({ skipped: true })
    // A connection that never completes is an observation too: the driver still finishes with a report.
    expect(caseOf(observed, 'lanNoCredential').refused).toBeTruthy()
    expect(caseOf(observed, 'lanNoCredential').status).toBeUndefined()
    expect(observed.notes?.length).toBeGreaterThan(0)
  })
})
