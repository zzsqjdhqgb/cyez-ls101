/*
 * N7 in-container proof of the exam → submission chain (docs/lab-vm-acceptance-design.md, section 6).
 *
 * The VM runs each step as a separate process against the installed service; here the same command
 * modules run in-process against the real `LabService` and real TLS on loopback, which is what can be
 * checked without a VM. Every command still opens its own pinned connection, so the re-upload below
 * goes over a connection the first upload never used — the cross-process part is the phase script's,
 * and this suite is what keeps that phase script from being the first place the flow is executed.
 *
 * What is asserted is the part unit tests cannot reach: the digest is recomputed from the bytes on
 * disk independently of the transport's own hash, a different archive for a submission that already
 * has one is refused with CONTENT_CONFLICT, an archive carrying another submission's id is refused
 * with INVALID_SUBMISSION, the teacher's download still hashes to the uploaded digest, and the
 * original receipt is still answerable after the teacher deleted the submission.
 *
 * The identical re-upload is covered separately at the bottom, because the service's replay answer
 * does not survive the trip back to the client for an archive of any real size. That test documents
 * the observed behaviour; it is a defect tripwire, not an accepted design.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'
import { decodeExamPackage } from '@ls101/exam-package'
import type { Schema } from '@ls101/lab-contracts'
import { errorOf, openSession, openTeacher, sha256Hex, writeState } from './context'
import { HARNESS_PASSWORD, installationId, startHarness, type Harness } from './harness'
import {
  examFetch,
  examList,
  examPublish,
  type ExamFetchReport,
  type ExamListReport,
  type ExamPublishReport
} from './commands/exam'
import {
  buildSubmissionArchive,
  submissionDelete,
  submissionDownload,
  submissionReceipt,
  submissionUpload,
  taskClaim,
  taskLease,
  type SubmissionDeleteReport,
  type SubmissionDownloadReport,
  type SubmissionReceiptReport,
  type SubmissionUploadReport,
  type TaskClaimReport,
  type TaskLeaseReport
} from './commands/submission'

const EXAM_TITLE = 'N7 验收试卷'
const CANDIDATE = { candidateId: '1001', displayName: '验收考生' }
// The VM passes `--resource-bytes` and `--recording-bytes` in the tens of megabytes, which is the
// same code path with more bytes in it. Both are random on purpose: a compressible filler would
// deflate away and the "large archive" case would stop exercising a large transfer.
const EXAM_RESOURCE_BYTES = 64 * 1024
const RECORDING_BYTES = 300 * 1024
// A rejection answered while the client is still sending is only observable when the request body
// fits in the socket buffers, because the service answers those paths before reading the body (see
// the tripwire test at the bottom). The negative cases below are therefore deliberately small; their
// subject is the error code, not the transfer size.
const NEGATIVE_RECORDING_BYTES = 512

let harness: Harness | undefined
afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/*
 * A real registration: the teacher issues an enrollment, a public connection registers a device with
 * its secret, and the device state file carries the credentials the later student commands use. The
 * enrollment forces the service into maintenance, so the device is registered and the enrollment
 * closed before the mode is put back to normal — the practice flow only runs in normal mode.
 */
