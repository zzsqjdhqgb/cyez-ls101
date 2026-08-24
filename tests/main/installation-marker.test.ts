import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  claimReleaseNotesVersion,
  ensureInstallationMarker,
  INSTALLATION_MARKER_FILENAME
} from '../../src/main/installation-marker'

const roots: string[] = []
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('current installation marker', () => {
  it('creates an atomic marker for the first completed current-version startup', async () => {
    const userData = await temporaryDirectory('ls101-installation-create-')

    await expect(
      ensureInstallationMarker(userData, '0.4.0-local.test', {
        createId: () => INSTALLATION_ID,
        now: () => new Date('2026-08-23T12:00:00.000Z')
      })
    ).resolves.toEqual({
      kind: 'ls101-installation',
      formatVersion: 1,
      installationId: INSTALLATION_ID,
      firstAppVersion: '0.4.0-local.test',
      lastAppVersion: '0.4.0-local.test',
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z'
    })
    await expect(readMarker(userData)).resolves.toMatchObject({
      installationId: INSTALLATION_ID,
      firstAppVersion: '0.4.0-local.test'
    })
    expect((await readdir(userData)).filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('preserves installation identity, first version and unknown same-format fields', async () => {
    const userData = await temporaryDirectory('ls101-installation-update-')
    const filename = path.join(userData, INSTALLATION_MARKER_FILENAME)
    await writeFile(
      filename,
      JSON.stringify({
        kind: 'ls101-installation',
        formatVersion: 1,
        installationId: INSTALLATION_ID,
        firstAppVersion: '0.4.0',
        lastAppVersion: '0.4.1',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
        futureSameFormatField: { keep: true }
      })
    )

    await ensureInstallationMarker(userData, '0.5.0', {
      now: () => new Date('2026-08-23T13:00:00.000Z')
    })

    await expect(readMarker(userData)).resolves.toEqual({
      kind: 'ls101-installation',
      formatVersion: 1,
      installationId: INSTALLATION_ID,
      firstAppVersion: '0.4.0',
      lastAppVersion: '0.5.0',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-23T13:00:00.000Z',
      futureSameFormatField: { keep: true }
    })
  })

  it('does not move the update timestamp backwards when the system clock regresses', async () => {
    const userData = await temporaryDirectory('ls101-installation-clock-')
    await ensureInstallationMarker(userData, '0.4.0', {
      createId: () => INSTALLATION_ID,
      now: () => new Date('2026-08-23T14:00:00.000Z')
    })

    await ensureInstallationMarker(userData, '0.4.1', {
      now: () => new Date('2026-08-22T14:00:00.000Z')
    })

    await expect(readMarker(userData)).resolves.toMatchObject({
      lastAppVersion: '0.4.1',
      updatedAt: '2026-08-23T14:00:00.000Z'
    })
  })

  it('claims release notes once per version and preserves the claim across marker updates', async () => {
    const userData = await temporaryDirectory('ls101-installation-release-notes-')
    await ensureInstallationMarker(userData, '0.4.0', {
      createId: () => INSTALLATION_ID,
      now: () => new Date('2026-08-23T14:00:00.000Z')
    })

    await expect(claimReleaseNotesVersion(userData, '0.4.0')).resolves.toBe(true)
    await expect(claimReleaseNotesVersion(userData, '0.4.0')).resolves.toBe(false)
    await expect(readMarker(userData)).resolves.toMatchObject({
      lastShownReleaseNotesVersion: '0.4.0'
    })

    await expect(claimReleaseNotesVersion(userData, '0.5.0')).resolves.toBe(true)
    await expect(
      ensureInstallationMarker(userData, '0.5.0', {
        now: () => new Date('2026-08-24T14:00:00.000Z')
      })
    ).resolves.toMatchObject({
      lastAppVersion: '0.5.0',
      lastShownReleaseNotesVersion: '0.5.0'
    })
    await expect(readMarker(userData)).resolves.toMatchObject({
      lastAppVersion: '0.5.0',
      lastShownReleaseNotesVersion: '0.5.0'
    })
  })

  it('refuses to overwrite a marker from an unsupported future format', async () => {
    const userData = await temporaryDirectory('ls101-installation-future-')
    const filename = path.join(userData, INSTALLATION_MARKER_FILENAME)
    const futureMarker = JSON.stringify({
      kind: 'ls101-installation',
      formatVersion: 2,
      installationId: INSTALLATION_ID
    })
    await writeFile(filename, futureMarker)

    await expect(ensureInstallationMarker(userData, '0.4.0')).rejects.toThrow(
      '格式无效或版本不受支持'
    )
    await expect(readFile(filename, 'utf8')).resolves.toBe(futureMarker)
  })
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  return directory
}

async function readMarker(userData: string): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(userData, INSTALLATION_MARKER_FILENAME), 'utf8')
  ) as unknown
}
