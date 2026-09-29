import { afterEach, expect, it, vi } from 'vitest'
import type { Schema } from '@ls101/lab-contracts'
import type { StudentRecord } from '@ls101/lab-desktop-host'
import { StudentController } from '../controller'
import { binding, fakeHost } from './practice-fixture'
import { mixedArchive, objectiveArchive } from './objective-fixture'

const exam = {
  examId: '9b2f5c1e-6a34-4d0b-8f21-7c5e0d9a1b23',
  packageId: 'package',
  title: '客观题练习',
  archiveSha256: 'a'.repeat(64),
  archiveBytes: 100,
  pageCount: 1,
  resourceCount: 0
}
const candidate = { displayName: '学生', candidateId: '001' }
// 回执契约要求 deviceId 是 UUID；练习夹具里的 'device' 无法通过响应校验。
const labBinding = { ...binding, deviceId: crypto.randomUUID() }
const controllers: StudentController[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()))
})

/** 模拟主进程 records.* 的最小语义：begin/finish 落盘，cas 递增 revision。 */
function recordStore() {
  const records = new Map<string, StudentRecord>()
  const handles = new Map<string, string>()
  let revision = 0
  return {
    list: () => [...records.values()],
    begin(handle: string, intent: { submissionId: string }, sha256: string, bytes: number) {
      const record: StudentRecord = {
        schemaVersion: 1,
        revision: ++revision,
        submissionId: intent.submissionId,
        originalBinding: labBinding,
        examId: exam.examId,
        candidate,
        submittedAt: new Date().toISOString(),
        archiveSha256: sha256,
        archiveBytes: bytes,
        state: 'queued',
        attemptId: null,
        attemptCount: 0,
        resultKnowledge: 'never-sent',
        retryPolicy: 'automatic-first',
        pauseReason: null,
        lastError: null,
        receipt: null,
        completedAt: null,
        archivePresent: false
      }
      records.set(record.submissionId, record)
      handles.set(handle, record.submissionId)
    },
    finish(handle: string) {
      const id = handles.get(handle)
      const record = id ? records.get(id) : undefined
      if (record && id) records.set(id, { ...record, archivePresent: true })
    },
    cas(value: StudentRecord): StudentRecord {
      const current = records.get(value.submissionId)
      if (!current || current.revision !== value.revision) throw new Error('CAS conflict')
      const next = structuredClone({ ...value, revision: value.revision + 1 })
      records.set(value.submissionId, next)
      return next
    },
    get: (id: string) => records.get(id)
  }
}

function receipt(record: StudentRecord) {
  return {
    status: 200,
    body: {
      status: 'received',
      receipt: {
        receiptId: crypto.randomUUID(),
        serverId: labBinding.serverId,
        deviceId: labBinding.deviceId,
        submissionId: record.submissionId,
        archiveSha256: record.archiveSha256,
        receivedAt: new Date().toISOString()
      }
    } satisfies Schema<'CompletedReceipt'>
  }
}

type UploadGate = { wait(): Promise<void>; release(): void }

function gatedUpload(): UploadGate {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  let open = true
  return {
    wait: () => (open ? wait : Promise.resolve()),
    release: () => {
      open = false
      release()
    }
  }
}

