import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeSubmissionPackage } from '@ls101/exam-package'
import { validateSchema, DEFAULT_LIMITS, type Schema } from '@ls101/lab-contracts'
import canonicalize from 'canonicalize'
import { loadJson, requireId, saveFile, SerialWrites, syncFolder } from './files'
import type { PracticeIntent, StudentRecord } from './shared'

interface SaveSession {
  owner: number
  path: string
  size: number
  sequence: number
  intent: PracticeIntent
  maximum: number
  sha256: string
}
interface SaveIntent extends PracticeIntent {
  archiveSha256: string
  archiveBytes: number
}
interface Selection {
  submissionId: string
  archiveSha256: string
  submittedAt: string
  receiptId: string
  receiptServerId: string
}
export interface CleanupSnapshot {
  digest: string
  selection: Selection[]
  bytes: number
}
interface DeletionEntry {
  submissionId: string
  status: 'intent' | 'deleted' | 'already-absent' | 'skipped' | 'failed'
  bytes: number
}

export class StudentRecords {
  private readonly writes = new SerialWrites()
  private readonly saves = new Map<string, SaveSession>()
  constructor(readonly root: string) {}

  archivePath(id: string): string {
    requireId(id)
    return join(this.root, 'submissions', id, 'archive.lssubmission')
  }
  private recordPath(id: string): string {
    requireId(id)
    return join(this.root, 'submissions', id, 'record.json')
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.root, 'submissions'), { recursive: true, mode: 0o700 })
    await this.recoverDeletions()
    for (const entry of await readdir(join(this.root, 'submissions'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      requireId(entry.name)
      const intent = await loadJson<SaveIntent>(
        join(this.root, 'submissions', entry.name, 'save-intent.json')
      )
      const record = await this.get(entry.name)
      if (record) {
        if (record.archivePresent) {
          const archive = await readFile(this.archivePath(entry.name))
          if (digest(archive) !== record.archiveSha256)
            throw new Error('Stored submission integrity failure')
        }
      } else if (intent) {
        const archive = await readFile(this.archivePath(entry.name)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          }
        )
        if (archive) {
          if (digest(archive) !== intent.archiveSha256 || archive.length !== intent.archiveBytes)
            throw new Error('Interrupted save integrity failure')
          await this.commitArchive(intent, archive)
        } else
          await saveFile(
            join(this.root, 'submissions', entry.name, 'interrupted.json'),
            JSON.stringify({ reason: 'incomplete-archive' })
          )
      }
      for (const file of await readdir(join(this.root, 'submissions', entry.name)))
        if (file.endsWith('.part'))
          await rm(join(this.root, 'submissions', entry.name, file), { force: true })
    }
  }

  async get(id: string): Promise<StudentRecord | null> {
    const record = await loadJson<StudentRecord>(this.recordPath(id))
    if (
      record &&
      (record.schemaVersion !== 1 ||
        record.submissionId !== id ||
        !Number.isSafeInteger(record.revision) ||
        record.revision < 1)
    )
      throw new Error('Unsupported submission record')
    if (record) validateRecord(record)
    return record
  }

  async list(): Promise<StudentRecord[]> {
    await mkdir(join(this.root, 'submissions'), { recursive: true, mode: 0o700 })
    const records: StudentRecord[] = []
    for (const entry of await readdir(join(this.root, 'submissions'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const record = await this.get(entry.name)
      if (record) records.push(record)
    }
    return records.sort(
      (a, b) =>
        b.submittedAt.localeCompare(a.submittedAt) || b.submissionId.localeCompare(a.submissionId)
    )
  }

  async begin(
    owner: number,
    intent: PracticeIntent,
    expectation: { sha256: string; bytes: number }
  ): Promise<string> {
    requireId(intent.submissionId)
    requireId(intent.examId)
    requireId(intent.binding.contextId)
    validateSchema('Candidate', intent.candidate)
    if (
      !/^[a-f0-9]{64}$/.test(expectation.sha256) ||
      !Number.isSafeInteger(expectation.bytes) ||
      expectation.bytes < 1 ||
      expectation.bytes > DEFAULT_LIMITS.maxSubmissionArchiveBytes
    )
      throw new Error('Invalid archive expectation')
    const saveIntent: SaveIntent = {
      ...intent,
      archiveSha256: expectation.sha256,
      archiveBytes: expectation.bytes
    }
    const handle = randomUUID(),
      directory = join(this.root, 'submissions', intent.submissionId)
    return this.writes.run(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const current = await loadJson<SaveIntent>(join(directory, 'save-intent.json'))
      if (current && canonicalize(current) !== canonicalize(saveIntent))
        throw new Error('Practice identity conflict')
      await saveFile(join(directory, 'save-intent.json'), JSON.stringify(saveIntent))
      const temporary = join(directory, `${handle}.part`)
      const file = await open(temporary, 'wx', 0o600)
      await file.close()
      this.saves.set(handle, {
        owner,
        path: temporary,
        size: 0,
        sequence: 0,
        intent,
        maximum: expectation.bytes,
        sha256: expectation.sha256
      })
      return handle
    })
  }

  async chunk(owner: number, handle: string, sequence: number, bytes: Uint8Array): Promise<void> {
    return this.writes.run(async () => {
      const session = this.saves.get(handle)
      if (
        !session ||
        session.owner !== owner ||
        session.sequence !== sequence ||
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength > 1024 * 1024 ||
        session.size + bytes.byteLength > session.maximum
      )
        throw new Error('Invalid archive chunk')
      const file = await open(session.path, 'a')
      try {
        await file.writeFile(bytes)
      } finally {
        await file.close()
      }
      session.size += bytes.byteLength
      session.sequence++
    })
  }

  async finish(owner: number, handle: string, expectedDigest: string): Promise<StudentRecord> {
    return this.writes.run(async () => {
      const session = this.saves.get(handle)
      if (!session || session.owner !== owner) throw new Error('Invalid save handle')
      const bytes = await readFile(session.path)
      if (
        digest(bytes) !== expectedDigest ||
        expectedDigest !== session.sha256 ||
        bytes.length !== session.maximum
      )
        throw new Error('Archive digest mismatch')
      const decoded = await decodeSubmissionPackage(bytes)
      if (
        decoded.submission.meta.submissionId !== session.intent.submissionId ||
        canonicalize(decoded.submission.meta.candidate) !== canonicalize(session.intent.candidate)
      )
        throw new Error('Archive identity mismatch')
      const existing = await this.get(session.intent.submissionId)
      if (existing) {
        if (
          existing.archiveSha256 !== expectedDigest ||
          existing.originalBinding.contextId !== session.intent.binding.contextId
        )
          throw new Error('Submission content conflict')
        await rm(session.path, { force: true })
        this.saves.delete(handle)
        return existing
      }
      const file = await open(session.path, 'r+')
      try {
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(session.path, this.archivePath(session.intent.submissionId))
      await syncFolder(join(this.root, 'submissions', session.intent.submissionId))
      const result = await this.commitArchive(session.intent, bytes)
      this.saves.delete(handle)
      return result
    })
  }

  private async commitArchive(intent: PracticeIntent, bytes: Uint8Array): Promise<StudentRecord> {
    const { submission } = await decodeSubmissionPackage(bytes)
    if (
      submission.meta.submissionId !== intent.submissionId ||
      canonicalize(submission.meta.candidate) !== canonicalize(intent.candidate)
    )
      throw new Error('Incomplete save has invalid archive identity')
    const record: StudentRecord = {
      schemaVersion: 1,
      revision: 1,
      submissionId: intent.submissionId,
      originalBinding: intent.binding,
      examId: intent.examId,
      candidate: intent.candidate,
      submittedAt: submission.meta.submittedAt,
      archiveSha256: digest(bytes),
      archiveBytes: bytes.length,
      state: 'queued',
      attemptId: null,
      attemptCount: 0,
      resultKnowledge: 'never-sent',
      retryPolicy: 'automatic-first',
      pauseReason: null,
      lastError: null,
      receipt: null,
      completedAt: null,
      archivePresent: true
    }
    await saveFile(this.recordPath(record.submissionId), JSON.stringify(record))
    return record
  }

  async compareAndSwap(
    id: string,
    expectedRevision: number,
    next: StudentRecord
  ): Promise<StudentRecord> {
    return this.writes.run(async () => {
      const current = await this.get(id)
      if (!current || current.revision !== expectedRevision)
        throw new Error('Record revision conflict')
      validateRecord(next)
      for (const key of [
        'schemaVersion',
        'submissionId',
        'examId',
        'submittedAt',
        'archiveSha256',
        'archiveBytes',
        'candidate',
        'originalBinding',
        'archivePresent'
      ] as const) {
        if (canonicalize(current[key]) !== canonicalize(next[key]))
          throw new Error('Immutable submission field changed')
      }
      if (current.receipt && canonicalize(current.receipt) !== canonicalize(next.receipt))
        throw new Error('Completed receipt cannot change')
      if (next.receipt) {
        validateSchema('CompletedReceipt', next.receipt)
        const receipt = next.receipt.receipt
        if (
          receipt.serverId !== current.originalBinding.serverId ||
          receipt.deviceId !== current.originalBinding.deviceId ||
          receipt.submissionId !== id ||
          receipt.archiveSha256 !== current.archiveSha256 ||
          next.state !== 'completed' ||
          next.retryPolicy !== 'none'
        )
          throw new Error('Receipt does not match submission')
      } else if (next.state === 'completed') throw new Error('Completion requires a receipt')
      const result = { ...next, revision: current.revision + 1 }
      await saveFile(this.recordPath(id), JSON.stringify(result))
      return result
    })
  }

  async exportTo(id: string, target: string): Promise<void> {
    const record = await this.get(id)
    if (!record?.archivePresent) throw new Error('Submission archive is unavailable')
    const bytes = await readFile(this.archivePath(id))
    if (digest(bytes) !== record.archiveSha256) throw new Error('Submission integrity failure')
    await saveFile(target, bytes)
  }

  async preview(taskId: string, submittedBefore: string): Promise<CleanupSnapshot> {
    requireId(taskId)
    const records = (await this.list()).filter(
      (record) =>
        record.state === 'completed' &&
        record.receipt &&
        record.archivePresent &&
        Date.parse(record.submittedAt) < Date.parse(submittedBefore)
    )
    const selection: Selection[] = records
      .map((record) => ({
        submissionId: record.submissionId,
        archiveSha256: record.archiveSha256,
        submittedAt: record.submittedAt,
        receiptId: record.receipt!.receipt.receiptId,
        receiptServerId: record.receipt!.receipt.serverId
      }))
      .sort(
        (a, b) =>
          a.receiptServerId.localeCompare(b.receiptServerId) ||
          a.submissionId.localeCompare(b.submissionId)
      )
    const snapshot = {
      digest: digest(canonicalize(selection)!),
      selection,
      bytes: records.reduce((sum, record) => sum + record.archiveBytes, 0)
    }
    await saveFile(join(this.root, 'tasks', taskId, 'selection.json'), JSON.stringify(snapshot))
    return snapshot
  }

  async cleanupItem(
    taskId: string,
    planId: string,
    expectedDigest: string,
    index: number,
    assertLease: () => void = () => undefined
  ): Promise<void> {
    requireId(taskId)
    requireId(planId)
    await this.writes.run(async () => {
      const snapshot = await loadJson<CleanupSnapshot>(
        join(this.root, 'tasks', planId, 'selection.json')
      )
      if (
        !snapshot ||
        snapshot.digest !== expectedDigest ||
        digest(canonicalize(snapshot.selection)!) !== expectedDigest ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= snapshot.selection.length
      )
        throw new Error('Cleanup selection mismatch')
      const item = snapshot.selection[index],
        path = join(this.root, 'tasks', taskId, 'deletions', `${item.submissionId}.json`)
      const previous = await loadJson<DeletionEntry>(path)
      if (previous && previous.status !== 'intent') return
      const record = await this.get(item.submissionId)
      const save = (status: DeletionEntry['status'], bytes = 0): Promise<void> =>
        saveFile(path, JSON.stringify({ submissionId: item.submissionId, status, bytes }))
      if (
        !record?.receipt ||
        record.archiveSha256 !== item.archiveSha256 ||
        record.submittedAt !== item.submittedAt ||
        record.receipt.receipt.receiptId !== item.receiptId ||
        record.receipt.receipt.serverId !== item.receiptServerId
      ) {
        await save('skipped')
        return
      }
      let bytes: Buffer
      try {
        bytes = await readFile(this.archivePath(item.submissionId))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        if (record.archivePresent)
          await saveFile(
            this.recordPath(record.submissionId),
            JSON.stringify({ ...record, archivePresent: false, revision: record.revision + 1 })
          )
        await save(
          previous?.status === 'intent' ? 'deleted' : 'already-absent',
          previous?.status === 'intent' ? previous.bytes : 0
        )
        return
      }
      if (digest(bytes) !== item.archiveSha256) {
        await save('failed')
        return
      }
      assertLease()
      await save('intent', bytes.length)
      assertLease()
      await rm(this.archivePath(item.submissionId))
      await syncFolder(join(this.root, 'submissions', item.submissionId))
      await saveFile(
        this.recordPath(record.submissionId),
        JSON.stringify({ ...record, archivePresent: false, revision: record.revision + 1 })
      )
      await save('deleted', bytes.length)
    })
  }

  async cleanupResult(taskId: string, selectedCount: number): Promise<Schema<'CleanupResult'>> {
    requireId(taskId)
    const result: Schema<'CleanupResult'> = {
      kind: 'history-execute',
      selectedCount,
      deletedCount: 0,
      alreadyAbsentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      deletedBytes: 0,
      errors: []
    }
    const directory = join(this.root, 'tasks', taskId, 'deletions')
    const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const name of names) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue
      const entry = await loadJson<DeletionEntry>(join(directory, name))
      if (!entry) continue
      if (entry.status === 'deleted') {
        result.deletedCount++
        result.deletedBytes += entry.bytes
      } else if (entry.status === 'already-absent') result.alreadyAbsentCount++
      else if (entry.status === 'skipped') result.skippedCount++
      else result.failedCount++
    }
    result.skippedCount += Math.max(
      0,
      selectedCount -
        result.deletedCount -
        result.alreadyAbsentCount -
        result.skippedCount -
        result.failedCount
    )
    return result
  }

  private async recoverDeletions(): Promise<void> {
    const tasks = await readdir(join(this.root, 'tasks')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const task of tasks) {
      requireId(task)
      const directory = join(this.root, 'tasks', task, 'deletions')
      const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const name of names) {
        if (!/^[a-f0-9-]+\.json$/.test(name)) continue
        const path = join(directory, name),
          entry = await loadJson<DeletionEntry>(path)
        if (!entry || entry.status !== 'intent') continue
        const record = await this.get(entry.submissionId)
        if (!record?.receipt) throw new Error('Cleanup journal has no successful receipt')
        const present = await readFile(this.archivePath(entry.submissionId)).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          }
        )
        if (!present && record.archivePresent) {
          await syncFolder(join(this.root, 'submissions', entry.submissionId))
          await saveFile(
            this.recordPath(record.submissionId),
            JSON.stringify({ ...record, archivePresent: false, revision: record.revision + 1 })
          )
        }
        await saveFile(
          path,
          JSON.stringify({
            ...entry,
            status: present ? 'skipped' : 'deleted',
            bytes: present ? 0 : entry.bytes
          })
        )
      }
    }
  }

  async snapshot(planId: string, expectedDigest: string): Promise<CleanupSnapshot> {
    requireId(planId)
    const snapshot = await loadJson<CleanupSnapshot>(
      join(this.root, 'tasks', planId, 'selection.json')
    )
    if (
      !snapshot ||
      snapshot.digest !== expectedDigest ||
      digest(canonicalize(snapshot.selection)!) !== expectedDigest
    )
      throw new Error('Cleanup snapshot mismatch')
    return snapshot
  }

  async flush(): Promise<void> {
    await this.writes.flush()
  }
}

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function validateRecord(record: StudentRecord): void {
  requireId(record.submissionId)
  requireId(record.examId)
  requireId(record.originalBinding.contextId)
  requireId(record.originalBinding.deviceId)
  requireId(record.originalBinding.serverId)
  validateSchema('Candidate', record.candidate)
  if (
    !['queued', 'sending', 'checking', 'retry-required', 'completed', 'manual-resolution'].includes(
      record.state
    ) ||
    !['never-sent', 'unknown', 'not-received', 'received'].includes(record.resultKnowledge) ||
    !['automatic-first', 'automatic-maintenance', 'manual', 'receipt-only', 'none'].includes(
      record.retryPolicy
    ) ||
    !Number.isSafeInteger(record.attemptCount) ||
    record.attemptCount < 0 ||
    !Number.isSafeInteger(record.archiveBytes) ||
    record.archiveBytes < 1 ||
    !/^[a-f0-9]{64}$/.test(record.archiveSha256) ||
    !Number.isFinite(Date.parse(record.submittedAt)) ||
    typeof record.archivePresent !== 'boolean'
  )
    throw new Error('Invalid submission record')
  if (record.attemptId !== null) requireId(record.attemptId)
  if (record.receipt) {
    validateSchema('CompletedReceipt', record.receipt)
    const receipt = record.receipt.receipt
    if (
      record.state !== 'completed' ||
      record.resultKnowledge !== 'received' ||
      record.retryPolicy !== 'none' ||
      !record.completedAt ||
      !Number.isFinite(Date.parse(record.completedAt)) ||
      receipt.submissionId !== record.submissionId ||
      receipt.serverId !== record.originalBinding.serverId ||
      receipt.deviceId !== record.originalBinding.deviceId ||
      receipt.archiveSha256 !== record.archiveSha256
    )
      throw new Error('Invalid completed record')
  } else if (
    record.state === 'completed' ||
    record.resultKnowledge === 'received' ||
    record.retryPolicy === 'none' ||
    record.completedAt !== null
  )
    throw new Error('Missing completed receipt')
}
