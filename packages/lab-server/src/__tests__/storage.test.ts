import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LabDatabase } from '../database'
import { WriteGate } from '../write-gate'

const roots: string[] = []
const databases: LabDatabase[] = []
async function temporary(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ls101-storage-'))
  roots.push(root)
  return join(root, 'data')
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('service storage', () => {
  it('requires explicit initialization and excludes a second owner', async () => {
    const root = await temporary()
    await expect(LabDatabase.open(root)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    const db = await LabDatabase.open(root, true)
    databases.push(db)
    await expect(LabDatabase.open(root)).rejects.toMatchObject({ code: 'RESOURCE_BUSY' })
    expect(db.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' })
    expect(db.get('PRAGMA synchronous')).toEqual({ synchronous: 2 })
    expect(db.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 })
  })

  it('rolls back multi-field writes on unique device number conflict', async () => {
    const db = await LabDatabase.open(await temporary(), true)
    databases.push(db)
    db.transaction(() => {
      db.run('INSERT INTO devices VALUES (?,?,?,?)', 'a', 'installation-a', '001', '{}')
      db.run('INSERT INTO devices VALUES (?,?,?,?)', 'b', 'installation-b', '002', '{}')
    })
    expect(() =>
      db.transaction(() => {
        db.run('UPDATE devices SET data=? WHERE id=?', '{"room":"changed"}', 'b')
        db.run('UPDATE devices SET number=? WHERE id=?', '001', 'b')
      })
    ).toThrow()
    expect(db.get('SELECT number,data FROM devices WHERE id=?', 'b')).toEqual({
      number: '002',
      data: '{}'
    })
  })

  it('closes admission before draining and only permits the barrier owner', async () => {
    const gate = new WriteGate()
    const release = gate.enter()
    let drained = false
    const waiting = gate.close('backup').then(() => {
      drained = true
    })
    expect(gate.closed).toBe(true)
    expect(() => gate.enter()).toThrowError('SERVICE_NOT_READY')
    await Promise.resolve()
    expect(drained).toBe(false)
    release()
    await waiting
    expect(drained).toBe(true)
    expect(() => gate.release('other')).toThrow()
    gate.release('backup')
    gate.enter()()
  })
})
