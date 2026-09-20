import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { INVITATION_CODE_HASH } from '@ls101/license'
import { startServiceRuntime } from '../../runtime'
import { requestLocalControl } from '../../control'
import { restoreOffline } from '../../restore'
import { api, enroll, login, mode, practice, VERSION, PASSWORD } from './support'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function runtimeFixture() {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-lifecycle-'))
  const root = join(parent, 'data')
  cleanup.push(() => rm(parent, { recursive: true, force: true }))
  const start = async () => {
    const runtime = await startServiceRuntime(root, VERSION)
    cleanup.push(() => runtime.close())
    return runtime
  }
  const runtime = await start()
  const reserved = createServer()
  await new Promise<void>((resolve) => reserved.listen(0, '127.0.0.1', resolve))
  const port = (reserved.address() as { port: number }).port
  await new Promise<void>((resolve) => reserved.close(() => resolve()))
  const activate = () =>
    writeFile(
      join(root, 'license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      }),
      { mode: 0o600 }
    )
  const initialize = () =>
    requestLocalControl<any>(root, 'initialize', {
      name: 'Runtime integration',
      baseUrl: `https://127.0.0.1:${port}/`,
      password: PASSWORD,
      config: { schemaVersion: 1, host: '127.0.0.1', port }
    })
  return { root, runtime, start, activate, initialize, port }
}

describe('LIFE: independent runtime admission and fail-closed startup', () => {
  it('inactive service cannot initialize; explicit initialization is one-time and survives restart', async () => {
    const f = await runtimeFixture()
    await expect(f.initialize()).rejects.toThrow('LICENSE_INACTIVE')
    expect((await f.runtime.status()).state).toBe('uninitialized')
    await f.activate()
    const initialized = await f.initialize()
    await expect(f.initialize()).rejects.toThrow()
    await f.runtime.close()
    const restarted = await f.start()
    expect((await restarted.status()).info?.serverId).toBe(initialized.info.serverId)
  })

  it('occupied port fails startup, releases lifetime ownership, and starts after the port is freed', async () => {
    const f = await runtimeFixture()
    await f.activate()
    const initial = await f.initialize()
    await f.runtime.close()
    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen(f.port, '127.0.0.1', resolve))
    try {
      await expect(f.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()))
    }
    const restarted = await f.start()
    expect((await restarted.status()).info?.serverId).toBe(initial.info.serverId)
  })

  it.each(['missing-config', 'invalid-config', 'incompatible-schema'] as const)(
    '%s never silently initializes an empty database',
    async (condition) => {
      const f = await runtimeFixture()
      await f.activate()
      const initial = await f.initialize()
      await f.runtime.close()
      const path = join(f.root, 'service-runtime.json'),
        config = await readFile(path)
      if (condition === 'missing-config') await rm(path)
      else if (condition === 'invalid-config') await writeFile(path, '{broken')
      else {
        const db = new DatabaseSync(join(f.root, 'service.sqlite'))
        db.exec('PRAGMA user_version=999')
        db.close()
      }
      await expect(f.start()).rejects.toThrow()
      await writeFile(path, config)
      if (condition === 'incompatible-schema') {
        const db = new DatabaseSync(join(f.root, 'service.sqlite'))
        db.exec('PRAGMA user_version=1')
        db.close()
      }
      const restarted = await f.start()
      expect((await restarted.status()).info?.serverId).toBe(initial.info.serverId)
    }
  )

  it('prepare-stop refuses active business, cancelled preparation permits writes, repeated close releases ownership', async () => {
    const f = await runtimeFixture()
    await f.activate()
    await f.initialize()
    const endpoint = {
      port: f.port,
      certificate: await readFile(join(f.root, 'identity/certificate.pem'), 'utf8')
    }
    const teacher = await login(endpoint)
    await mode(endpoint, teacher, 'normal')
    await expect(requestLocalControl(f.root, 'prepare-stop')).rejects.toThrow('SERVICE_MAINTENANCE')
    await mode(endpoint, teacher, 'maintenance')
    await requestLocalControl(f.root, 'prepare-stop')
    expect(
      (
        await api(endpoint, 'PATCH', '/teacher/settings', {
          token: teacher,
          body: { expectedRevision: 1, name: 'blocked' }
        })
      ).status
    ).toBe(503)
    await requestLocalControl(f.root, 'cancel-stop')
    expect(
      (
        await api(endpoint, 'PATCH', '/teacher/settings', {
          token: teacher,
          body: { expectedRevision: 1, name: 'resumed' }
        })
      ).status
    ).toBe(200)
    await Promise.all([f.runtime.close(), f.runtime.close()])
    expect((await (await f.start()).status()).settings?.name).toBe('resumed')
  })

  it('real HTTP backup restores through the local offline boundary and revokes snapshot sessions', async () => {
    const f = await runtimeFixture()
    await f.activate()
    const original = await f.initialize()
    const endpoint = {
      port: f.port,
      certificate: await readFile(join(f.root, 'identity/certificate.pem'), 'utf8')
    }
    const teacher = await login(endpoint)
    const [student] = await enroll(endpoint, teacher, 1)
    const p = await practice(endpoint, teacher, student.token)
    const receipt = (await p.upload()).body.receipt
    await mode(endpoint, teacher, 'maintenance')
    const backup = await api(endpoint, 'POST', '/teacher/backups', {
      token: teacher,
      body: { encryptionPassword: 'restore-secret' },
      headers: { 'idempotency-key': randomUUID() }
    })
    expect(backup.status, JSON.stringify(backup.body)).toBe(202)
    await expect
      .poll(
        async () =>
          (await api(endpoint, 'GET', `/teacher/backups/${backup.body.id}`, { token: teacher }))
            .body.status,
        { timeout: 15000 }
      )
      .toBe('ready')
    const archive = join(f.root, 'backups', `${backup.body.id}.7z`)
    await f.runtime.close()
    await restoreOffline({
      root: f.root,
      releaseVersion: VERSION,
      archive,
      password: 'restore-secret'
    })
    const restored = await f.start()
    expect((await restored.status()).info?.serverId).toBe(original.info.serverId)
    expect((await api(endpoint, 'GET', '/teacher/security', { token: teacher })).status).toBe(401)
    const fresh = await login(endpoint)
    expect((await api(endpoint, 'GET', '/teacher/backups', { token: fresh })).body.items).toEqual(
      []
    )
    expect(
      (await api(endpoint, 'GET', `/teacher/backups/${backup.body.id}`, { token: fresh })).status
    ).toBe(404)
    await mode(endpoint, fresh, 'normal')
    expect((await p.receipt()).body.receipt).toEqual(receipt)
    expect((await p.upload()).status).toBe(200)
  }, 30000)
})
