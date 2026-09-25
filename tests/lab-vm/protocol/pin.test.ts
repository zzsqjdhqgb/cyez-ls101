/*
 * N1 in-container: a wrong pin is refused after the TLS connection and before any HTTP request
 * (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The double's counters are the only place the claim is observable, and `connections` is the counter
 * that is not a race: the client destroys the socket as soon as it has read the certificate, so the
 * server may or may not reach `secureConnection`. `handshakes` is therefore asserted only for shape.
 *
 * The second case repeats the command against the real service from `harness.ts` — the positive path
 * the VM step needs before it can trust the double's negative one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isRecord } from './context'
import { startHarness, type Harness } from './harness'
import { pin, type PinReport } from './commands/pin'

let harness: Harness

beforeEach(async () => {
  harness = await startHarness()
})

afterEach(async () => {
  await harness.close()
})

// The driver's own report, narrowed once so the assertions read as the case they check. A handler that
// printed a different shape must fail the spec instead of being tolerated by optional chaining.
function report(value: unknown): PinReport {
  if (!isRecord(value) || !isRecord(value.double) || !isRecord(value.double.rightPin))
    throw new Error('pin did not report a double')
  return value as unknown as PinReport
}

describe('N1 pin', () => {
  it('refuses a wrong pin with no HTTP request on the connection it accepted', async () => {
    const observed = report(await pin(['--version', harness.version]))
    expect(observed.double.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(observed.double.rightPin).toMatchObject({ opened: true })
    expect(observed.double.rightPin.serverId).toBeTruthy()
    expect(observed.double.wrongPin.refused).toBe(true)
    expect(observed.double.wrongPin.message).toBeTruthy()
    // A TCP connection really was made, so the refusal is not "nothing was listening".
    expect(observed.double.connections).toBeGreaterThanOrEqual(1)
    // Nothing reached the HTTP layer: no request line, no headers, no body.
    expect(observed.double.requests).toBe(0)
    expect(observed.double.requestBytes).toBe(0)
    expect(observed.double.handshakes).toBeGreaterThanOrEqual(0)
    expect(observed.real).toBeUndefined()
  })

  it('opens the real service with its own fingerprint and still refuses a wrong one', async () => {
    const observed = report(await pin(harness.args(['--wrong-pin'])))
    expect(observed.real).toMatchObject({
      opened: true,
      serverId: harness.serverId,
      releaseVersion: harness.version
    })
    expect(observed.real?.wrongPin?.refused).toBe(true)
    expect(observed.real?.wrongPin?.message).toBeTruthy()
    // The double's own verdict does not depend on the service being exercised alongside it.
    expect(observed.double.wrongPin.refused).toBe(true)
    expect(observed.double.requests).toBe(0)
    expect(observed.double.requestBytes).toBe(0)
  })
})
