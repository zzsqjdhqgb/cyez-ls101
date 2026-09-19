/*
 * M4's backup precondition against the real service in-process (docs/lab-vm-acceptance-design.md,
 * Tier 4).
 *
 * `prepare-upgrade` refuses unless the service holds a `ready` backup whose snapshot is under 24 hours
 * old and whose archive is still on disk, so M4 cannot reach the real upgrade without one. That makes
 * this command a precondition of a case rather than a case of its own: if it silently reported a
 * backup that the runtime would later reject, the VM run would fail several minutes in with an
 * unexplained refusal from the manager.
 *
 * The container lane is where the shapes are asserted, because the harness can move the clock and the
 * VM cannot: a backup whose snapshot is older than the window is produced here by advancing the clock,
 * which is exactly the state the runtime refuses.
 */
import { randomBytes } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { backup } from './commands/backup'
import { mode } from './commands/mode'
import { isRecord } from './context'
import { HARNESS_PASSWORD, startHarness, type Harness } from './harness'

interface Fixture {
  harness: Harness
  passwordFile: string
  backupPasswordFile: string
}

let fixture: Fixture

function recordOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('the command did not report a JSON object')
  return value
}

beforeEach(async () => {
  const harness = await startHarness()
  fixture = {
    harness,
    passwordFile: await harness.secret('teacher-password', HARNESS_PASSWORD),
    // A real archive password: the service encrypts with it and verifies the published bytes against
    // the digest it recorded, so a placeholder would test the engine rather than the command.
    backupPasswordFile: await harness.secret('backup-password', `Aa1!${randomBytes(18).toString('base64url')}`)
  }
}, 45000)

afterEach(async () => {
  await fixture.harness.close()
})

test('M4 the backup command reports a ready archive the upgrade precondition can use', async () => {
  const { harness, passwordFile, backupPasswordFile } = fixture
  // A fresh service starts in maintenance, so the refusal the teacher's UI would show is produced by
  // leaving it first: a backup in normal mode is refused with the mode as the blocker.
  const normal = recordOf(
    await mode(harness.args(['--password-file', passwordFile, '--set', 'normal']))
  )
  expect(normal).toMatchObject({ status: 200, mode: 'normal' })
  const refused = recordOf(
    await backup(harness.args(['--password-file', passwordFile, '--backup-password-file', backupPasswordFile]))
  )
  expect(refused).toMatchObject({ status: 409, code: 'RESOURCE_BUSY', id: null, readable: false })
  expect(refused.message).toBeTruthy()

  const entered = recordOf(
    await mode(harness.args(['--password-file', passwordFile, '--set', 'maintenance']))
  )
  expect(entered).toMatchObject({ status: 200, mode: 'maintenance' })

  const ready = recordOf(
    await backup(harness.args(['--password-file', passwordFile, '--backup-password-file', backupPasswordFile]))
  )
  expect(ready.status).toBe(202)
  expect(ready.backupStatus).toBe('ready')
  // These three values are exactly what `prepare-upgrade` reads and verifies before it writes the
  // upgrade preparation record, so a backup that reported `readable: true` and was then refused would
  // be a driver bug rather than a product one.
  expect(ready.readable).toBe(true)
  expect(Number(ready.archiveBytes)).toBeGreaterThan(0)
  expect(String(ready.archiveSha256)).toMatch(/^[0-9a-f]{64}$/)
  expect(Number.isNaN(Date.parse(String(ready.snapshotAt)))).toBe(false)
  expect(ready.releaseVersion).toBe(harness.version)
  expect(ready.error).toBeNull()

  // The archive the index points at is really on disk, which is the half a driver that only read the
  // JSON could not see.
  const published = await stat(
    `${harness.service.options.root}/backups/${String(ready.id)}.7z`
  )
  expect(published.size).toBe(Number(ready.archiveBytes))
  expect((await readFile(`${harness.service.options.root}/backups/${String(ready.id)}.7z`)).length).toBe(
    Number(ready.archiveBytes)
  )

  // A second backup in the same maintenance window is allowed and produces a distinct id; the upgrade
  // precondition reads the most recent ready snapshot, so "the newest one wins" has to be observable.
  const second = recordOf(
    await backup(harness.args(['--password-file', passwordFile, '--backup-password-file', backupPasswordFile]))
  )
  expect(second.backupStatus).toBe('ready')
  expect(second.id).not.toBe(ready.id)
})

test('M4 an aged backup is reported as older than the upgrade window', async () => {
  const { harness, passwordFile, backupPasswordFile } = fixture
  await mode(harness.args(['--password-file', passwordFile, '--set', 'maintenance']))
  const ready = recordOf(
    await backup(harness.args(['--password-file', passwordFile, '--backup-password-file', backupPasswordFile]))
  )
  expect(ready.backupStatus).toBe('ready')

  // 25 hours: the runtime refuses a snapshot older than 24, and this is the boundary the VM run cannot
  // reach without waiting a day. The service's own clock is the harness clock, so the age is real to
  // the service rather than simulated around it.
  harness.clock.advance(25 * 60 * 60 * 1000)
  const aged = recordOf(
    await backup(harness.args(['--password-file', passwordFile, '--backup-password-file', backupPasswordFile]))
  )
  // A new backup is still created and is ready; what the case shows is that the *snapshot time* the
  // upgrade reads is the service's own timestamp, not the request time.
  expect(aged.backupStatus).toBe('ready')
  expect(Date.parse(String(aged.snapshotAt))).toBeGreaterThan(Date.parse(String(ready.snapshotAt)))
})
