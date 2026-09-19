import { mkdtemp, mkdir, readFile, rm, chmod } from 'node:fs/promises'
import { createServer, createConnection } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:https'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { INVITATION_CODE_HASH } from '@ls101/license'
import { startServiceRuntime } from '../runtime'
import { controlPath, requestLocalControl } from '../control'
import { readServiceStatus, statusChannelPath } from '../status-channel'
import { execFile } from 'node:child_process'
import { durableWrite } from '../durable-files'
import { restoreOffline } from '../restore'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})
async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-runtime-'))
  cleanup.push(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'data')
  await mkdir(root)
  const runtime = await startServiceRuntime(root, 'test-release')
  cleanup.push(() => runtime.close())
  const listener = createServer()
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done))
  const port = (listener.address() as { port: number }).port
  await new Promise<void>((done) => listener.close(() => done()))
  const initialize = () =>
    requestLocalControl(root, 'initialize', {
      name: 'Lab',
      baseUrl: `https://127.0.0.1:${port}/`,
      password: 'teacher-secret',
      config: { schemaVersion: 1, host: '127.0.0.1', port }
    })
  const activate = () =>
    durableWrite(
      join(root, 'license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      })
    )
  return { root, runtime, initialize, activate, port }
}

describe('independent service runtime and local authentication', () => {
  it('publishes live status without access to the private management key', async () => {
    const f = await fixture()
    expect(await readServiceStatus(f.root)).toMatchObject({ state: 'uninitialized' })
    await f.activate()
    await f.initialize()
    const status = await readServiceStatus(f.root)
    expect(status).toMatchObject({ state: 'running', settings: { name: 'Lab' } })
    expect(JSON.stringify(status)).not.toContain('teacher-secret')
    expect(status).not.toHaveProperty('localProof')
    // Sending a privileged operation to the status socket must not execute it.
    await new Promise<void>((done) => {
      const socket = createConnection(statusChannelPath(f.root))
      socket.on('error', () => undefined)
      socket.once('connect', () => socket.end(JSON.stringify({ operation: 'shutdown' })))
      socket.once('close', () => done())
      socket.resume()
    })
    expect(await readServiceStatus(f.root)).toMatchObject({ state: 'running' })
    if (process.platform !== 'win32') {
      await chmod(join(f.root, 'control.key'), 0o644)
      await expect(requestLocalControl(f.root, 'status')).rejects.toThrow('permissions')
      expect(await readServiceStatus(f.root)).toMatchObject({ state: 'running' })
    }
  })

  it.skipIf(process.platform !== 'linux' || process.getuid?.() !== 0)(
    'allows an unprivileged user to observe a service with private data',
    async () => {
      const f = await fixture()
      const script = `
        const net = require('node:net');
        const fs = require('node:fs');
        try { fs.readFileSync(process.argv[2]); process.exit(2); } catch (error) {
          if (error.code !== 'EACCES') process.exit(3);
        }
        const socket = net.createConnection(process.argv[1]);
        socket.setTimeout(5000, () => { socket.destroy(); process.exit(4); });
        socket.on('data', chunk => process.stdout.write(chunk));
        socket.on('error', () => process.exit(5));
      `
      // Pass the abstract socket name as an escaped string: argv cannot contain NUL.
      const output = await new Promise<string>((done, fail) => {
        execFile(
          process.execPath,
          [
            '-e',
            script.replace('process.argv[1]', JSON.stringify(statusChannelPath(f.root))),
            'unused',
            join(f.root, 'control.key')
          ],
          { uid: 65534, gid: 65534, timeout: 10000 },
          (error, stdout) => {
            if (error) fail(error)
            else done(stdout)
          }
        )
      })
      expect(JSON.parse(output)).toMatchObject({ state: 'uninitialized' })
    }
  )

  it('blocks live activity but permits stop and upgrade with stale offline observations', async () => {
    const f = await fixture()
    await f.activate()
    await f.initialize()
    const db = new DatabaseSync(join(f.root, 'service.sqlite'))
    try {
      const device = randomUUID(),
        credential = randomUUID()
      db.prepare('INSERT INTO devices VALUES (?,?,?,?)').run(device, randomUUID(), '001', '{}')
      db.prepare('INSERT INTO device_credentials VALUES (?,?,?,NULL)').run(
        credential,
        device,
        'hash'
      )
      db.prepare('INSERT INTO heartbeats VALUES (?,?,?,?,?,?)').run(
        credential,
        1,
        randomUUID(),
        1,
        Date.now(),
        '{}'
      )
      for (const phase of ['preparing', 'practicing', 'saving', 'testing']) {
        db.prepare('UPDATE heartbeats SET accepted_at=?,data=?').run(
          Date.now(),
          JSON.stringify({ phase })
        )
        await expect(requestLocalControl(f.root, 'prepare-stop')).rejects.toThrow('RESOURCE_BUSY')
        await expect(
          requestLocalControl(f.root, 'prepare-upgrade', 'next-release')
        ).rejects.toThrow('RESOURCE_BUSY')
      }
      db.prepare('UPDATE heartbeats SET accepted_at=?').run(Date.now() - 30 * 86400000)
      await expect(requestLocalControl(f.root, 'prepare-stop')).resolves.toBeNull()
      await requestLocalControl(f.root, 'cancel-stop')
      // Offline observations do not bypass the separate backup requirement.
      await expect(requestLocalControl(f.root, 'prepare-upgrade', 'next-release')).rejects.toThrow(
        'RESOURCE_BUSY'
      )
      const backupId = randomUUID(),
        bytes = Buffer.from('verified backup fixture')
      await durableWrite(join(f.root, 'backups', `${backupId}.7z`), bytes)
      db.prepare('INSERT INTO backups VALUES (?,?,?,?)').run(
        backupId,
        'ready',
        'released',
        JSON.stringify({
          id: backupId,
          snapshotAt: new Date().toISOString(),
          archiveBytes: bytes.length,
          archiveSha256: createHash('sha256').update(bytes).digest('hex')
        })
      )
      await expect(
        requestLocalControl(f.root, 'prepare-upgrade', 'next-release')
      ).resolves.toBeNull()
      expect(JSON.parse(await readFile(join(f.root, 'upgrade-ready.json'), 'utf8'))).toMatchObject({
        targetVersion: 'next-release',
        backupId
      })
      expect(db.prepare('SELECT data FROM heartbeats').get()).toEqual({
        data: JSON.stringify({ phase: 'testing' })
      })
    } finally {
      db.close()
    }
  })

  it('rejects an upgrade without a backup, releases failed admission and accepts a clean local shutdown', async () => {
    const f = await fixture()
    await f.activate()
    await f.initialize()
    await expect(requestLocalControl(f.root, 'prepare-upgrade', 'next-release')).rejects.toThrow(
      'RESOURCE_BUSY'
    )
    await expect(requestLocalControl(f.root, 'prepare-stop')).resolves.toBeNull()
    await expect(requestLocalControl(f.root, 'prepare-stop')).rejects.toThrow('RESOURCE_BUSY')
    await expect(requestLocalControl(f.root, 'cancel-stop')).resolves.toBeNull()
    await expect(requestLocalControl(f.root, 'prepare-stop')).resolves.toBeNull()
    await expect(requestLocalControl(f.root, 'shutdown')).resolves.toBeNull()
    await f.runtime.close()
    await expect(requestLocalControl(f.root, 'status')).rejects.toThrow()
  })
  it('keeps credentials and local proofs encrypted even through a forwarding pipe', async () => {
    const f = await fixture()
    await f.activate()
    const proxyRoot = join(f.root, 'proxy')
    await mkdir(proxyRoot)
    await durableWrite(join(proxyRoot, 'control.key'), await readFile(join(f.root, 'control.key')))
    const captured: Buffer[] = []
    const proxy = createServer((socket) => {
      const upstream = createConnection(controlPath(f.root))
      socket.on('data', (chunk) => captured.push(chunk))
      upstream.on('data', (chunk) => captured.push(chunk))
      socket.on('error', () => upstream.destroy())
      upstream.on('error', () => socket.destroy())
      socket.once('close', () => upstream.destroy())
      socket.pipe(upstream).pipe(socket)
    })
    await new Promise<void>((done) => proxy.listen(controlPath(proxyRoot), done))
    cleanup.push(() => new Promise<void>((done) => proxy.close(() => done())))
    await requestLocalControl(proxyRoot, 'initialize', {
      name: 'Lab',
      baseUrl: `https://127.0.0.1:${f.port}/`,
      password: 'private-through-proxy',
      config: { schemaVersion: 1, host: '127.0.0.1', port: f.port }
    })
    const connection = await requestLocalControl<{ localProof: string }>(proxyRoot, 'connection')
    const wire = Buffer.concat(captured).toString('utf8')
    expect(wire).not.toContain('private-through-proxy')
    expect(wire).not.toContain(connection.localProof)
    expect(connection.localProof).toHaveLength(43)
  })
  it('requires activation, initializes explicitly, survives client disconnect and consumes local proofs once', async () => {
    const f = await fixture()
    expect(await requestLocalControl(f.root, 'status')).toMatchObject({ state: 'uninitialized' })
    await expect(f.initialize()).rejects.toThrow('LICENSE_INACTIVE')
    await f.activate()
    expect(await f.initialize()).toMatchObject({ state: 'running', info: { readiness: 'ready' } })
    const target = await requestLocalControl<{
      baseUrl: string
      fingerprint: string
      serverId: string
      localProof: string
    }>(f.root, 'connection')
    const certificate = await readFile(join(f.root, 'identity/certificate.pem'))
    const login = (origin?: string) =>
      new Promise<number>((done, fail) => {
        const call = request(
          new URL('/api/v1/teacher/sessions', target.baseUrl),
          {
            method: 'POST',
            ca: certificate,
            checkServerIdentity: () => undefined,
            headers: {
              'x-ls101-client-version': 'test-release',
              'content-type': 'application/json',
              'x-ls101-local-authorization': target.localProof,
              ...(origin ? { origin } : {})
            }
          },
          (response) => {
            response.resume()
            response.once('end', () => done(response.statusCode!))
          }
        )
        call.on('error', fail)
        call.end('{}')
      })
    expect(await login('https://example.com')).toBe(401)
    expect(await login()).toBe(200)
    expect(await login()).toBe(401)
    expect(await requestLocalControl(f.root, 'status')).toMatchObject({ state: 'running' })
    await expect(
      restoreOffline({
        root: f.root,
        releaseVersion: 'test-release',
        archive: 'missing',
        password: 'secret'
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_BUSY' })
    await f.runtime.close()
    const restarted = await startServiceRuntime(f.root, 'test-release')
    cleanup.push(() => restarted.close())
    expect(await requestLocalControl(f.root, 'status')).toMatchObject({
      state: 'running',
      info: { serverId: target.serverId }
    })
  })

  it('rejects duplicate daemons, unknown operations, forged control messages and readable keys', async () => {
    const f = await fixture()
    await expect(startServiceRuntime(f.root, 'test-release')).rejects.toMatchObject({
      code: 'RESOURCE_BUSY'
    })
    await expect(requestLocalControl(f.root, 'execute', { command: 'anything' })).rejects.toThrow(
      'INVALID_REQUEST'
    )
    await new Promise<void>((done, fail) => {
      const socket = createConnection(controlPath(f.root))
      socket.on('error', fail)
      socket.once('data', () =>
        socket.write(`${JSON.stringify({ message: '{}', mac: '0'.repeat(64) })}\n`)
      )
      socket.once('close', () => done())
    })
    expect(await requestLocalControl(f.root, 'status')).toMatchObject({ state: 'uninitialized' })
    if (process.platform !== 'win32') {
      await chmod(join(f.root, 'control.key'), 0o644)
      await expect(requestLocalControl(f.root, 'status')).rejects.toThrow('permissions')
    }
  })
})
