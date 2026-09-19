import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { TeacherOperations } from '../teacher-operations'

describe('durable teacher operation recovery', () => {
  it('retains an unknown write across restart without storing its secret and hides it after replay succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ls101-operations-'))
    try {
      const operations = new TeacherOperations(root)
      const entry = await operations.begin('server', 'postTeacherBackups', {
        idempotencyKey: 'same-key',
        body: { encryptionPassword: 'never-on-disk' }
      })
      expect(await readFile(join(root, `${entry.id}.json`), 'utf8')).not.toContain('never-on-disk')
      await operations.finish(entry)
      const restarted = new TeacherOperations(root)
      expect(await restarted.list()).toMatchObject([
        { status: 'unknown', idempotencyKey: 'same-key', secretFields: ['encryptionPassword'] }
      ])
      const replay = await restarted.begin('server', 'postTeacherBackups', {
        idempotencyKey: 'same-key',
        body: { encryptionPassword: 'never-on-disk' }
      })
      await restarted.finish(replay, { status: 201, body: { id: 'backup' } })
      expect((await restarted.list()).filter((item) => item.status === 'unknown')).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
