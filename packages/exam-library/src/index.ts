import { decodeExamPackage, ExamPackageArchiveError } from '@ls101/exam-package'

const RECORD_FILE = 'record.json'
const ARCHIVE_EXTENSION = '.lsexam'
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface ExamLibraryRecord {
  formatVersion: 1
  packageId: string
  title: string
  importedAt: string
  archiveSha256: string
  archiveBytes: number
  pageCount: number
  timelineStepCount: number
  resourceCount: number
}

export interface ExamImportResult {
  status: 'created' | 'duplicate'
  record: ExamLibraryRecord
}

/** @ls101/file-store 的 ScopedStore 满足此结构，测试可使用内存实现。 */
export interface ExamLibraryStore {
  scope(name: string): ExamLibraryStore
  readText<T>(filename: string): Promise<T | null>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface ExamLibraryRepository {
  listRecords(): Promise<ExamLibraryRecord[]>
  getRecord(packageId: string): Promise<ExamLibraryRecord | null>
  importArchive(data: Uint8Array): Promise<ExamImportResult>
  exportArchive(packageId: string): Promise<Uint8Array>
  deleteExam(packageId: string): Promise<void>
}

export class ExamLibraryError extends Error {
  constructor(
    public readonly code: 'INVALID_ARCHIVE' | 'INVALID_STORAGE' | 'EXAM_ID_CONFLICT' | 'NOT_FOUND',
    message: string,
    public readonly details: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'ExamLibraryError'
  }
}

export class FileExamLibraryRepository implements ExamLibraryRepository {
  private readonly exams: ExamLibraryStore
  private readonly mutationTails = new Map<string, Promise<void>>()

  constructor(root: ExamLibraryStore) {
    this.exams = root.scope('exams')
  }

  async listRecords(): Promise<ExamLibraryRecord[]> {
    const keys = await this.exams.listScopes()
    const records = await Promise.all(
      keys.map(async (key) => {
        if (!SHA256_PATTERN.test(key)) throw invalidStorage(`Invalid exam storage key: ${key}`)
        return this.readRecord(this.exams.scope(key), key)
      })
    )
    return records
      .filter((record): record is ExamLibraryRecord => record !== null)
      .sort(
        (left, right) =>
          Date.parse(right.importedAt) - Date.parse(left.importedAt) ||
          right.packageId.localeCompare(left.packageId)
      )
  }

  async getRecord(packageId: string): Promise<ExamLibraryRecord | null> {
    assertPackageId(packageId)
    const key = await examStorageKey(packageId)
    const record = await this.readRecord(this.exams.scope(key), key)
    if (record && record.packageId !== packageId) {
      throw invalidStorage(`Exam storage key collision: ${packageId}`)
    }
    return record
  }

  async importArchive(data: Uint8Array): Promise<ExamImportResult> {
    if (!(data instanceof Uint8Array)) {
      throw new ExamLibraryError('INVALID_ARCHIVE', 'Exam archive must be binary data')
    }

    let archive: Awaited<ReturnType<typeof decodeExamPackage>>
    try {
      // Decoding validates the manifest and confirms every declared resource is present.
      archive = await decodeExamPackage(data)
    } catch (reason) {
      const message =
        reason instanceof ExamPackageArchiveError ? reason.message : 'Cannot decode exam archive'
      throw new ExamLibraryError('INVALID_ARCHIVE', message)
    }

    const exam = archive.exam
    const storageKey = await examStorageKey(exam.packageId)
    const hash = await sha256(data)
    return this.runMutation(storageKey, async () => {
      const scope = this.exams.scope(storageKey)
      const existing = await this.readRecord(scope, storageKey)
      if (existing) return resolveExisting(existing, exam.packageId, hash)

      const record: ExamLibraryRecord = {
        formatVersion: 1,
        packageId: exam.packageId,
        title: exam.examData.title,
        importedAt: new Date().toISOString(),
        archiveSha256: hash,
        archiveBytes: data.byteLength,
        pageCount: exam.examData.player.pages.length,
        timelineStepCount: exam.examData.player.pages.reduce(
          (count, page) => count + page.timeline.length,
          0
        ),
        resourceCount: Object.keys(exam.examData.resources).length
      }
      const filename = archiveFilename(hash)
      await scope.writeAsset(filename, new Uint8Array(data))
      if (await scope.compareAndSwapText(RECORD_FILE, null, record)) {
        return { status: 'created', record }
      }

      const concurrent = await this.readRecord(scope, storageKey)
      if (!concurrent) throw invalidStorage(`Exam record disappeared: ${record.packageId}`)
      if (concurrent.archiveSha256 !== hash) await scope.deleteAsset(filename)
      return resolveExisting(concurrent, record.packageId, hash)
    })
  }