async function registerDevice(h: Harness): Promise<{ file: string }> {
  const passwordFile = await h.secret('teacher', HARNESS_PASSWORD)
  const teacher = await openTeacher(h.args(['--password-file', passwordFile]), { passwordFile })
  try {
    const enrollment = await teacher.client.request<Schema<'EnrollmentCreated'>>(
      'postTeacherEnrollments',
      { body: { expectedModeRevision: 1, validForSeconds: 600 }, idempotencyKey: randomUUID() }
    )
    const file = await teacher.client.request<{ handle: string }>('getTeacherEnrollmentsIdFile', {
      path: { id: enrollment.enrollment.id }
    })
    const enrollmentFile = await readFile(
      teacher.transport.file(file.handle, teacher.connectionId),
      'utf8'
    )
    const installation = installationId()
    const deviceSecret = randomBytes(32).toString('base64url')
    const publicSession = await openSession(h.args(), 'public')
    let registered: { deviceId: string; deviceNumber: string }
    try {
      const response = await publicSession.transport.request(
        publicSession.connectionId,
        'putEnrollmentDevicesInstallationId',
        {
          path: { installationId: installation },
          body: {
            enrollmentFile,
            deviceSecret,
            computerName: 'protocol-harness',
            platform: process.platform === 'win32' ? 'win32' : 'linux',
            releaseVersion: h.version
          }
        }
      )
      if (response.status >= 400)
        throw new Error(`device registration was rejected: ${errorOf(response).code}`)
      registered = response.body as { deviceId: string; deviceNumber: string }
    } finally {
      await publicSession.close()
    }
    await teacher.client.request('deleteTeacherEnrollmentsId', {
      path: { id: enrollment.enrollment.id }
    })
    await teacher.client.request('putTeacherServiceMode', {
      body: { mode: 'normal', expectedRevision: enrollment.modeRevision }
    })
    const stateFile = h.path('device.json')
    await writeState(stateFile, {
      installationId: installation,
      deviceId: registered.deviceId,
      number: registered.deviceNumber,
      deviceSecret,
      token: `d.${registered.deviceId}.${deviceSecret}`,
      releaseVersion: h.version
    })
    return { file: stateFile }
  } finally {
    await teacher.close()
  }
}

async function setMode(
  h: Harness,
  passwordFile: string,
  mode: 'normal' | 'maintenance'
): Promise<void> {
  const teacher = await openTeacher(h.args(['--password-file', passwordFile]), { passwordFile })
  try {
    const service = await teacher.client.request<{ modeRevision: number }>('getTeacherService')
    await teacher.client.request('putTeacherServiceMode', {
      body: { mode, expectedRevision: service.modeRevision }
    })
  } finally {
    await teacher.close()
  }
}

