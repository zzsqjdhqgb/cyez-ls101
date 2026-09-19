/*
 * N8/N9/N10 against the real service in-process (docs/lab-vm-acceptance-design.md, Tier 2).
 *
 * The VM run drives these same commands as separate processes against an installed service, but it
 * cannot move the clock. Here the service reads `harness.clock`, so the 20 s offline window and the
 * 30 s task lease are asserted directly instead of being waited out: the case proves the same boundary
 * and still fits in the suite's time budget.
 *
 * The device is registered and the exam published through the product client, not through the
 * enrollment/exam commands that other agents own, so this spec stands alone; from the first assertion
 * on, everything goes through the commands under test. A service refusal a case expects is data, so
 * the assertions read the reported status and code rather than expecting a rejection.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { ExamPackage } from '../../../packages/core-types/src'
import { encodeExamPackage } from '../../../packages/exam-package/src'
import type { Schema } from '../../../packages/lab-contracts/src'
import { HARNESS_PASSWORD, installationId, startHarness, type Harness } from './harness'
import { concurrency } from './commands/concurrency'
import { maintenanceExit, mode, testRun } from './commands/mode'
import { practice } from './commands/practice'
import { isRecord, openSession, openTeacher } from './context'

interface Fixture {
  harness: Harness
  root: string
  stateFile: string
  passwordFile: string
  token: string
  deviceId: string
  examId: string
  archiveSha256: string
}

let fixture: Fixture

function recordOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('the command did not report a JSON object')
  return value
}

function countIn(counts: unknown, key: string): number {
  if (!isRecord(counts)) return 0
  const count = counts[key]
  return typeof count === 'number' ? count : 0
}

function totalCount(counts: unknown): number {
  if (!isRecord(counts)) return 0
  return Object.values(counts).reduce<number>(
    (sum, value) => sum + (typeof value === 'number' ? value : 0),
    0
  )
}

function heartbeat(runtimeId: string): Schema<'Heartbeat'> {
  return {
    runtimeId,
    runtimeGeneration: 1,
    sequence: 1,
    activationState: 'active',
    phase: 'idle',
    currentPractice: null,
    submissionSummary: { waitingFirstUpload: 0, unconfirmed: 0, failed: 0 },
    lastError: null
  }
}

// The device state file is written the way `enroll-register --state-out` writes it, so the commands
// under test read the same keys the VM run gives them; it is a credential file, hence 0600.
async function setup(): Promise<Fixture> {
  const harness = await startHarness()
  const root = await mkdtemp(join(tmpdir(), 'ls101-mode-spec-'))
  const passwordFile = join(root, 'teacher-password')
  await writeFile(passwordFile, `${HARNESS_PASSWORD}\n`, { encoding: 'utf8', mode: 0o600 })
  const teacher = await openTeacher(harness.args(['--password-file', passwordFile]), {
    passwordFile
  })
  try {
    const service = await teacher.client.request<Schema<'ServiceState'>>('getTeacherService')
    const enrollment = await teacher.client.request<Schema<'EnrollmentCreated'>>(
      'postTeacherEnrollments',
      {
        body: { expectedModeRevision: service.modeRevision, validForSeconds: 600 },
        idempotencyKey: randomUUID()
      }
    )
    const download = await teacher.transport.request(
      teacher.connectionId,
      'getTeacherEnrollmentsIdFile',
      { path: { id: enrollment.enrollment.id } }
    )
    if (!download.archive) throw new Error('the harness did not return an enrollment file')
    const enrollFile = await readFile(teacher.transport.file(download.archive.handle), 'utf8')

    // A device secret is generated here exactly as the enrollment command generates it; the student
    // bearer token is derived from it and never printed.
    const enrollmentId = installationId()
    const deviceSecret = randomBytes(32).toString('base64url')
    const registration = await teacher.transport.request(
      teacher.connectionId,
      'putEnrollmentDevicesInstallationId',
      {
        path: { installationId: enrollmentId },
        body: {
          enrollmentFile: enrollFile,
          deviceSecret,
          computerName: 'protocol-mode-spec',
          platform: process.platform === 'win32' ? 'win32' : 'linux',
          releaseVersion: harness.version
        }
      }
    )
    if (registration.status >= 400 || !isRecord(registration.body))
      throw new Error(`the spec device could not be registered: ${registration.status}`)
    const deviceId = String(registration.body.deviceId)
    const bearerToken = `d.${deviceId}.${deviceSecret}`
    // An open enrollment is itself a maintenance blocker, so it is closed now: N10 has to reach the
    // state where the outstanding lease is the only thing holding the service in maintenance.
    await teacher.client.request('deleteTeacherEnrollmentsId', {
      path: { id: enrollment.enrollment.id }
    })

    const exam: ExamPackage = {
      format: 'ls101-exam',
      formatVersion: 1,
      packageId: randomUUID(),
      examData: {
        title: 'Protocol mode spec',
        resources: {},
        player: {
          pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds: 0 }] }],
          recordingIndices: []
        }
      },
      answerCapturePlan: { strings: [], audios: [] },
      submissionTemplate: {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: '', examTitle: 'Protocol mode spec' },
        schemaUses: [],
        resources: {}
      }
    }
    exam.submissionTemplate.meta.examPackageId = exam.packageId
    const examFile = join(root, 'exam.lsexam')
    await writeFile(examFile, await encodeExamPackage(exam, {}))
    const imported = await teacher.client.request<Schema<'ExamImport'>>('postTeacherExams', {
      archive: await teacher.transport.registerArchive(teacher.connectionId, examFile),
      idempotencyKey: randomUUID()
    })
    await teacher.client.request('patchTeacherExamsExamId', {
      path: { examId: imported.examId },
      body: { published: true, expectedRevision: imported.revision }
    })

    const stateFile = harness.path('device-state.json')
    await writeFile(
      stateFile,
      `${JSON.stringify({
        installationId: enrollmentId,
        deviceId,
        deviceNumber: registration.body.deviceNumber,
        deviceSecret,
        bearerToken,
        authorization: `Bearer ${bearerToken}`,
        url: harness.baseUrl,
        fingerprint: harness.fingerprint,
        serverId: harness.serverId,
        version: harness.version,
        computerName: 'protocol-mode-spec',
        platform: process.platform === 'win32' ? 'win32' : 'linux'
      })}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
    return {
      harness,
      root,
      stateFile,
      passwordFile,
      token: bearerToken,
      deviceId,
      examId: imported.examId,
      archiveSha256: imported.archiveSha256
    }
  } finally {
    await teacher.close()
  }
}

beforeEach(async () => {
  fixture = await setup()
}, 45000)

afterEach(async () => {
  await fixture.harness.close()
  await rm(fixture.root, { recursive: true, force: true })
})

test('N8 maintenance refuses a practice and a submission while heartbeats stay accepted', async () => {
  const { harness, stateFile, examId, archiveSha256 } = fixture
  const grantOut = join(fixture.root, 'grant.json')
  const student = await openSession(harness.args(), 'student', fixture.token)
  try {
    const beat = await student.client.request<Schema<'HeartbeatResponse'>>('postStudentHeartbeat', {
      body: heartbeat(randomUUID())
    })
    // A heartbeat is the one student call the service keeps admitting in maintenance: that is how the
    // device learns the mode changed without the teacher having to reach every machine.
    expect(beat.heartbeatAccepted).toBe(true)
    expect(beat.availability).toBe('maintenance')
  } finally {
    await student.close()
  }

  const refused = recordOf(
    await practice(
      harness.args([
        '--state',
        stateFile,
        '--exam-id',
        examId,
        '--archive-sha256',
        archiveSha256,
        '--expect-rejected',
        '--grant-out',
        grantOut
      ])
    )
  )
  expect(refused).toMatchObject({
    action: 'start',
    status: 409,
    code: 'SERVICE_MAINTENANCE',
    mode: 'maintenance',
    expectRejected: true,
    numbering: null,
    grantOut: null
  })
  // A refused start must not create the practice the later steps would silently continue.
  await expect(readFile(grantOut, 'utf8')).rejects.toThrow()

  const submission = recordOf(
    await practice(harness.args(['--state', stateFile, '--submit', '--expect-rejected']))
  )
  expect(submission).toMatchObject({
    action: 'submit',
    status: 409,
    code: 'SERVICE_MAINTENANCE',
    mode: 'maintenance'
  })
  // No practice was ever admitted in this test, so the submission half ran without a grant and says so.
  expect(submission.practiceRecorded).toBe(false)

  const normal = recordOf(
    await mode(harness.args(['--password-file', fixture.passwordFile, '--set', 'normal']))
  )
  expect(normal).toMatchObject({ status: 200, mode: 'normal', code: null, blockers: [] })

  const started = recordOf(
    await practice(
      harness.args([
        '--state',
        stateFile,
        '--exam-id',
        examId,
        '--archive-sha256',
        archiveSha256,
        '--grant-out',
        grantOut
      ])
    )
  )
  expect(started).toMatchObject({
    status: 201,
    code: null,
    numbering: expect.objectContaining({
      field: 'submissionId',
      serverCounter: false,
      reused: false,
      sameGrant: false
    })
  })
  const submissionId = started.submissionId
  expect(typeof submissionId).toBe('string')
  expect(recordOf(await readFileJson(grantOut)).submissionId).toBe(submissionId)

  // "Continuing the original numbering" is not a server counter: the practice is the submissionId the
  // client puts in the path, and repeating it returns the grant that already exists.
  const continued = recordOf(
    await practice(
      harness.args([
        '--state',
        stateFile,
        '--exam-id',
        examId,
        '--archive-sha256',
        archiveSha256,
        '--continuation'
      ])
    )
  )
  expect(continued).toMatchObject({
    status: 200,
    code: null,
    submissionId,
    archiveSha256Source: 'state',
    continuation: true,
    numbering: expect.objectContaining({
      field: 'submissionId',
      serverCounter: false,
      reused: true,
      sameGrant: true,
      submissionId
    })
  })

  // Entering maintenance is never blocked, and a stale revision is still a revision conflict: the
  // teacher client relies on both when it re-enters maintenance while devices are practicing.
  const reentered = recordOf(
    await mode(harness.args(['--password-file', fixture.passwordFile, '--set', 'maintenance']))
  )
  expect(reentered).toMatchObject({ status: 200, mode: 'maintenance', code: null, blockers: [] })
  const stale = recordOf(
    await mode(
      harness.args([
        '--password-file',
        fixture.passwordFile,
        '--set',
        'normal',
        '--expected-revision',
        '1'
      ])
    )
  )
  expect(stale).toMatchObject({ status: 409, code: 'REVISION_CONFLICT' })
  const current = recordOf(
    await mode(harness.args(['--password-file', fixture.passwordFile, '--read']))
  )
  expect(current.mode).toBe('maintenance')
  // Two accepted mode changes happened, so revision 1 is genuinely stale: the conflict is about the
  // revision, not about the mode.
  expect(current.modeRevision).not.toBe(1)
})

test('N10 an offline device lease keeps maintenance exit blocked until its 30 s expire', async () => {
  const { harness, passwordFile, deviceId } = fixture
  const teacher = await openTeacher(harness.args(['--password-file', passwordFile]), {
    passwordFile
  })
  const student = await openSession(harness.args(), 'student', fixture.token)
  try {
    // The lease is created by a deployment-test task, which only exists in maintenance. The run is
    // created and cancelled through the same command the VM phase script invokes.
    const created = recordOf(
      await testRun(harness.args(['--password-file', passwordFile, '--device-id', deviceId]))
    )
    expect(created).toMatchObject({
      action: 'create',
      status: 201,
      code: null,
      suiteId: 'ls101-lab-deployment'
    })
    const devices = created.devices
    expect(Array.isArray(devices)).toBe(true)
    const taskId = String(recordOf((devices as unknown[])[0]).taskId)
    expect(typeof created.runId).toBe('string')

    const runtimeId = randomUUID()
    expect(
      (
        await student.client.request<Schema<'HeartbeatResponse'>>('postStudentHeartbeat', {
          body: heartbeat(runtimeId)
        })
      ).heartbeatAccepted
    ).toBe(true)
    const lease = await student.client.request<Schema<'TaskLease'>>('postStudentTasksIdClaim', {
      path: { id: taskId },
      body: { runtimeId }
    })

    // The device stops answering: past DEVICE_OFFLINE_AFTER_MS it is offline, and it is the lease
    // deadline, not the device's presence, that the service can still reason about.
    harness.clock.advance(21000)
    const device = await teacher.client.request<Schema<'DeviceDetails'>>('getTeacherDevicesId', {
      path: { id: deviceId }
    })
    expect(device.online).toBe(false)
    const cancelled = recordOf(
      await testRun(
        harness.args(['--password-file', passwordFile, '--cancel', String(created.runId)])
      )
    )
    expect(cancelled).toMatchObject({
      action: 'cancel',
      runId: created.runId,
      status: 200,
      code: null
    })

    const leaseRow = harness.service.db.get<{ device_id: string; expires_at: number }>(
      'SELECT device_id,expires_at FROM task_leases WHERE id=?',
      lease.leaseId
    )
    expect(leaseRow?.device_id).toBe(deviceId)

    const blocked = recordOf(
      await maintenanceExit(
        harness.args(['--password-file', passwordFile, '--attempts', '2', '--interval-ms', '50'])
      )
    )
    // While the lease is alive every attempt is refused, and every refusal carries the same resource:
    // the VM run shows this as one blocked attempt after another, then a success.
    expect(blocked.attempted).toBe(2)
    const attempts = blocked.attempts
    expect(Array.isArray(attempts)).toBe(true)
    for (const attempt of attempts as unknown[]) {
      const seen = recordOf(attempt)
      expect(seen.status).toBe(409)
      expect(seen.code).toBe('RESOURCE_BUSY')
      expect(Number.isNaN(Date.parse(String(seen.at)))).toBe(false)
      // The blocker names the lease; the lease row is what names the offline device. Both halves are
      // asserted, because the wire format only carries the resource id.
      expect(seen.blockers).toContainEqual({
        kind: 'active-task-lease',
        resourceId: lease.leaseId
      })
    }
    expect(recordOf(blocked.final).code).toBe('RESOURCE_BUSY')
    expect(
      recordOf(await mode(harness.args(['--password-file', passwordFile, '--read']))).mode
    ).toBe('maintenance')

    harness.clock.advance(10000)
    const exited = recordOf(
      await maintenanceExit(
        harness.args(['--password-file', passwordFile, '--attempts', '2', '--interval-ms', '50'])
      )
    )
    // One attempt is enough once the lease is gone, so the loop must not spend the second one.
    expect(exited.attempted).toBe(1)
    expect(recordOf(exited.final)).toMatchObject({
      status: 200,
      mode: 'normal',
      code: null,
      blockers: []
    })
  } finally {
    await student.close()
    await teacher.close()
  }
})

test('N9 the upload ceiling answers 429 RATE_LIMITED and the handler ceiling 503 SERVICE_NOT_READY', async () => {
  const { harness, stateFile, examId, archiveSha256 } = fixture
  const normal = recordOf(
    await mode(harness.args(['--password-file', fixture.passwordFile, '--set', 'normal']))
  )
  expect(normal.status).toBe(200)
  const started = recordOf(
    await practice(
      harness.args(['--state', stateFile, '--exam-id', examId, '--archive-sha256', archiveSha256])
    )
  )
  expect(started.status).toBe(201)
  // The recorded practice makes `--submit` a real submission rather than a placeholder, which is what
  // the maintenance refusal alone cannot show.
  const submitted = recordOf(await practice(harness.args(['--state', stateFile, '--submit'])))
  expect(submitted).toMatchObject({ status: 201, code: null, practiceRecorded: true })
  expect(recordOf(submitted.receipt).receiptId).toBeTruthy()

  const uploads = recordOf(
    await concurrency(
      harness.args([
        '--state',
        stateFile,
        '--kind',
        'uploads',
        '--count',
        '12',
        '--keepalive-seconds',
        '1'
      ])
    )
  )
  expect(uploads.kind).toBe('uploads')
  expect(uploads.count).toBe(12)
  expect(uploads.transportErrors).toBe(0)
  expect(countIn(uploads.statuses, '429')).toBeGreaterThanOrEqual(1)
  expect(countIn(uploads.codes, 'RATE_LIMITED')).toBeGreaterThanOrEqual(1)
  // A device may hold one submission upload at a time, so exactly one of the twelve is admitted and
  // the rest are refused with RATE_LIMITED; the service-wide ceiling of eight needs nine devices,
  // which one state file cannot produce.
  expect(countIn(uploads.statuses, '201')).toBe(1)
  expect(countIn(uploads.codes, 'RATE_LIMITED')).toBe(11)
  expect(totalCount(uploads.statuses)).toBe(12)

  const handlers = recordOf(
    await concurrency(
      harness.args([
        '--state',
        stateFile,
        '--kind',
        'handlers',
        '--count',
        '80',
        '--keepalive-seconds',
        '1'
      ])
    )
  )
  expect(handlers.kind).toBe('handlers')
  expect(handlers.count).toBe(80)
  expect(handlers.transportErrors).toBe(0)
  // The handler ceiling is 64: the first 64 requests hold a handler, and every later one is refused
  // before routing. The counts are exact because `http.ts` checks the live handler set synchronously.
  expect(countIn(handlers.statuses, '200')).toBe(64)
  expect(countIn(handlers.statuses, '503')).toBe(16)
  expect(countIn(handlers.codes, 'SERVICE_NOT_READY')).toBe(16)
  expect(totalCount(handlers.statuses)).toBe(80)
})

async function readFileJson(file: string): Promise<Record<string, unknown>> {
  return recordOf(JSON.parse(await readFile(file, 'utf8')))
}
