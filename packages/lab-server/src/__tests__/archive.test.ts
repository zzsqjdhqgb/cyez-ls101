import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeExamPackage, encodeSubmissionPackage } from '@ls101/exam-package'
import type { ExamPackage, SubmissionPackage } from '@ls101/core-types'
import type { OperationId } from '@ls101/lab-contracts'
import { LabService, type Context } from '../service'
import { hash } from '../identity'
import type { Principal } from '../security'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const exam: ExamPackage = {
  format: 'ls101-exam',
  formatVersion: 1,
  packageId: 'test-exam',
  examData: {
    title: 'Practice',
    player: {
      pages: [{ id: 'one', content: [], timeline: [{ type: 'countdown', seconds: 1 }] }],
      recordingIndices: []
    },
    resources: {}
  },
  answerCapturePlan: { strings: [], audios: [] },
  submissionTemplate: {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: { examPackageId: 'test-exam', examTitle: 'Practice' },
    schemaUses: [],
    resources: {}
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ls101-archive-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const service = await LabService.initialize(
    { root, releaseVersion: 'test', isLicenseActive: () => true },
    { name: 'Lab', baseUrl: 'https://127.0.0.1:8443/', password: 'secret' }
  )
  cleanups.push(() => service.db.close())
  const session = await service.security.login({ password: 'secret' })
  const teacher = service.security.authenticate(session.token, 'teacher')
  const deviceId = randomUUID(),
    secret = randomBytes(32).toString('base64url')
  let credentialId = ''
  service.db.transaction(() => {
    service.db.run(
      'INSERT INTO devices VALUES (?,?,?,?)',
      deviceId,
      randomUUID(),
      '001',
      JSON.stringify({
        id: deviceId,
        number: '001',
        room: null,
        seat: null,
        displayName: null,
        enabled: true,
        revision: 1,
        computerName: 'test',
        platform: 'linux',
        registeredAt: service.timestamp()
      })
    )
    credentialId = service.security.createDeviceCredential(deviceId, secret)
    service.saveData({ ...service.data(), mode: 'normal', modeRevision: 2 })
  })
  const student: Principal = { role: 'student', deviceId, credentialId, hash: hash(secret) }
  const context = (
    id: OperationId,
    principal: Principal,
    body?: unknown,
    path: Record<string, string> = {},
    bytes?: Uint8Array
  ): Context => ({
    id,
    principal,
    body,
    path,
    query: {},
    headers: {
      ...(bytes
        ? { 'content-length': String(bytes.length), 'x-ls101-archive-sha256': hash(bytes) }
        : {})
    },
    version: 'test',
    loopback: true,
    signal: new AbortController().signal,
    ...(bytes
      ? {
          stream: (async function* () {
            yield bytes
          })()
        }
      : {})
  })
  const examBytes = await encodeExamPackage(exam, {})
  const uploaded = await service.handlers.postTeacherExams!(
    context('postTeacherExams', teacher, undefined, {}, examBytes)
  )
  const examId = (uploaded.body as { examId: string }).examId
  const submissionId = randomUUID(),
    candidate = { candidateId: '001', displayName: 'Student' }
  await service.handlers.putStudentPracticesSubmissionId!(
    context(
      'putStudentPracticesSubmissionId',
      student,
      { examId, archiveSha256: hash(examBytes), candidate },
      { submissionId }
    )
  )
  const submission: SubmissionPackage = {
    ...exam.submissionTemplate,
    meta: {
      ...exam.submissionTemplate.meta,
      submissionId,
      candidate,
      startedAt: service.timestamp(),
      submittedAt: service.timestamp()
    },
    answers: { strings: [], audios: [] }
  }
  const bytes = await encodeSubmissionPackage(submission, {})
  const upload = () =>
    service.handlers.putStudentSubmissionsSubmissionId!(
      context('putStudentSubmissionsSubmissionId', student, undefined, { submissionId }, bytes)
    )
  const receipt = () =>
    service.handlers.getStudentSubmissionsSubmissionIdReceipt!(
      context('getStudentSubmissionsSubmissionIdReceipt', student, undefined, { submissionId })
    )
  return { service, teacher, student, context, upload, receipt, submissionId, bytes }
}

describe('durable submission commit', () => {
  it('preserves the original receipt through duplicate upload and teacher deletion', async () => {
    const f = await fixture()
    const first = await f.upload()
    expect(first.status).toBe(201)
    expect((await f.upload()).body).toEqual(first.body)
    await f.service.handlers.deleteTeacherSubmissionsId!(
      f.context('deleteTeacherSubmissionsId', f.teacher, undefined, { id: f.submissionId })
    )
    const deleted = await f.receipt()
    expect(deleted.body).toMatchObject({ status: 'deleted', receipt: (first.body as any).receipt })
    expect((await f.upload()).body).toEqual(deleted.body)
    expect(
      f.service.db.get<{ count: number }>('SELECT COUNT(*) count FROM submissions')!.count
    ).toBe(1)
  })

  it('maintenance committed before final archive commit prevents receipt creation', async () => {
    const f = await fixture()
    f.service.options.fault = async (point) => {
      if (point === 'upload-file-published') {
        await f.service.handlers.putTeacherServiceMode!(
          f.context('putTeacherServiceMode', f.teacher, {
            mode: 'maintenance',
            expectedRevision: 2
          })
        )
      }
    }
    await expect(f.upload()).rejects.toMatchObject({ code: 'SERVICE_MAINTENANCE' })
    expect(f.service.db.get('SELECT id FROM submissions')).toBeUndefined()
    expect(f.service.db.get('SELECT id FROM uploads')).toBeUndefined()
    expect(f.service.db.get('SELECT path FROM file_gc')).toBeDefined()
    f.service.options.fault = undefined
    await f.service.handlers.putTeacherServiceMode!(
      f.context('putTeacherServiceMode', f.teacher, { mode: 'normal', expectedRevision: 3 })
    )
    expect((await f.receipt()).body).toEqual({ status: 'not-received' })
    expect((await f.upload()).status).toBe(201)
  })

  it('response loss after commit is resolved by querying the original receipt', async () => {
    const f = await fixture()
    f.service.options.fault = (point) => {
      if (point === 'upload-committed') throw new Error('response lost')
    }
    await expect(f.upload()).rejects.toThrow('response lost')
    expect((await f.receipt()).body).toMatchObject({ status: 'received' })
    f.service.options.fault = undefined
    expect((await f.upload()).status).toBe(200)
  })
})