test('N7 exam publication, streamed fetch, submission upload, download and receipt survival', async () => {
  const h = await startHarness()
  harness = h
  const device = await registerDevice(h)
  const passwordFile = await h.secret('teacher', HARNESS_PASSWORD)

  // Publication. `--state` asks the service the same question a student asks, so the report proves
  // the exam is visible rather than merely stored.
  const published = (await examPublish(
    h.args([
      '--password-file',
      passwordFile,
      '--out',
      h.path('mirror'),
      '--title',
      EXAM_TITLE,
      '--resource-bytes',
      String(EXAM_RESOURCE_BYTES),
      '--publish',
      '--state',
      device.file
    ])
  )) as ExamPublishReport
  expect(published.status).toBe(201)
  expect(published.code).toBeNull()
  expect(published.published).toBe(true)
  expect(published.duplicate).toBe(false)
  expect(published.reused).toBe(false)
  expect(published.patchStatus).toBe(200)
  expect(published.visible?.source).toBe('student-session')
  expect(published.visible?.listed).toBe(true)
  expect(published.visible?.items.map((item) => item.examId)).toEqual([published.examId])
  expect(published.visible?.items[0]).toMatchObject({
    packageId: published.packageId,
    title: EXAM_TITLE,
    published: true,
    revision: published.revision
  })
  const examId = published.examId!

  // The student-visible list is what a student caches before practising.
  const listed = (await examList(h.args(['--state', device.file]))) as ExamListReport
  expect(listed.status).toBe(200)
  expect(listed.code).toBeNull()
  expect(listed.items).toHaveLength(1)
  expect(listed.items[0]).toMatchObject({
    examId,
    packageId: published.packageId,
    title: EXAM_TITLE,
    published: true,
    archiveSha256: published.sha256
  })

  // The streamed download is verified twice: by the transport against the digest the service
  // declared while it wrote, and by the driver re-reading the written file.
  const fetchedFile = h.path('fetched.lsexam')
  const fetched = (await examFetch(
    h.args(['--state', device.file, '--exam-id', examId, '--out', fetchedFile])
  )) as ExamFetchReport
  expect(fetched.status).toBe(200)
  expect(fetched.code).toBeNull()
  expect(fetched.bytes).toBe(published.bytes)
  expect(fetched.transportSha256).toBe(published.sha256)
  expect(fetched.sha256).toBe(published.sha256)
  expect(fetched.digestsMatch).toBe(true)
  expect(fetched.decodeError).toBeNull()
  expect(fetched.decoded).toEqual({
    packageId: published.packageId,
    title: EXAM_TITLE,
    resourceCount: 1
  })
  expect(sha256Hex(await readFile(fetchedFile))).toBe(published.sha256)

  const { exam } = await decodeExamPackage(await readFile(fetchedFile))

  // Start grant. The claimed digest is the one the fetch proved, which is what a real client does.
  const grantFile = h.path('grant.json')
  const claimed = (await taskClaim(
    h.args([
      '--state',
      device.file,
      '--exam-id',
      examId,
      '--archive-sha256',
      published.sha256,
      '--candidate-name',
      CANDIDATE.displayName,
      '--candidate-number',
      CANDIDATE.candidateId,
      '--out',
      grantFile
    ])
  )) as TaskClaimReport
  expect(claimed.status).toBe(201)
  expect(claimed.code).toBeNull()
  expect(claimed.grantState).toBe('granted')
  expect(claimed.examDigestMatch).toBe(true)
  expect(claimed.packageId).toBe(published.packageId)
  expect(claimed.candidate).toEqual(CANDIDATE)
  expect(Date.parse(claimed.startBefore!)).toBeGreaterThan(Date.parse(claimed.grantedAt!))
  const submissionId = claimed.submissionId!

  // Negative: a structurally valid submission archive carrying a different submissionId must be
  // attributed to the submission, not accepted as a second one.
  const foreignFile = h.path('foreign.lssubmission')
  await buildSubmissionArchive({
    file: foreignFile,
    exam,
    submissionId: randomUUID(),
    candidate: claimed.candidate,
    startedAt: claimed.startedAt,
    recordingBytes: NEGATIVE_RECORDING_BYTES
  })
  const foreign = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      grantFile,
      '--submission-file',
      foreignFile,
      '--out',
      h.path('foreign-state.json')
    ])
  )) as SubmissionUploadReport
  expect(foreign.status).toBe(422)
  expect(foreign.code).toBe('INVALID_SUBMISSION')
  expect(foreign.receipt).toBeNull()

  // The real submission: a few hundred KB of recording, uploaded in one PUT.
  const archiveFile = h.path('answer.lssubmission')
  const uploaded = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      grantFile,
      '--submission-file',
      archiveFile,
      '--recording-bytes',
      String(RECORDING_BYTES),
      '--out',
      h.path('upload.json')
    ])
  )) as SubmissionUploadReport
  expect(uploaded.status).toBe(201)
  expect(uploaded.code).toBeNull()
  expect(uploaded.reused).toBe(false)
  expect(uploaded.examSource).toBe('service')
  expect(uploaded.packageId).toBe(published.packageId)
  expect(uploaded.digestsMatch).toBe(true)
  expect(uploaded.transportSha256).toBe(uploaded.archiveSha256)
  expect(uploaded.archiveBytes).toBeGreaterThan(RECORDING_BYTES)
  expect(sha256Hex(await readFile(archiveFile))).toBe(uploaded.archiveSha256)
  expect(uploaded.uploadReceiptState).toBe('received')
  expect(uploaded.uploadReceipt?.submissionId).toBe(submissionId)
  expect(uploaded.receiptState).toBe('received')
  expect(uploaded.receipt).toEqual(uploaded.uploadReceipt)

  // The receipt is also answerable on its own, which is the operation a client retries with when it
  // does not know whether its upload arrived.
  const receiptQuery = (await submissionReceipt(
    h.args(['--state', device.file, '--submission-id', submissionId])
  )) as SubmissionReceiptReport
  expect(receiptQuery.status).toBe(200)
  expect(receiptQuery.receiptState).toBe('received')
  expect(receiptQuery.receipt).toEqual(uploaded.receipt)

  // Negative: a different archive for a submission that already has one.
  const differentFile = h.path('different.lssubmission')
  await buildSubmissionArchive({
    file: differentFile,
    exam,
    submissionId,
    candidate: claimed.candidate,
    startedAt: claimed.startedAt,
    submittedAt: new Date(Date.parse(uploaded.submittedAt!) + 60000).toISOString(),
    recordingBytes: NEGATIVE_RECORDING_BYTES
  })
  const conflict = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      grantFile,
      '--submission-file',
      differentFile,
      '--out',
      h.path('conflict-state.json')
    ])
  )) as SubmissionUploadReport
  expect(conflict.status).toBe(409)
  expect(conflict.code).toBe('CONTENT_CONFLICT')
  expect(conflict.archiveSha256).not.toBe(uploaded.archiveSha256)

  // The teacher's download is decoded and hashed again from the file that was written, so the value
  // asserted here does not come from the transport that produced it.
  const downloadFile = h.path('downloaded.lssubmission')
  const downloaded = (await submissionDownload(
    h.args([
      '--password-file',
      passwordFile,
      '--submission-id',
      submissionId,
      '--out',
      downloadFile
    ])
  )) as SubmissionDownloadReport
  expect(downloaded.status).toBe(200)
  expect(downloaded.code).toBeNull()
  expect(downloaded.decoded).toMatchObject({
    submissionId,
    packageId: published.packageId,
    candidate: CANDIDATE,
    submittedAt: uploaded.submittedAt
  })
  expect(downloaded.decodeError).toBeNull()
  expect(downloaded.bytes).toBe(uploaded.archiveBytes)
  expect(downloaded.transportSha256).toBe(uploaded.archiveSha256)
  expect(downloaded.sha256).toBe(uploaded.archiveSha256)
  expect(downloaded.digestsMatch).toBe(true)
  expect(sha256Hex(await readFile(downloadFile))).toBe(uploaded.archiveSha256)

  const deleted = (await submissionDelete(
    h.args(['--password-file', passwordFile, '--submission-id', submissionId])
  )) as SubmissionDeleteReport
  expect(deleted.status).toBe(204)
  expect(deleted.deleted).toBe(true)

  // The archive is gone for the teacher...
  const goneDownload = (await submissionDownload(
    h.args([
      '--password-file',
      passwordFile,
      '--submission-id',
      submissionId,
      '--out',
      h.path('deleted.lssubmission')
    ])
  )) as SubmissionDownloadReport
  expect(goneDownload.status).toBe(404)
  expect(goneDownload.code).toBe('NOT_FOUND')
  expect(goneDownload.sha256).toBeNull()

  // ...but the original receipt still comes back, with the tombstone recorded.
  const afterDelete = (await submissionReceipt(
    h.args(['--state', device.file, '--submission-id', submissionId])
  )) as SubmissionReceiptReport
  expect(afterDelete.status).toBe(200)
  expect(afterDelete.code).toBeNull()
  expect(afterDelete.receiptState).toBe('deleted')
  expect(afterDelete.receipt).toEqual(uploaded.receipt)
  expect(typeof afterDelete.deletedAt).toBe('string')

  // The identical re-upload, on its own grant so it is independent of the deleted submission above.
  // Its archive is small on purpose: the service answers a replay before reading the request body,
  // and only a body that fits in the socket buffers is guaranteed to get that answer back (see the
  // defect test at the bottom). What this proves is the service's idempotency: the same bytes twice
  // answer with the stored receipt, and no second submission appears.
  const smallGrantFile = h.path('grant-small.json')
  const smallClaim = (await taskClaim(
    h.args([
      '--state',
      device.file,
      '--exam-id',
      examId,
      '--archive-sha256',
      published.sha256,
      '--candidate-name',
      CANDIDATE.displayName,
      '--candidate-number',
      CANDIDATE.candidateId,
      '--out',
      smallGrantFile
    ])
  )) as TaskClaimReport
  expect(smallClaim.grantState).toBe('granted')
  const smallArchiveFile = h.path('small.lssubmission')
  const smallFirst = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      smallGrantFile,
      '--submission-file',
      smallArchiveFile,
      '--recording-bytes',
      String(NEGATIVE_RECORDING_BYTES),
      '--out',
      h.path('small-upload.json')
    ])
  )) as SubmissionUploadReport
  expect(smallFirst.status).toBe(201)
  expect(smallFirst.uploadReceiptState).toBe('received')
  const smallAgain = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      smallGrantFile,
      '--submission-file',
      smallArchiveFile,
      '--out',
      h.path('small-upload-again.json')
    ])
  )) as SubmissionUploadReport
  expect(smallAgain.status).toBe(200)
  expect(smallAgain.code).toBeNull()
  expect(smallAgain.connectionId).not.toBe(smallFirst.connectionId)
  expect(smallAgain.reused).toBe(true)
  expect(smallAgain.archiveSha256).toBe(smallFirst.archiveSha256)
  expect(smallAgain.uploadReceipt).toEqual(smallFirst.uploadReceipt)
  expect(smallAgain.receipt).toEqual(smallFirst.receipt)

  // A receipt query for a submission this device never claimed answers 404, which is an observation
  // the case needs as data: the driver must not turn it into a failure of its own.
  const unknownReceipt = (await submissionReceipt(
    h.args(['--state', device.file, '--submission-id', randomUUID()])
  )) as SubmissionReceiptReport
  expect(unknownReceipt.status).toBe(404)
  expect(unknownReceipt.code).toBe('NOT_FOUND')
  expect(unknownReceipt.receipt).toBeNull()
  expect(unknownReceipt.receiptState).toBeNull()
})

