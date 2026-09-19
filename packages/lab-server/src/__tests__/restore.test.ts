import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { LabService, type Context } from '../service'
import { restoreOffline, recoverOfflineRestore } from '../restore'
import { durableWrite } from '../durable-files'
import { TEST_EXAM_BYTES, TEST_EXAM_DIGEST } from '../test-suite'
import { INVITATION_CODE_HASH } from '@ls101/license'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'ls101-restore-'))
  cleanup.push(() => rm(parent, { recursive: true, force: true }))
  const root = join(parent, 'data')
  const options = { root, releaseVersion: 'test-release', isLicenseActive: () => true }
  let service = await LabService.initialize(options, {
    name: 'Lab',
    baseUrl: 'https://127.0.0.1:8443/',
    password: 'teacher'
  })
  let opened = true
  cleanup.push(async () => {
    if (opened) await service.db.close()
  })
  const token = (await service.security.login({ password: 'teacher' })).token
  const principal = service.security.authenticate(token, 'teacher')
  const backup = async () => {
    const context: Context = {
      id: 'postTeacherBackups',
      path: {},
      query: {},
      headers: { 'idempotency-key': randomUUID() },
      body: { encryptionPassword: 'backup-secret' },
      principal,
      version: 'test-release',
      loopback: true,
      signal: new AbortController().signal
    }
    const result = service.backups.create(context)
    const id = (result.body as { id: string }).id
    await service.backups.wait()
    expect(service.backups.get(id).status).toBe('ready')
    return { id, archive: join(root, 'backups', `${id}.7z`) }
  }
  const stop = async () => {
    await service.db.close()
    opened = false
  }
  const reopen = async () => {
    service = await LabService.open(options)
    opened = true
    return service
  }
  return { root, options, service, backup, stop, reopen }
}

