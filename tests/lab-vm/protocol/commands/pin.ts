/*
 * N1: a wrong pin must be refused before any HTTP request or credential exists
 * (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The service under test cannot show that. It only ever sees the requests that arrive, never the ones
 * the client refused to write, so the local TLS double counts accepted TCP connections, completed
 * handshakes and decoded HTTP requests, and the product transport is pointed at it twice: once with
 * the double's own fingerprint, once with a well-formed pin that cannot match. Accepted connections
 * plus zero requests is the whole claim — the refusal happened after TLS was up and before anything
 * was sent, which is where credentials would have gone out.
 *
 * The same command carries the positive path for the service under test: with `--url` and
 * `--fingerprint` the transport must open the real service, and that failure is not an observation —
 * there is no result worth judging if the driver cannot reach the service at all, so it throws.
 * `--wrong-pin` adds the negative attempt against the real service as well, reported alongside.
 */
import { startTlsDouble, type TlsDouble } from '../tls-double'
import {
  fail,
  flag,
  openSession,
  option,
  versionFrom,
  type CommandHandler,
  type Session
} from '../context'

// Well formed on purpose: the refusal must come from the fingerprint comparison, not from the target
// validation that runs before a socket is opened.
const WRONG_PIN = `sha256:${'0'.repeat(64)}`

export interface PinAttempt {
  opened?: true
  serverId?: string
  refused?: true
  // The transport's own words. It names the mismatch, never a certificate, key or credential.
  message?: string
}

export interface PinReport {
  double: {
    fingerprint: string
    rightPin: PinAttempt
    wrongPin: PinAttempt
    // Counters observed across the refused attempt. `connections` is the deterministic one: a client
    // that rejects the pin destroys the socket right after its own handshake flight, so whether the
    // server also got as far as emitting `secureConnection` is a race and `handshakes` is reported as
    // information only.
    connections: number
    handshakes: number
    requests: number
    requestBytes: number
  }
  // Present when the command was given a real service to open, or a real service to refuse.
  real?: {
    opened?: true
    serverId?: string
    releaseVersion?: string
    wrongPin?: PinAttempt
  }
}

interface Counters {
  connections: number
  handshakes: number
  requests: number
  requestBytes: number
}

function counters(double: TlsDouble): Counters {
  return {
    connections: double.connections,
    handshakes: double.handshakes,
    requests: double.requests,
    requestBytes: double.requestBytes
  }
}

// The double runs on this event loop, so its accept callback can still be pending when the client has
// already rejected the peer. Yielding once lets it run before the counters are sampled, which keeps
// them attributable to the refused attempt rather than to the successful one that follows.
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function openAgainst(baseUrl: string, fingerprint: string, version: string): Promise<Session> {
  return openSession(
    ['--url', baseUrl, '--fingerprint', fingerprint, '--version', version],
    'public'
  )
}

// A refusal is an observation and a success is an observation; neither is a verdict, so both are
// reported and only the caller of a *correct* pin is allowed to fail the driver.
async function attempt(baseUrl: string, fingerprint: string, version: string): Promise<PinAttempt> {
  let session: Session
  try {
    session = await openAgainst(baseUrl, fingerprint, version)
  } catch (error) {
    return { refused: true, message: (error as Error).message }
  }
  try {
    return { opened: true, serverId: session.info.serverId }
  } finally {
    await session.close()
  }
}

export const pin: CommandHandler = async (args): Promise<PinReport> => {
  const version = versionFrom(args)
  const url = option(args, '--url')
  const fingerprint = option(args, '--fingerprint')
  const probeWrongPin = flag(args, '--wrong-pin')
  // An address alone is enough for the negative probe; the positive path needs the real fingerprint.
  if (url && !fingerprint && !probeWrongPin) fail('--fingerprint is required with --url')
  if (fingerprint && !url) fail('--url is required with --fingerprint')
  const real: NonNullable<PinReport['real']> = {}

  const double = await startTlsDouble()
  try {
    // Wrong pin first: the counters sampled below then describe the refused attempt alone.
    const before = counters(double)
    const wrongPin = await attempt(double.baseUrl, WRONG_PIN, version)
    await settle()
    const after = counters(double)
    const rightPin = await attempt(double.baseUrl, double.fingerprint, version)
    if (rightPin.refused)
      throw new Error(`the double was refused with its own fingerprint: ${rightPin.message}`)

    if (url && fingerprint) {
      const session = await openAgainst(url, fingerprint, version)
      try {
        real.opened = true
        real.serverId = session.info.serverId
        real.releaseVersion = session.info.releaseVersion
      } finally {
        await session.close()
      }
    }
    if (url && probeWrongPin) real.wrongPin = await attempt(url, WRONG_PIN, version)

    const report: PinReport = {
      double: {
        fingerprint: double.fingerprint,
        rightPin,
        wrongPin,
        connections: after.connections - before.connections,
        handshakes: after.handshakes - before.handshakes,
        requests: after.requests - before.requests,
        requestBytes: after.requestBytes - before.requestBytes
      }
    }
    if (Object.keys(real).length) report.real = real
    return report
  } finally {
    await double.close()
  }
}