test('N7 task lease reaches the service task path and reports its refusals', async () => {
  const h = await startHarness()
  harness = h
  const device = await registerDevice(h)
  const passwordFile = await h.secret('teacher', HARNESS_PASSWORD)
  const leaseFile = h.path('lease.json')
  const taskId = randomUUID()
  const runtimeId = randomUUID()

  // The task claim/lease path only exists in maintenance mode: while the room is working the service
  // refuses before the task is even looked up, which is the coupling N10 is about.
  const working = (await taskLease(
    h.args([
      '--state',
      device.file,
      '--task-id',
      taskId,
      '--runtime-id',
      runtimeId,
      '--lease-file',
      leaseFile
    ])
  )) as TaskLeaseReport
  expect(working.action).toBe('claim')
  expect(working.status).toBe(409)
  expect(working.code).toBe('RESOURCE_BUSY')

  await setMode(h, passwordFile, 'maintenance')
  // No deployment test carries this id, so the service is expected to reject the claim: the point is
  // that the command reaches the real handler and reports exactly what it answers.
  const missing = (await taskLease(
    h.args([
      '--state',
      device.file,
      '--task-id',
      taskId,
      '--runtime-id',
      runtimeId,
      '--lease-file',
      leaseFile
    ])
  )) as TaskLeaseReport
  expect(missing.action).toBe('claim')
  expect(missing.status).toBe(404)
  expect(missing.code).toBe('NOT_FOUND')
  expect(missing.lease).toBeNull()
})

