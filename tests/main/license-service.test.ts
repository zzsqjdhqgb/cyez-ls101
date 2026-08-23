import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LicenseService, hashInvitationCode } from '../../src/main/license-service'

const directories: string[] = []
const invitationCode = 'Invite-1234'
const expectedCodeHash = hashInvitationCode(invitationCode)
const expiresAt = '2026-10-01T15:59:59.999Z'

async function createStoragePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'ls101-license-unit-'))
  directories.push(directory)
  return path.join(directory, 'license.json')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('LicenseService', () => {
  it('validates a normalized invitation code and persists only its hash', async () => {
    const storagePath = await createStoragePath()
    const now = new Date('2026-08-23T08:00:00.000Z')
    const options = { storagePath, expectedCodeHash, expiresAt, now: () => now }
    const service = new LicenseService(options)

    await expect(service.getStatus()).resolves.toEqual({
      state: 'not-activated',
      expiresAt
    })
    await expect(service.activate('wrong-code')).resolves.toMatchObject({
      activated: false,
      reason: 'invalid-code',
      status: { state: 'not-activated' }
    })

    await expect(service.activate('  invite-1234  ')).resolves.toEqual({
      activated: true,
      status: {
        state: 'active',
        expiresAt,
        activatedAt: now.toISOString()
      }
    })

    const serialized = await readFile(storagePath, 'utf8')
    expect(serialized).toContain(expectedCodeHash)
    expect(serialized.toLowerCase()).not.toContain(invitationCode.toLowerCase())
    await expect(new LicenseService(options).getStatus()).resolves.toEqual({
      state: 'active',
      expiresAt,
      activatedAt: now.toISOString()
    })
  })

  it('is valid at the deadline and expires immediately after it', async () => {
    const storagePath = await createStoragePath()
    let now = new Date(expiresAt)
    const service = new LicenseService({
      storagePath,
      expectedCodeHash,
      expiresAt,
      now: () => now
    })

    await expect(service.activate(invitationCode)).resolves.toMatchObject({
      activated: true,
      status: { state: 'active' }
    })
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'active' })

    now = new Date(Date.parse(expiresAt) + 1)
    await expect(service.getStatus()).resolves.toEqual({ state: 'expired', expiresAt })
    await expect(service.activate(invitationCode)).resolves.toEqual({
      activated: false,
      reason: 'expired',
      status: { state: 'expired', expiresAt }
    })
  })

  it('treats malformed or unrelated receipts as not activated', async () => {
    const storagePath = await createStoragePath()
    const service = new LicenseService({
      storagePath,
      expectedCodeHash,
      expiresAt,
      now: () => new Date('2026-08-23T08:00:00.000Z')
    })

    await writeFile(storagePath, '{not-json', 'utf8')
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'not-activated' })

    await writeFile(
      storagePath,
      JSON.stringify({
        schemaVersion: 1,
        invitationCodeHash: hashInvitationCode('another-code'),
        activatedAt: '2026-08-23T08:00:00.000Z'
      }),
      'utf8'
    )
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'not-activated' })
  })
})