function setup(upload?: UploadGate) {
  const store = recordStore()
  const { host, invoke } = fakeHost(() => labBinding)
  const original = invoke.getMockImplementation()!
  invoke.mockImplementation(async (capability: string, input: unknown) => {
    if (capability === 'cache.prepare') return 'ls101-exam://practice/'
    if (capability === 'records.begin') {
      const value = input as {
        intent: { submissionId: string }
        sha256: string
        bytes: number
      }
      const handle = `handle-${crypto.randomUUID()}`
      store.begin(handle, value.intent, value.sha256, value.bytes)
      return handle
    }
    if (capability === 'records.chunk') return null
    if (capability === 'records.finish') {
      store.finish((input as { handle: string }).handle)
      return null
    }
    if (capability === 'records.list') return store.list()
    if (capability === 'records.cas') return store.cas(input as StudentRecord)
    if (capability === 'records.uploadHandle') {
      const record = store.get((input as { id: string }).id)!
      return { handle: 'upload-handle', sha256: record.archiveSha256, bytes: record.archiveBytes }
    }
    if (capability === 'transport.request') {
      const request = input as { operationId: string; input: { path?: { submissionId: string } } }
      if (request.operationId === 'getStudentExamsExamIdArchive')
        return { status: 200, archive: { handle: 'archive', sha256: exam.archiveSha256, bytes: 100 } }
      if (request.operationId === 'putStudentPracticesSubmissionId')
        return {
          status: 200,
          body: {
            submissionId: request.input.path!.submissionId,
            modeRevision: 1,
            grantedAt: new Date().toISOString(),
            startBefore: new Date(Date.now() + 30000).toISOString()
          }
        }
      if (request.operationId === 'putStudentSubmissionsSubmissionId') {
        const record = store.get(request.input.path!.submissionId)!
        if (upload) await upload.wait()
        return receipt(record)
      }
    }
    return original(capability, input)
  })
  return { host, store, invoke }
}

/** 走完 开始练习 → 授权 → 保存作答 → 播放器完成 的真实控制器路径。 */
async function completePractice(
  controller: StudentController,
  buildArchive: (submissionId: string) => Promise<Blob>
): Promise<{ submissionId: string }> {
  await controller.prepare(exam)
  const grant = await controller.beforeStart({ candidate, signal: new AbortController().signal })
  // 与 ExamPlayer 一致：作答包里的 submissionId 来自练习授权。
  await controller.finish(await buildArchive(grant!.submissionId))
  controller.phaseChanged({
    phase: 'complete',
    submissionId: grant!.submissionId,
    pageIndex: null,
    stepIndex: null
  })
  return { submissionId: grant!.submissionId }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

it('shows the local report once the upload receipt arrives, then never again', async () => {
  const { host, store } = setup()
  const controller = new StudentController(host)
  controllers.push(controller)
  await controller.start()
  const { submissionId } = await completePractice(controller, objectiveArchive)
  await vi.waitFor(() => expect(store.get(submissionId)!.state).toBe('completed'))
  await vi.waitFor(() => expect(controller.getSnapshot().report).not.toBeNull())
  expect(controller.getSnapshot().report).toMatchObject({
    submissionId,
    examTitle: '客观题练习',
    candidateName: '学生',
    totalScore: 2,
    maxScore: 5
  })
  // 关闭即丢弃：不落盘、不再提供任何重新查看的入口。
  // App 以脱离实例的回调引用把 dismissReport 交给对话框，因此这里必须同样脱离调用。
  const dismiss = controller.dismissReport
  dismiss()
  expect(controller.getSnapshot().report).toBeNull()
  await controller.refreshRecords()
  await settle()
  expect(controller.getSnapshot().report).toBeNull()
})

it('keeps the report back until the upload has actually completed', async () => {
  const gate = gatedUpload()
  const { host, store } = setup(gate)
  const controller = new StudentController(host)
  controllers.push(controller)
  await controller.start()
  const { submissionId } = await completePractice(controller, objectiveArchive)
  await vi.waitFor(() => expect(store.get(submissionId)!.state).toBe('sending'))
  await settle()
  expect(controller.getSnapshot().report).toBeNull()
  gate.release()
  await vi.waitFor(() => expect(controller.getSnapshot().report).not.toBeNull())
})

it('never builds a report for a submission with a subjective unit', async () => {
  const { host, store } = setup()
  const controller = new StudentController(host)
  controllers.push(controller)
  await controller.start()
  const { submissionId } = await completePractice(controller, mixedArchive)
  await vi.waitFor(() => expect(store.get(submissionId)!.state).toBe('completed'))
  await settle()
  expect(controller.getSnapshot().report).toBeNull()
  await controller.refreshRecords()
  await settle()
  expect(controller.getSnapshot().report).toBeNull()
})