/*
 * DEFECT, first observed here on 2026-09-17: an identical re-upload of an archive that is still
 * being written only *sometimes* delivers the service's `200` + stored receipt.
 *
 * `putStudentSubmissionsSubmissionId` answers the replay without ever reading `context.stream`, so
 * the response finishes while the request body is still in flight; the server then closes a
 * connection whose receive buffer still holds unread bytes, the peer resets it, and the response is
 * discarded before the client parses it. The driver sees `write EPIPE` and no HTTP status at all.
 *
 * Measured against the real service by sweeping the body size three times each (`status: 0` means no
 * HTTP response reached the client):
 *   2 KiB 3/3 delivered · 64 KiB 3/3 · 256 KiB 1/3 · 1 MiB 2/3 · 4 MiB 1/3.
 * A control run with a handler that drains `context.stream` before answering delivered the receipt
 * every time, so the cause is the unconsumed body rather than the transport or the loopback link.
 *
 * The same shape affects *any* early answer, including the CONTENT_CONFLICT rejection, which is why
 * the negative cases and the idempotency proof in the main test use small archives. A phase script
 * must therefore read a re-upload that reports `status: 0` as this defect, not as a driver failure:
 * the submission itself is always intact, only the answer is lost. When the service drains the replay
 * before answering, the `status: 0` branch below becomes unreachable and every attempt must report
 * `200` with the byte-identical original receipt.
 */
