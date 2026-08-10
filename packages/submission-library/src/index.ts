import { decodeSubmissionPackage, ExamPackageArchiveError } from '@ls101/exam-package'

const RECORD_FILE = 'record.json'
const ARCHIVE_EXTENSION = '.lssubmission'
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface SubmissionLibraryRecord {
  formatVersion: 1
  submissionId: string
  examPackageId: string
  examTitle: string
  candidateId: string
  candidateName: string
  startedAt: string
  submittedAt: string
  importedAt: string
  archiveSha256: string
  archiveBytes: number
  schemaUseCount: number
}

export interface SubmissionImportResult {
  status: 'created' | 'duplicate'
  record: SubmissionLibraryRecord
}

/** @ls101/file-store 的 ScopedStore 满足此结构，测试可使用内存实现。 */
export interface SubmissionLibraryStore {
  scope(name: string): SubmissionLibraryStore
  readText<T>(filename: string): Promise<T | null>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface SubmissionLibraryRepository {
  listRecords(): Promise<SubmissionLibraryRecord[]>
  getRecord(submissionId: string): Promise<SubmissionLibraryRecord | null>
  importArchive(data: Uint8Array): Promise<SubmissionImportResult>
  exportArchive(submissionId: string): Promise<Uint8Array>
  deleteSubmission(submissionId: string): Promise<void>
}

export class SubmissionLibraryError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ARCHIVE'
      | 'INVALID_STORAGE'
      | 'SUBMISSION_ID_CONFLICT'
      | 'NOT_FOUND',
    message: string,
    public readonly details: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'SubmissionLibraryError'
  }
}

export class FileSubmissionLibraryRepository implements SubmissionLibraryRepository {
  private readonly submissions: SubmissionLibraryStore
  private readonly mutationTails = new Map<string, Promise<void>>()

  constructor(root: SubmissionLibraryStore) {
    this.submissions = root.scope('submissions')
  }

  async listRecords(): Promise<SubmissionLibraryRecord[]> {
    const keys = await this.submissions.listScopes()
    const records = await Promise.all(
      keys.map(async (key) => {
        if (!SHA256_PATTERN.test(key))
          throw invalidStorage(`Invalid submission storage key: ${key}`)
        return this.readRecord(this.submissions.scope(key), key)
      })
    )
    return records
      .filter((record): record is SubmissionLibraryRecord => record !== null)
      .sort(
        (left, right) =>
          Date.parse(right.submittedAt) - Date.parse(left.submittedAt) ||
          right.submissionId.localeCompare(left.submissionId)
      )
  }

