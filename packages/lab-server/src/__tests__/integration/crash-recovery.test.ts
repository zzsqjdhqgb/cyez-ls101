import { randomUUID } from 'node:crypto'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  recordFailure,
  api,
  digest,
  enroll,
  login,
  mode,
  practice,
  beginRequest,
  archiveInput
} from './support'
import { processFixture, type ProcessFixture } from './process-support'
import { recoverOfflineRestore, restoreOffline } from '../../restore'
import { VERSION } from './support'

let f: ProcessFixture | undefined
afterEach(async ({ task }) => {
  if (f && task.result?.state === 'fail') await recordFailure(f.root, task.name)
  await f?.close()
  f = undefined
})

async function setup() {
  f = await processFixture()
  await f.start(true)
  const teacher = await login(f.endpoint)
  const [student] = await enroll(f.endpoint, teacher, 1)
  const submission = await practice(f.endpoint, teacher, student.token)
  return { f, teacher, student, submission }
}

describe('SR-COMMIT: real process death during submission', () => {
  it.each(['upload-reserved', 'upload-file-synced', 'upload-file-published', 'upload-committed'])(
    '%s: restart twice preserves exactly the committed facts',
    async (point) => {
      const { f, teacher, submission } = await setup()
      await f.pause(point)
      const interrupted = submission.upload().then(
        () => null,
        (error: unknown) => error
      )
      await f.reached(point)
      await f.kill()
      expect(await interrupted).toBeInstanceOf(Error)
      await f.start()
      const first = await submission.receipt()
      expect(first.status).toBe(200)
      expect(first.body.status).toBe(point === 'upload-committed' ? 'received' : 'not-received')
      expect(await readdir(join(f.root, 'incoming'))).toEqual([])
      expect(await readdir(join(f.root, 'archives/submissions'))).toHaveLength(
        point === 'upload-committed' ? 1 : 0
      )
      const retried = await submission.upload()
      expect(retried.status).toBe(point === 'upload-committed' ? 200 : 201)
      if (point === 'upload-committed') expect(retried.body).toEqual(first.body)
      await f.kill()
      await f.start()
      expect((await submission.receipt()).body).toEqual(retried.body)
      expect((await submission.upload()).body).toEqual(retried.body)
      const download = await api(
        f.endpoint,
        'GET',
        `/teacher/submissions/${submission.id}/archive`,
        { token: teacher }
      )
      expect(download.status).toBe(200)
      expect(digest(download.bytes)).toBe(digest(submission.bytes))
      expect(
        (await api(f.endpoint, 'GET', '/teacher/submissions', { token: teacher })).body.items
      ).toHaveLength(1)
      expect(await readdir(join(f.root, 'archives/submissions'))).toHaveLength(1)
    },
    30000
  )

  it('half-sent body: crash clears the reservation and permits a complete retry', async () => {
    const { f, student, submission } = await setup()
    await f.pause('upload-reserved')
    const pending = beginRequest(
      f.endpoint,
      'PUT',
      `/student/submissions/${submission.id}`,
      archiveInput(student.token, submission.bytes)
    )
    const lost = pending.response.catch((error: unknown) => error)
    pending.call.write(submission.bytes.subarray(0, 10))
    await f.reached('upload-reserved')
    await f.release()
    expect((await submission.receipt()).body.status).toBe('receiving')
    await f.kill()
    expect(await lost).toBeInstanceOf(Error)
    await f.start()
    expect((await submission.receipt()).body.status).toBe('not-received')
    expect((await submission.upload()).status).toBe(201)
  })

  it('deleted receipt survives process death; replay cannot resurrect its archive', async () => {
    const { f, teacher, submission } = await setup()
    const receipt = (await submission.upload()).body.receipt
    expect(
      (await api(f.endpoint, 'DELETE', `/teacher/submissions/${submission.id}`, { token: teacher }))
        .status
    ).toBe(204)
    await f.kill()
    await f.start()
    expect((await submission.upload()).body).toMatchObject({ status: 'deleted', receipt })
    expect(await readdir(join(f.root, 'archives/submissions'))).toEqual([])
    expect(
      (
        await api(f.endpoint, 'GET', `/teacher/submissions/${submission.id}/archive`, {
          token: teacher
        })
      ).status
    ).toBe(404)
  })

  it.each(['missing', 'truncated'])(
    'committed archive %s: startup fails instead of losing the receipt',
    async (corruption) => {
      const { f, submission } = await setup()
      await submission.upload()
      await f.stop()
      const [name] = await readdir(join(f.root, 'archives/submissions'))
      const path = join(f.root, 'archives/submissions', name)
      if (corruption === 'missing') await rm(path)
      else await writeFile(path, 'truncated')
      await expect(f.start()).rejects.toThrow('STORAGE_UNAVAILABLE')
      // Repair the exact archive and prove the existing receipt, not a new empty service, returns.
      await writeFile(path, submission.bytes)
      await f.start()
      expect((await submission.receipt()).body.status).toBe('received')
      expect((await submission.upload()).status).toBe(200)
    }
  )
})