test('N7 an identical large re-upload returns the original receipt every time', async () => {
  const h = await startHarness()
  harness = h
  const device = await registerDevice(h)
  const passwordFile = await h.secret('teacher', HARNESS_PASSWORD)
  const published = (await examPublish(
    h.args([
      '--password-file',
      passwordFile,
      '--out',
      h.path('mirror'),
      '--title',
      EXAM_TITLE,
      '--publish'
    ])
  )) as ExamPublishReport
  expect(published.status).toBe(201)
  // The VM phase publishes without a device state, so the report falls back to the teacher's
  // published projection — the same rows `getStudentExams` returns — and says so.
  expect(published.visible?.source).toBe('teacher-published-projection')
  expect(published.visible?.listed).toBe(true)
  const examId = published.examId!
  const grantFile = h.path('grant.json')
  const claimed = (await taskClaim(
    h.args([
      '--state',
      device.file,
      '--exam-id',
      examId,
      '--archive-sha256',
      published.sha256,
      '--candidate-name',
      CANDIDATE.displayName,
      '--candidate-number',
      CANDIDATE.candidateId,
      '--out',
      grantFile
    ])
  )) as TaskClaimReport
  expect(claimed.grantState).toBe('granted')
  const submissionId = claimed.submissionId!

  const archiveFile = h.path('answer.lssubmission')
  const first = (await submissionUpload(
    h.args([
      '--state',
      device.file,
      '--grant',
      grantFile,
      '--submission-file',
      archiveFile,
      '--recording-bytes',
      String(4 * 1024 * 1024),
      '--out',
      h.path('upload.json')
    ])
  )) as SubmissionUploadReport
  expect(first.status).toBe(201)
  expect(first.receiptState).toBe('received')

  // The same bytes again, each time on a connection the previous upload never used.
  //
  // This used to be a tripwire rather than a test: the server compared the digest header and answered
  // with the stored receipt *without reading the archive*, so its response finished while the client was
  // still sending, the socket was reset, and the shipped transport reported `write EPIPE` instead of the
  // answer. Measured at the time: 2 KiB 3/3 delivered, 256 KiB 1/3, 4 MiB 1/3. The server now drains the
  // body before answering, so every attempt has to deliver the original receipt.
  //
  // Five attempts at 4 MiB: with the defect present roughly two thirds of the attempts lost the answer,
  // so a regression cannot pass this by luck (five delivered answers without the drain are about a one
  // in 250 event, against roughly one in three with three attempts at 1 MiB).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const again = (await submissionUpload(
      h.args([
        '--state',
        device.file,
        '--grant',
        grantFile,
        '--submission-file',
        archiveFile,
        '--out',
        h.path(`upload-again-${attempt}.json`)
      ])
    )) as SubmissionUploadReport
    expect(again.reused).toBe(true)
    expect(again.archiveSha256).toBe(first.archiveSha256)
    expect(again.connectionId).not.toBe(first.connectionId)
    expect(again.status).toBe(200)
    expect(again.code).toBeNull()
    expect(again.uploadReceipt).toEqual(first.uploadReceipt)
  }

  // The record itself is untouched either way: one submission, one digest, the original receipt.
  const receipt = (await submissionReceipt(
    h.args(['--state', device.file, '--submission-id', submissionId])
  )) as SubmissionReceiptReport
  expect(receipt.status).toBe(200)
  expect(receipt.receiptState).toBe('received')
  expect(receipt.receipt).toEqual(first.receipt)
})