describe('offline service restore', () => {
  it('persists failed backup cleanup across a failed deletion and a service restart', async () => {
    const f = await fixture()
    f.service.options.fault = (point) => {
      if (point === 'backup-file-published' || point === 'gc-before-remove')
        throw new Error('Interrupted')
    }
    const token = (await f.service.security.login({ password: 'teacher' })).token
    const context: Context = {
      id: 'postTeacherBackups',
      path: {},
      query: {},
      headers: { 'idempotency-key': randomUUID() },
      body: { encryptionPassword: 'secret' },
      principal: f.service.security.authenticate(token, 'teacher'),
      version: 'test-release',
      loopback: true,
      signal: new AbortController().signal
    }
    const value = f.service.backups.create(context).body as { id: string }
    await f.service.backups.wait()
    expect(f.service.backups.get(value.id).status).toBe('failed')
    expect(f.service.db.all('SELECT * FROM file_gc')).toHaveLength(3)
    expect(f.service.db.gate.closed).toBe(false)
    const archive = join(f.root, 'backups', `${value.id}.7z`)
    expect((await stat(archive)).size).toBeGreaterThan(0)
    f.service.options.fault = undefined
    await f.stop()
    const service = await f.reopen()
    expect(service.db.all('SELECT * FROM file_gc')).toEqual([])
    await expect(stat(archive)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(service.backups.get(value.id).status).toBe('failed')
  })
  it('restores B after A, clears only backup mappings and sessions, and preserves the original directory', async () => {
    const f = await fixture()
    const archiveId = randomUUID()
    await durableWrite(join(f.root, 'archives/exams', `${archiveId}.lsexam`), TEST_EXAM_BYTES)
    await durableWrite(
      join(f.root, 'service-runtime.json'),
      JSON.stringify({ schemaVersion: 1, port: 8443, host: '127.0.0.1' })
    )
    await durableWrite(
      join(f.root, 'license.json'),
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: INVITATION_CODE_HASH,
        activatedAt: new Date().toISOString()
      })
    )
    f.service.db.transaction(() => {
      f.service.db.run(
        'INSERT INTO exams VALUES (?,?,?,?,NULL,?)',
        'active-exam',
        'active-package',
        TEST_EXAM_DIGEST,
        archiveId,
        JSON.stringify({ archiveBytes: TEST_EXAM_BYTES.length })
      )
      f.service.db.run(
        'INSERT INTO devices VALUES (?,?,?,?)',
        'device',
        'installation',
        '001',
        '{}'
      )
      f.service.db.run(
        'INSERT INTO exams VALUES (?,?,?,?,?,?)',
        'exam',
        'package',
        'digest',
        'archive',
        1,
        '{}'
      )
      f.service.db.run(
        'INSERT INTO device_credentials VALUES (?,?,?,NULL)',
        'credential',
        'device',
        'hash'
      )
      f.service.db.run(
        'INSERT INTO practice_grants VALUES (?,?,?,?,?)',
        'submission',
        'device',
        'credential',
        'exam',
        '{}'
      )
      f.service.db.run(
        'INSERT INTO submissions VALUES (?,?,?,?,?,?,?,?)',
        'submission',
        'device',
        'digest',
        'archive',
        'receipt',
        1,
        1,
        '{}'
      )
      f.service.db.run(
        'INSERT INTO idempotency VALUES (?,?,?,?,?,?,?,NULL)',
        'teacher',
        'POST',
        '/teacher/exams',
        'business-key',
        'digest',
        201,
        '{}'
      )
      f.service.db.run(
        'INSERT INTO file_gc VALUES (?,?,?)',
        join(f.root, 'deleted.lssubmission'),
        1,
        'deleted'
      )
    })
    const a = await f.backup()
    const b = await f.backup()
    const before = await readFile(b.archive)
    await f.stop()
    const restored = await restoreOffline({
      ...f.options,
      archive: b.archive,
      password: 'backup-secret'
    })
    expect(await readFile(join(restored.previousDirectory, 'backups', `${b.id}.7z`))).toEqual(
      before
    )
    expect(
      (await stat(join(restored.previousDirectory, 'backups', `${a.id}.7z`))).size
    ).toBeGreaterThan(0)
    const service = await f.reopen()
    expect(service.db.all('SELECT * FROM backups')).toEqual([])
    expect(service.db.all("SELECT * FROM idempotency WHERE route='/teacher/backups'")).toEqual([])
    expect(service.db.all('SELECT * FROM teacher_sessions')).toEqual([])
    expect(service.db.all('SELECT * FROM file_gc')).toEqual([])
    expect(await readFile(join(f.root, 'archives/exams', `${archiveId}.lsexam`))).toEqual(
      Buffer.from(TEST_EXAM_BYTES)
    )
    expect(JSON.parse(await readFile(join(f.root, 'service-runtime.json'), 'utf8')).port).toBe(8443)
    expect(
      JSON.parse(await readFile(join(f.root, 'license.json'), 'utf8')).invitationCodeHash
    ).toBe(INVITATION_CODE_HASH)
    expect(service.db.get('SELECT key FROM idempotency')).toEqual({ key: 'business-key' })
    expect(service.db.get('SELECT receipt_id,deleted_at FROM submissions')).toEqual({
      receipt_id: 'receipt',
      deleted_at: 1
    })
    expect(service.data().mode).toBe('maintenance')
    expect(() => service.backups.get(a.id)).toThrow('NOT_FOUND')
    expect(() => service.backups.get(b.id)).toThrow('NOT_FOUND')
  })

  it.each(['unsafe-path', 'wrong-digest'])(
    'rejects %s in an encrypted manifest before switching',
    async (mutation) => {
      const f = await fixture()
      f.service.options.fault = async (point) => {
        if (point !== 'backup-staging-durable') return
        const backup = f.service.db.get<{ id: string }>(
          "SELECT id FROM backups WHERE state='running'"
        )!
        const path = join(f.root, 'backup-staging', backup.id, 'manifest.json')
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        if (mutation === 'unsafe-path') manifest.files[0].path = '../escaped.sqlite'
        else manifest.files[0].sha256 = '0'.repeat(64)
        await durableWrite(path, JSON.stringify(manifest))
      }
      const backup = await f.backup()
      await f.stop()
      await expect(
        restoreOffline({ ...f.options, archive: backup.archive, password: 'backup-secret' })
      ).rejects.toThrow()
      expect((await f.reopen()).backups.get(backup.id).status).toBe('ready')
    }
  )

  it('rejects a running owner, wrong passwords and mismatched releases without switching data', async () => {
    const f = await fixture()
    const backup = await f.backup()
    const input = { ...f.options, archive: backup.archive, password: 'backup-secret' }
    await expect(restoreOffline(input)).rejects.toMatchObject({ code: 'RESOURCE_BUSY' })
    await f.stop()
    await expect(restoreOffline({ ...input, password: 'wrong' })).rejects.toThrow()
    await expect(
      restoreOffline({ ...input, releaseVersion: 'other-release' })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect((await f.reopen()).backups.get(backup.id).status).toBe('ready')
  })

  it.each([
    'restore-indexes-cleared',
    'restore-verified',
    'restore-switch-recorded',
    'restore-original-moved',
    'restore-installed'
  ])(
    'recovers interruption at %s without losing the original',
    async (point) => {
      const f = await fixture()
      const backup = await f.backup()
      await f.stop()
      await expect(
        restoreOffline({
          ...f.options,
          archive: backup.archive,
          password: 'backup-secret',
          fault: (at) => {
            if (at === point) throw new Error('Interrupted')
          }
        })
      ).rejects.toThrow('Interrupted')
      if (['restore-indexes-cleared', 'restore-verified'].includes(point)) {
        expect((await f.reopen()).backups.get(backup.id).status).toBe('ready')
      } else {
        await expect(LabService.open(f.options)).rejects.toMatchObject({
          code: 'STORAGE_UNAVAILABLE'
        })
        const previous = await recoverOfflineRestore(f.root, f.options.releaseVersion)
        expect((await stat(join(previous, 'backups', `${backup.id}.7z`))).size).toBeGreaterThan(0)
        expect((await f.reopen()).db.all('SELECT * FROM backups')).toEqual([])
      }
    },
    60000
  )
})
