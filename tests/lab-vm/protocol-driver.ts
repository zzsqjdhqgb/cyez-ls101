/*
 * Lab protocol driver (docs/lab-vm-acceptance-design.md, milestone M2), driver B.
 *
 * Runs the real client stack — `PinnedTransport` plus `LabClient` — against a real service over real
 * HTTPS, either from inside the guest or from the host across the VM network. Each command prints one
 * JSON object describing what the service answered; the phase script in guest/lab-acceptance.mjs makes
 * every pass/fail judgement, so the assertions stay unit-testable without a VM.
 *
 * A command exits non-zero only when the driver itself could not complete: an unreadable file, an
 * unreachable service, a protocol shape the product transport rejects. A service *rejection* that a
 * case expects is part of the observation and is reported with exit code 0.
 *
 * Secrets are read from files and never printed, logged, or embedded in an error message.
 */
import { commands } from './protocol/index'
import { fail } from './protocol/context'

const [command, ...rest] = process.argv.slice(2)
if (!command) fail(`Usage: protocol-driver.mjs <${Object.keys(commands).join('|')}> [options]`)

const handler = commands[command]
if (!handler) fail(`Unknown command '${command}'`)

try {
  const result = await handler(rest)
  process.stdout.write(`${JSON.stringify(result ?? null)}\n`)
} catch (error) {
  fail((error as Error).message)
}
