/*
 * N2: a password-free session from a non-loopback source is refused, and a forged forwarding header
 * does not buy the loopback exemption (docs/lab-vm-acceptance-design.md §6, Tier 2).
 *
 * The login endpoint is the one request the product transport refuses to make — a session starts here,
 * it is not something a session does — so this command uses `rawRequest`, the same pin-before-anything
 * primitive the transport itself uses, with the pin still checked first.
 *
 * Where the case runs decides what its observations mean. In the guest `--url` is loopback, so
 * `localProof` is the *control* that the exemption works where it should, and `--url-lan` adds
 * best-effort evidence from the machine's own LAN address, which the deployment firewall may still
 * drop. On the host `--url` is already a remote peer, so `localProof` there is the refusal the case is
 * about. A connection failure is reported per case and never ends the run: an unreachable LAN address
 * is evidence about the firewall, not a broken driver.
 *
 * A local proof is single use and the service deletes it even when the request is refused, so every
 * proof-bearing case needs its own. `--local-proof-file` may therefore be repeated, one freshly issued
 * proof per case in the order the cases are reported; a case left without a fresh proof is reported as
 * skipped rather than as a refusal it did not earn.
 *
 * Secrets (management password, local proof, session token) are read from files, sent once, and never
 * printed or embedded in an error message: the report carries only status, error code and whether a
 * token came back.
 */
import {
  errorOf,
  fail,
  isRecord,
  option,
  rawRequest,
  required,
  secret,
  versionFrom,
  type CommandHandler,
  type RawResult
} from '../context'
import { API_PREFIX, operationDefinitions } from '../../../../packages/lab-contracts/src'
import type { TrustedTarget } from '../../../../packages/lab-desktop-host/src/transport'

// The route comes from the contract rather than from this file, so a path change cannot leave the case
// observing a 404 while still passing.
const SESSION_PATH = `${API_PREFIX}${operationDefinitions.postTeacherSessions.route}`

const FORWARDING_HEADERS: Record<string, string> = {
  'X-Forwarded-For': '127.0.0.1',
  'X-Real-IP': '127.0.0.1',
  Forwarded: 'for=127.0.0.1'
}

export interface LoginCase {
  status?: number
  code?: string
  tokenIssued?: boolean
  // The transport could not complete the request at all: closed firewall, stopped service, wrong pin.
  refused?: string
  skipped?: true
}

export interface LoginReport {
  cases: Record<string, LoginCase>
  // Why a case carries no observation, in prose the phase log can quote.
  notes?: string[]
}

function observe(result: RawResult): LoginCase {
  const failure = errorOf(result)
  const body = result.body
  return {
    status: failure.status,
    ...(failure.code ? { code: failure.code } : {}),
    // Only the presence of a token is reported; its value never leaves this process.
    tokenIssued: isRecord(body) && typeof body.token === 'string' && body.token.length > 0
  }
}

async function post(
  target: TrustedTarget,
  version: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<LoginCase> {
  try {
    return observe(
      await rawRequest(target, { method: 'POST', path: SESSION_PATH, version, body, headers })
    )
  } catch (error) {
    return { refused: (error as Error).message }
  }
}

// Every occurrence, not just the first: the service spends the proof whether or not it grants the
// session, so one proof can carry exactly one case.
function proofFiles(args: string[]): string[] {
  const files: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--local-proof-file') continue
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) fail('--local-proof-file requires a value')
    files.push(value)
    index++
  }
  return files
}

export const login: CommandHandler = async (args): Promise<LoginReport> => {
  const version = versionFrom(args)
  const fingerprint = required(args, '--fingerprint')
  const target: TrustedTarget = { baseUrl: required(args, '--url'), fingerprint }
  const lanUrl = option(args, '--url-lan')
  const passwordFile = option(args, '--password-file')
  const password = passwordFile ? await secret(passwordFile) : undefined
  const proofs = await Promise.all(proofFiles(args).map((file) => secret(file)))
  const notes: string[] = []
  let spent = 0

  const nextProof = (): string | undefined => {
    while (spent < proofs.length) {
      const proof = proofs[spent++]
      // The same file passed twice holds a proof the service has already deleted. Reporting the
      // refusal it would produce would credit the wrong boundary, so it is not used at all.
      if (proofs.slice(0, spent - 1).includes(proof)) {
        notes.push('a repeated --local-proof-file was ignored: a local proof is spent on first use')
        continue
      }
      return proof
    }
    return undefined
  }

  const proofCase = async (baseUrl: string, name: string, forged: boolean): Promise<LoginCase> => {
    const proof = nextProof()
    if (proof === undefined) {
      notes.push(`${name} was not exercised: no unused --local-proof-file was supplied`)
      return { skipped: true }
    }
    return await post({ baseUrl, fingerprint }, version, '{}', {
      'X-LS101-Local-Authorization': proof,
      ...(forged ? FORWARDING_HEADERS : {})
    })
  }

  const cases: Record<string, LoginCase> = {
    noCredential: await post(target, version, '{}'),
    password:
      password === undefined
        ? { skipped: true }
        : await post(target, version, JSON.stringify({ password })),
    localProof: await proofCase(target.baseUrl, 'cases.localProof', false)
  }
  if (lanUrl !== undefined) {
    // The same service through the machine's own routable address: a genuinely non-loopback peer if
    // the deployment firewall lets the connection through at all.
    cases.lanNoCredential = await post({ baseUrl: lanUrl, fingerprint }, version, '{}')
    cases.lanLocalProof = await proofCase(lanUrl, 'cases.lanLocalProof', false)
    cases.lanForgedForwardedFor = await proofCase(lanUrl, 'cases.lanForgedForwardedFor', true)
  }
  return notes.length ? { cases, notes } : { cases }
}