  async getRecord(submissionId: string): Promise<SubmissionLibraryRecord | null> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    const record = await this.readRecord(this.submissions.scope(key), key)
    if (record && record.submissionId !== submissionId) {
      throw invalidStorage(`Submission storage key collision: ${submissionId}`)
    }
    return record
  }

  async importArchive(data: Uint8Array): Promise<SubmissionImportResult> {
    if (!(data instanceof Uint8Array)) {
      throw new SubmissionLibraryError('INVALID_ARCHIVE', 'Submission archive must be binary data')
    }

    let archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>
    try {
      archive = await decodeSubmissionPackage(data)
    } catch (reason) {
      const message =
        reason instanceof ExamPackageArchiveError
          ? reason.message
          : 'Cannot decode submission archive'
      throw new SubmissionLibraryError('INVALID_ARCHIVE', message)
    }

    const submission = archive.submission
    const storageKey = await submissionStorageKey(submission.meta.submissionId)
    const hash = await sha256(data)
    return this.runMutation(storageKey, async () => {
      const scope = this.submissions.scope(storageKey)
      const existing = await this.readRecord(scope, storageKey)
      if (existing) return resolveExisting(existing, submission.meta.submissionId, hash)

      const record: SubmissionLibraryRecord = {
        formatVersion: 1,
        submissionId: submission.meta.submissionId,
        examPackageId: submission.meta.examPackageId,
        examTitle: submission.meta.examTitle,
        candidateId: submission.meta.candidate.candidateId,
        candidateName: submission.meta.candidate.displayName,
        startedAt: submission.meta.startedAt,
        submittedAt: submission.meta.submittedAt,
        importedAt: new Date().toISOString(),
        archiveSha256: hash,
        archiveBytes: data.byteLength,
        schemaUseCount: submission.schemaUses.length
      }
      const filename = archiveFilename(hash)
      await scope.writeAsset(filename, new Uint8Array(data))
      if (await scope.compareAndSwapText(RECORD_FILE, null, record)) {
        return { status: 'created', record }
      }

      const concurrent = await this.readRecord(scope, storageKey)
      if (!concurrent) {
        throw invalidStorage(`Submission record disappeared: ${record.submissionId}`)
      }
      if (concurrent.archiveSha256 !== hash) await scope.deleteAsset(filename)
      return resolveExisting(concurrent, record.submissionId, hash)
    })
  }

  async exportArchive(submissionId: string): Promise<Uint8Array> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    const scope = this.submissions.scope(key)
    const record = await this.readRecord(scope, key)
    if (!record || record.submissionId !== submissionId) {
      throw new SubmissionLibraryError('NOT_FOUND', `Submission not found: ${submissionId}`)
    }
    const data = await scope.readAsset(archiveFilename(record.archiveSha256))
    if (!data || (await sha256(data)) !== record.archiveSha256) {
      throw invalidStorage(`Submission archive is missing or corrupted: ${submissionId}`)
    }
    return new Uint8Array(data)
  }

  async deleteSubmission(submissionId: string): Promise<void> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    await this.runMutation(key, async () => {
      const scope = this.submissions.scope(key)
      const record = await this.readRecord(scope, key)
      if (!record) return
      if (record.submissionId !== submissionId) {
        throw invalidStorage(`Submission storage key collision: ${submissionId}`)
      }
      await scope.clear()
    })
  }

  private async readRecord(
    scope: SubmissionLibraryStore,
    storageKey: string
  ): Promise<SubmissionLibraryRecord | null> {
    const value = await scope.readText<unknown>(RECORD_FILE)
    if (value === null) return null
    if (!isSubmissionLibraryRecord(value)) {
      throw invalidStorage(`Invalid submission record: ${storageKey}`)
    }
    return structuredClone(value)
  }

  private async runMutation<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(storageKey) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.mutationTails.set(storageKey, tail)
    try {
      return await result
    } finally {
      if (this.mutationTails.get(storageKey) === tail) this.mutationTails.delete(storageKey)
    }
  }
}

function resolveExisting(
  record: SubmissionLibraryRecord,
  submissionId: string,
  archiveSha256: string
): SubmissionImportResult {
  if (record.submissionId !== submissionId || record.archiveSha256 !== archiveSha256) {
    throw new SubmissionLibraryError(
      'SUBMISSION_ID_CONFLICT',
      `Submission ID already exists with different content: ${submissionId}`,
      { submissionId }
    )
  }
  return { status: 'duplicate', record }
}

function isSubmissionLibraryRecord(value: unknown): value is SubmissionLibraryRecord {
  return (
    isRecord(value) &&
    value.formatVersion === 1 &&
    nonEmptyString(value.submissionId) &&
    nonEmptyString(value.examPackageId) &&
    nonEmptyString(value.examTitle) &&
    nonEmptyString(value.candidateId) &&
    nonEmptyString(value.candidateName) &&
    isoDate(value.startedAt) &&
    isoDate(value.submittedAt) &&
    isoDate(value.importedAt) &&
    typeof value.archiveSha256 === 'string' &&
    SHA256_PATTERN.test(value.archiveSha256) &&
    nonNegativeInteger(value.archiveBytes) &&
    nonNegativeInteger(value.schemaUseCount)
  )
}

async function submissionStorageKey(submissionId: string): Promise<string> {
  return sha256(new TextEncoder().encode(submissionId))
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function archiveFilename(hash: string): string {
  return `package-${hash}${ARCHIVE_EXTENSION}`
}

function assertSubmissionId(value: string): void {
  if (!nonEmptyString(value)) {
    throw new SubmissionLibraryError('NOT_FOUND', 'Submission ID must not be empty')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function invalidStorage(message: string): SubmissionLibraryError {
  return new SubmissionLibraryError('INVALID_STORAGE', message)
}
