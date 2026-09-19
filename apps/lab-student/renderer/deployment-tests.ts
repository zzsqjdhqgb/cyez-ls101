import type { ExamPackage } from '@ls101/core-types'
import { assembleSubmission, loadExam, type LoadedExam } from '@ls101/exam-player'
import {
  collectSubmissionPackageFiles,
  decodeSubmissionPackage,
  encodeSubmissionPackage
} from '@ls101/exam-package'
import type { Schema, OperationId } from '@ls101/lab-contracts'
import type { OperationInput } from '@ls101/lab-client'
import type { LabHost, StudentRecord } from '@ls101/lab-desktop-host'
import { SubmissionQueue } from './submission-queue'

export const TEST_CANDIDATE = { candidateId: 'deployment-test', displayName: '部署测试' }
const CASES = [
  'identity',
  'storage',
  'download',
  'playback',
  'audio',
  'recovery',
  'submission',
  'duplicate'
]
type Archive = { handle: string; sha256: string; bytes: number }
interface Ports {
  host: LabHost
  connectionId: string
  request<T>(operation: OperationId, input: OperationInput, signal: AbortSignal): Promise<T>
  play(baseUrl: string, lease: Schema<'TaskLease'>, signal: AbortSignal): Promise<Blob>
  status(caseId: string): void
}

export function playbackExam(exam: ExamPackage, audio: boolean): ExamPackage {
  if (audio) return exam
  return {
    ...exam,
    examData: {
      ...exam.examData,
      player: {
        ...exam.examData.player,
        pages: exam.examData.player.pages.filter((page) => page.id !== 'recording'),
        recordingIndices: []
      }
    },
    answerCapturePlan: { ...exam.answerCapturePlan, audios: [] }
  }
}