describe('BK-CRASH: each backup persistence boundary', () => {
  it.each([
    'backup-pending',
    'backup-admission-closed',
    'backup-active',
    'backup-staging-durable',
    'backup-encrypting',
    'backup-file-published',
    'backup-ready'
  ])(
    '%s: interrupted work is never rerun and its barrier is released',
    async (point) => {
      const { f, teacher, submission } = await setup()
      const receipt = (await submission.upload()).body.receipt
      await mode(f.endpoint, teacher, 'maintenance')
      const key = randomUUID()
      const input = {
        token: teacher,
        body: { encryptionPassword: 'private-backup-password' },
        headers: { 'idempotency-key': key }
      }
      await f.pause(point)
      const created = await api(f.endpoint, 'POST', '/teacher/backups', input)
      expect(created.status).toBe(202)
      await f.reached(point)
      await f.kill()
      await f.start()
      const backup = await api(f.endpoint, 'GET', `/teacher/backups/${created.body.id}`, {
        token: teacher
      })
      expect(backup.status).toBe(200)
      expect(backup.body.status).toBe(point === 'backup-ready' ? 'ready' : 'failed')
      expect((await api(f.endpoint, 'POST', '/teacher/backups', input)).body.id).toBe(
        created.body.id
      )
      expect(
        (await api(f.endpoint, 'GET', '/teacher/backups', { token: teacher })).body.items
      ).toHaveLength(1)
      expect(await readdir(join(f.root, 'backup-staging'))).toEqual([])
      const files = await readdir(join(f.root, 'backups'))
      expect(files).toEqual(point === 'backup-ready' ? [`${created.body.id}.7z`] : [])
      if (point === 'backup-ready')
        expect(digest(await readFile(join(f.root, 'backups', files[0])))).toBe(
          backup.body.archiveSha256
        )
      await mode(f.endpoint, teacher, 'normal')
      expect((await submission.receipt()).body.receipt).toEqual(receipt)
      await f.kill()
      await f.start()
      expect(
        (await api(f.endpoint, 'GET', `/teacher/backups/${created.body.id}`, { token: teacher }))
          .body
      ).toEqual(backup.body)
    },
    30000
  )
})

describe('RESTORE-CRASH: process death during offline directory switching', () => {
  it.each([
    'restore-indexes-cleared',
    'restore-verified',
    'restore-switch-recorded',
    'restore-original-moved',
    'restore-installed'
  ])(
    '%s preserves the original and a recoverable receipt',
    async (point) => {
      const { f, teacher, submission } = await setup()
      const receipt = (await submission.upload()).body.receipt
      await mode(f.endpoint, teacher, 'maintenance')
      const password = 'restore-process-secret'
      const created = await api(f.endpoint, 'POST', '/teacher/backups', {
        token: teacher,
        headers: { 'idempotency-key': randomUUID() },
        body: { encryptionPassword: password }
      })
      expect(created.status).toBe(202)
      await expect
        .poll(
          async () =>
            (
              await api(f.endpoint, 'GET', `/teacher/backups/${created.body.id}`, {
                token: teacher
              })
            ).body.status,
          { timeout: 15000 }
        )
        .toBe('ready')
      const archive = join(f.root, 'backups', `${created.body.id}.7z`)
      await f.stop()
      await f.start('restore')
      const interrupted = f.restore(archive, password, point).catch((error: unknown) => error)
      await f.reached(point)
      await f.kill()
      expect(await interrupted).toBeInstanceOf(Error)
      let previous: string
      if (point === 'restore-indexes-cleared' || point === 'restore-verified') {
        // Before the journal is published, the original remains usable and restore can be retried.
        await f.start()
        expect(
          (await api(f.endpoint, 'GET', `/teacher/backups/${created.body.id}`, { token: teacher }))
            .body.status
        ).toBe('ready')
        await f.stop()
        previous = (
          await restoreOffline({ root: f.root, releaseVersion: VERSION, archive, password })
        ).previousDirectory
      } else {
        await expect(f.start()).rejects.toThrow('STORAGE_UNAVAILABLE')
        previous = await recoverOfflineRestore(f.root, VERSION)
      }
      expect(
        (await readFile(join(previous, 'backups', `${created.body.id}.7z`))).length
      ).toBeGreaterThan(0)
      await f.start()
      const fresh = await login(f.endpoint)
      expect(
        (await api(f.endpoint, 'GET', '/teacher/backups', { token: fresh })).body.items
      ).toEqual([])
      expect((await api(f.endpoint, 'GET', '/teacher/security', { token: teacher })).status).toBe(
        401
      )
      await mode(f.endpoint, fresh, 'normal')
      expect((await submission.receipt()).body.receipt).toEqual(receipt)
      await f.kill()
      await f.start()
      expect((await submission.upload()).body.receipt).toEqual(receipt)
    },
    30000
  )
})