  async exportArchive(packageId: string): Promise<Uint8Array> {
    assertPackageId(packageId)
    const key = await examStorageKey(packageId)
    const scope = this.exams.scope(key)
    const record = await this.readRecord(scope, key)
    if (!record || record.packageId !== packageId) {
      throw new ExamLibraryError('NOT_FOUND', `Exam not found: ${packageId}`)
    }
    const data = await scope.readAsset(archiveFilename(record.archiveSha256))
    if (!data || (await sha256(data)) !== record.archiveSha256) {
      throw invalidStorage(`Exam archive is missing or corrupted: ${packageId}`)
    }
    return new Uint8Array(data)
  }

  async deleteExam(packageId: string): Promise<void> {
    assertPackageId(packageId)
    const key = await examStorageKey(packageId)
    await this.runMutation(key, async () => {
      const scope = this.exams.scope(key)
      const record = await this.readRecord(scope, key)
      if (!record) return
      if (record.packageId !== packageId) {
        throw invalidStorage(`Exam storage key collision: ${packageId}`)
      }
      await scope.clear()
    })
  }

  private async readRecord(
    scope: ExamLibraryStore,
    storageKey: string
  ): Promise<ExamLibraryRecord | null> {
    const value = await scope.readText<unknown>(RECORD_FILE)
    if (value === null) return null
    if (!isExamLibraryRecord(value)) throw invalidStorage(`Invalid exam record: ${storageKey}`)
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
  record: ExamLibraryRecord,
  packageId: string,
  archiveSha256: string
): ExamImportResult {
  if (record.packageId !== packageId || record.archiveSha256 !== archiveSha256) {
    throw new ExamLibraryError(
      'EXAM_ID_CONFLICT',
      `Exam package ID already exists with different content: ${packageId}`,
      { packageId }
    )
  }
  return { status: 'duplicate', record }
}

function isExamLibraryRecord(value: unknown): value is ExamLibraryRecord {
  return (
    isRecord(value) &&
    value.formatVersion === 1 &&
    nonEmptyString(value.packageId) &&
    nonEmptyString(value.title) &&
    isoDate(value.importedAt) &&
    typeof value.archiveSha256 === 'string' &&
    SHA256_PATTERN.test(value.archiveSha256) &&
    nonNegativeInteger(value.archiveBytes) &&
    positiveInteger(value.pageCount) &&
    nonNegativeInteger(value.timelineStepCount) &&
    nonNegativeInteger(value.resourceCount)
  )
}

async function examStorageKey(packageId: string): Promise<string> {
  return sha256(new TextEncoder().encode(packageId))
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function archiveFilename(hash: string): string {
  return `package-${hash}${ARCHIVE_EXTENSION}`
}

function assertPackageId(value: string): void {
  if (!nonEmptyString(value)) throw new ExamLibraryError('NOT_FOUND', 'Exam ID must not be empty')
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

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function invalidStorage(message: string): ExamLibraryError {
  return new ExamLibraryError('INVALID_STORAGE', message)
}