export async function runDeploymentTests(
  ports: Ports,
  lease: Schema<'TaskLease'>,
  signal: AbortSignal,
  progress: (cases: Schema<'CaseResult'>[]) => Promise<void>
): Promise<Schema<'TestResult'>> {
  const parameters = lease.parameters
  if (
    parameters.type !== 'deployment-test' ||
    parameters.suiteId !== 'ls101-lab-deployment' ||
    parameters.suiteVersion !== '1' ||
    parameters.caseIds.some((id) => !CASES.includes(id))
  )
    throw new Error('Unsupported installed test suite')
  const capability = { taskId: lease.taskId, leaseId: lease.leaseId }
  const invoke = <T>(name: string, value: object = {}): Promise<T> => {
    signal.throwIfAborted()
    return ports.host.invoke<T>(`tests.${name}`, { ...capability, ...value })
  }
  const request = <T>(operation: OperationId, value: OperationInput = {}): Promise<T> => {
    signal.throwIfAborted()
    return ports.request<T>(
      operation,
      { path: { taskId: lease.taskId }, taskLease: lease.leaseId, ...value },
      signal
    )
  }
  let baseUrl: string | undefined, loaded: LoadedExam | undefined
  let examPromise: Promise<LoadedExam> | undefined, archivePromise: Promise<Blob> | undefined
  let savePromise: Promise<void> | undefined, submissionPromise: Promise<void> | undefined
  let simulatedFailure = parameters.caseIds.includes('recovery'),
    uploadAttempts = 0
  const list = (): Promise<StudentRecord[]> => invoke('list')
  const upload = async (): Promise<Schema<'CompletedReceipt'>> => {
    const archive = await invoke<Archive>('uploadHandle', { connectionId: ports.connectionId })
    return request('putStudentTasksTaskIdTestSubmission', { archive })
  }
  const queue = new SubmissionQueue({
    list,
    save: (record) => invoke('cas', { record }),
    canQuery: () => !signal.aborted,
    canUpload: () => !signal.aborted,
    query: () => request('getStudentTasksTaskIdTestReceipt'),
    upload: async () => {
      uploadAttempts++
      if (simulatedFailure) {
        simulatedFailure = false
        throw new Error('Scoped deployment upload failure')
      }
      return upload()
    },
    changed: () => undefined
  })
  const stop = (): void => queue.suspend('test-stopped')
  signal.addEventListener('abort', stop, { once: true })
  const ensureExam = (): Promise<LoadedExam> =>
    (examPromise ??= (async () => {
      const archive = await request<Archive>('getStudentTasksTaskIdTestExam')
      if (archive.sha256 !== parameters.testExamSha256) throw new Error('Test exam digest mismatch')
      baseUrl = await invoke<string>('prepare', { handle: archive.handle })
      loaded = await loadExam(baseUrl, (input, init) => fetch(input, { ...init, signal }))
      signal.throwIfAborted()
      return loaded
    })())
  const ensureArchive = (): Promise<Blob> =>
    (archivePromise ??= (async () => {
      const exam = await ensureExam()
      signal.throwIfAborted()
      if (parameters.caseIds.includes('playback')) {
        const image = new Image()
        image.src = exam.resourceUrls.image
        await image.decode()
        signal.throwIfAborted()
        if (image.naturalWidth !== 96 || image.naturalHeight !== 64)
          throw new Error('Deployment image did not decode correctly')
      }
      if (parameters.caseIds.some((id) => ['playback', 'audio'].includes(id)))
        return ports.play(baseUrl!, lease, signal)
      const now = new Date().toISOString()
      const bundle = assembleSubmission(playbackExam(exam.exam, false), {
        submissionId: parameters.testSubmissionId,
        candidate: TEST_CANDIDATE,
        startedAt: now,
        submittedAt: now,
        choiceAnswers: ['A'],
        recordings: []
      })
      const bytes = await encodeSubmissionPackage(
        bundle.submission,
        collectSubmissionPackageFiles(bundle.submission, exam.resources, {})
      )
      return new Blob([new Uint8Array(bytes).buffer])
    })())
  const ensureSaved = (): Promise<void> =>
    (savePromise ??= (async () => {
      const blob = await ensureArchive(),
        bytes = await blob.arrayBuffer()
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (value) => value.toString(16).padStart(2, '0')
      ).join('')
      const handle = await invoke<string>('begin', { sha256, bytes: bytes.byteLength })
      for (
        let offset = 0, sequence = 0;
        offset < bytes.byteLength;
        offset += 1024 * 1024, sequence++
      )
        await invoke('chunk', {
          handle,
          sequence,
          bytes: new Uint8Array(bytes.slice(offset, offset + 1024 * 1024))
        })
      await invoke('finish', { handle, sha256 })
      const [record] = await list()
      if (!record?.archivePresent || record.archiveSha256 !== sha256)
        throw new Error('Test archive not durable')
    })())
  const ensureSubmission = (): Promise<void> =>
    (submissionPromise ??= (async () => {
      await ensureSaved()
      await queue.pump()
      if (parameters.caseIds.includes('recovery')) {
        const [failed] = await list()
        if (!failed?.archivePresent || !failed.lastError || failed.retryPolicy !== 'manual')
          throw new Error('Failed upload did not preserve manual recovery state')
        queue.refresh()
        await queue.pump()
        if (uploadAttempts !== 1) throw new Error('Ordinary failure retried automatically')
        await queue.retry(parameters.testSubmissionId)
      }
      const [record] = await list()
      if (!record?.receipt || record.state !== 'completed')
        throw new Error('Test receipt not durable')
    })())
  const cases: Schema<'CaseResult'>[] = []
  try {
    for (const caseId of CASES.filter((id) => parameters.caseIds.includes(id))) {
      signal.throwIfAborted()
      ports.status(caseId)
      try {
        if (caseId === 'identity') {
          const state = await ports.request<Schema<'StudentState'>>('getStudentState', {}, signal)
          const startup = await ports.host.invoke<{ version: string }>('startup.status')
          if (state.availability !== 'maintenance' || state.releaseVersion !== startup.version)
            throw new Error('Device is not admitted for deployment testing')
        } else if (caseId === 'storage') await invoke('storage')
        else if (caseId === 'download') await ensureExam()
        else if (caseId === 'playback' || caseId === 'audio') {
          const decoded = await decodeSubmissionPackage(
            new Uint8Array(await (await ensureArchive()).arrayBuffer())
          )
          if (caseId === 'playback' && decoded.submission.answers.strings[0] !== 'A')
            throw new Error('Choice interaction was not confirmed')
          if (caseId === 'audio') {
            const answer = decoded.submission.answers.audios[0]
            if (
              !answer ||
              answer.durationMs < 1000 ||
              !decoded.files[answer.resourceKey]?.byteLength
            )
              throw new Error('Microphone produced no recording')
            const resource = decoded.submission.resources[answer.resourceKey]
            await replayRecording(
              new Blob([new Uint8Array(decoded.files[answer.resourceKey]).buffer], {
                type: resource.mediaType
              }),
              signal
            )
          }
        } else {
          await ensureSubmission()
          if (caseId === 'duplicate') {
            const [original] = await list()
            // Discard the duplicate response, then recover it through the receipt endpoint.
            await upload()
            const receipt = await request<Schema<'ReceiptQuery'>>(
              'getStudentTasksTaskIdTestReceipt'
            )
            if (
              receipt.status !== 'received' ||
              receipt.receipt.receiptId !== original.receipt?.receipt.receiptId ||
              receipt.receipt.archiveSha256 !== original.archiveSha256
            )
              throw new Error('Duplicate upload did not preserve the original receipt')
          }
        }
        signal.throwIfAborted()
        cases.push({
          caseId,
          status: ['audio', 'playback'].includes(caseId) ? 'manual-required' : 'passed',
          error: null
        })
      } catch (error) {
        cases.push({
          caseId,
          status: signal.aborted
            ? signal.reason?.name === 'TimeoutError'
              ? 'timed-out'
              : 'cancelled'
            : 'failed',
          error: {
            code: signal.aborted ? 'LEASE_STOPPED' : 'TEST_CASE_FAILED',
            message:
              error instanceof Error ? error.message.slice(0, 300) : 'Deployment test failed',
            occurredAt: new Date().toISOString()
          }
        })
      }
      await progress([...cases])
      signal.throwIfAborted()
    }
    return { kind: 'deployment-test', cases }
  } finally {
    signal.removeEventListener('abort', stop)
    queue.suspend('test-finished')
    await queue.settle()
    loaded?.dispose()
    if (baseUrl) await ports.host.invoke('tests.release', { ...capability, baseUrl })
  }
}

function replayRecording(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob),
      audio = new Audio(url)
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve()
    }
    const cancel = (): void => finish(new Error('Recording playback stopped'))
    const timeout = setTimeout(() => finish(new Error('Recording playback timed out')), 10000)
    signal.addEventListener('abort', cancel, { once: true })
    audio.onended = () => finish()
    audio.onerror = () => finish(new Error('Recording playback failed'))
    void audio.play().catch(() => finish(new Error('Recording playback failed')))
  })
}
