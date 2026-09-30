/*
 * In-container harness for the lab protocol driver.
 *
 * The driver's commands are exercised against the *real* service — `LabService` plus the same HTTP
 * server the packaged runtime starts — over real TLS on loopback. That covers everything about the
 * protocol except the parts that only exist on a target machine: the packaged bundle, the Windows
 * service identity, the VM network and the firewall. Those stay with `yarn vm:lab`.
 *
 * The clock is injected, so the cases that depend on time (heartbeat expiry, lease windows) can be
 * asserted in milliseconds here and in real seconds in the VM.
 */
import type { Server } from 'node:https'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LabService } from '../../../packages/lab-server/src/service'
import { createLabHttpServer } from '../../../packages/lab-server/src/http'

export const HARNESS_VERSION = '0.4.1'
export const HARNESS_PASSWORD = 'harness-password'

export interface Harness {
  service: LabService
  server: Server
  baseUrl: string
  fingerprint: string
  serverId: string
  version: string
  root: string
  // A mutable clock: the service reads it instead of Date.now(), so a case can age heartbeats, leases
  // and enrollment validity without waiting.
  clock: { now: number; advance(milliseconds: number): void }
  // The connection options every command needs, already pointing at the harness service.
  args(extra?: string[]): string[]
  // Writes a secret to a file outside the service directory and returns the path.
  secret(name: string, value: string): Promise<string>
  path(name: string): string
  close(): Promise<void>
}

export async function startHarness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'ls101-protocol-harness-'))
  const clock = {
    now: Date.now(),
    advance(milliseconds: number) {
      clock.now += milliseconds
    }
  }
  const service = await LabService.initialize(
    {
      root: join(root, 'server'),
      releaseVersion: HARNESS_VERSION,
      isLicenseActive: () => true,
      now: () => clock.now
    },
    { name: 'Protocol harness', baseUrl: 'https://127.0.0.1:8443/', password: HARNESS_PASSWORD }
  )
  const server = createLabHttpServer(service)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('the harness server did not bind')
  const baseUrl = `https://127.0.0.1:${address.port}/`
  // The enrollment file the service signs embeds its own base URL, so it has to be the port the
  // harness actually listens on rather than the placeholder the service was initialized with.
  service.db.transaction(() => service.saveData({ ...service.data(), baseUrl }))
  const harness: Harness = {
    service,
    server,
    baseUrl,
    fingerprint: service.identity.fingerprint,
    serverId: service.identity.serverId,
    version: HARNESS_VERSION,
    root,
    clock,
    args: (extra = []) => [
      '--url',
      baseUrl,
      '--fingerprint',
      service.identity.fingerprint,
      '--version',
      HARNESS_VERSION,
      ...extra
    ],
    secret: async (name, value) => {
      const file = join(root, `${name}.secret`)
      await writeFile(file, `${value}\n`, { encoding: 'utf8', mode: 0o600 })
      return file
    },
    path: (name) => join(root, name),
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      service.db.close()
      await rm(root, { recursive: true, force: true })
    }
  }
  return harness
}

export async function readSecretFile(file: string): Promise<string> {
  return (await readFile(file, 'utf8')).trim()
}
