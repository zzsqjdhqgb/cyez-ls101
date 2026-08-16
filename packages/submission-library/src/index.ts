import type {
  GradingResult,
  SchemaDefinition,
  SubmissionMeta,
  SubmissionPackage,
  SubmissionSchemaUse
} from '@ls101/core-types'
import { decodeSubmissionPackage, ExamPackageArchiveError } from '@ls101/exam-package'

const RECORD_FILE = 'record.json'
const GRADING_FILE = 'grading.json'
const SETTLEMENT_FILE = 'index.json'
const SETTLEMENT_MUTATION_KEY = '__settlements__'
const ARCHIVE_EXTENSION = '.lssubmission'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RESOURCE_REFERENCE_PATTERN = /resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)/g
const QUESTION_DESCRIPTION_INPUT_ID = 'question-description'
const OBJECTIVE_ANALYSIS_INPUT_ID = 'analysis'
const REFERENCE_ANSWER_INPUT_ID = 'reference-answer'

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

export type GradingEngineKind = 'objective' | 'human' | 'ai'

export interface GradingResourceInput {
  resourceKey: string
  filename: string
  mediaType?: string
  kind: 'static' | 'recording'
  data: Uint8Array
}

export type ResolvedGradingAnswer =
  | {
      answerId: string
      description: string
      type: 'text'
      value: string | null
    }
  | {
      answerId: string
      description: string
      type: 'fixed-speech'
      text: string
      audio: GradingResourceInput & { durationMs: number }
    }
  | {
      answerId: string
      description: string
      type: 'free-speech'
      audio: GradingResourceInput & { durationMs: number }
    }

/** Human、AI 和客观题评分引擎共享的完整评分单元输入。 */
export interface GradingInput {
  submission: SubmissionMeta
  instanceId: string
  schema: SchemaDefinition
  inputs: SubmissionSchemaUse['inputs']
  answers: ResolvedGradingAnswer[]
  resources: Record<string, GradingResourceInput>
}

export interface GradingEngine {
  readonly kind: GradingEngineKind
  grade(input: GradingInput): Promise<GradingResult>
}

export interface SubmissionGradingItem {
  instanceId: string
  engine: GradingEngineKind
  result: GradingResult
  gradedAt: string
}

export interface SubmissionAIModelSelection {
  providerId: string
  modelId: string
}

export interface SubmissionAIProcessedAnswer {
  answerId: string
  description: string
  transcript: string
  correction: string
  referenceText?: string
}

export interface SubmissionAIGradingRun {
  instanceId: string
  status: 'processing' | 'succeeded' | 'failed'
  speechRecognitionModel: SubmissionAIModelSelection
  textModel: SubmissionAIModelSelection
  answers: SubmissionAIProcessedAnswer[]
  prompt?: string
  rawResponse?: string
  result?: GradingResult
  error?: string
  review?: {
    mode: 'none' | 'all' | 'sample'
    selected: boolean
    reviewed: boolean
    finalResult?: GradingResult
  }
  updatedAt: string
}

export type SubmissionAIGradingRunInput = Omit<SubmissionAIGradingRun, 'instanceId' | 'updatedAt'>

export interface SubmissionGradingRecord {
  formatVersion: 1
  submissionId: string
  status: 'grading' | 'ready'
  items: SubmissionGradingItem[]
  aiRuns: SubmissionAIGradingRun[]
  totalScore: number
  maxScore: number
  readyAt?: string
}

export interface SubmissionGradingSummary {
  status: SubmissionGradingRecord['status']
  gradedCount: number
  totalCount: number
  totalScore: number
  maxScore: number
  readyAt?: string
}

export interface SubmissionSettlementSummary {
  batchId: string
  settledAt: string
}

export interface SubmissionSettlementBatchRecord {
  submissionId: string
  totalScore: number
  maxScore: number
}

export interface SubmissionSettlementBatch {
  formatVersion: 1
  batchId: string
  settledAt: string
  records: SubmissionSettlementBatchRecord[]
}

interface SubmissionSettlementIndex {
  formatVersion: 1
  batches: SubmissionSettlementBatch[]
}

export interface SubmissionLibraryEntry {
  record: SubmissionLibraryRecord
  grading: SubmissionGradingSummary | null
  settlement: SubmissionSettlementSummary | null
}

export interface SubmissionGradingWorkspace {
  submission: SubmissionPackage
  grading: SubmissionGradingRecord
  inputs: GradingInput[]
}

export interface SubmissionReport {
  markdown: string
  resources: Record<string, GradingResourceInput>
}

/** @ls101/file-store 的 ScopedStore 满足此结构，测试可使用内存实现。 */
export interface SubmissionLibraryStore {
  scope(name: string): SubmissionLibraryStore
  readText<T>(filename: string): Promise<T | null>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
  deleteText(filename: string): Promise<void>
  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  listScopes(): Promise<string[]>
  clear(): Promise<void>
}

export interface SubmissionLibraryRepository {
  listRecords(): Promise<SubmissionLibraryRecord[]>
  listEntries(): Promise<SubmissionLibraryEntry[]>
  getRecord(submissionId: string): Promise<SubmissionLibraryRecord | null>
  importArchive(data: Uint8Array): Promise<SubmissionImportResult>
  exportArchive(submissionId: string): Promise<Uint8Array>
  deleteSubmission(submissionId: string): Promise<void>
  resetGrading(submissionId: string): Promise<void>
  listSettlementBatches(): Promise<SubmissionSettlementBatch[]>
  settleSubmissions(submissionIds: readonly string[]): Promise<SubmissionSettlementBatch>
  startGrading(submissionId: string): Promise<SubmissionGradingWorkspace>
  submitGradingResult(
    submissionId: string,
    instanceId: string,
    engine: 'human' | 'ai',
    result: GradingResult
  ): Promise<SubmissionGradingWorkspace>
  saveAIGradingRun(
    submissionId: string,
    instanceId: string,
    run: SubmissionAIGradingRunInput
  ): Promise<SubmissionGradingWorkspace>
  getGradingRecord(submissionId: string): Promise<SubmissionGradingRecord | null>
  getReport(submissionId: string): Promise<SubmissionReport>
}

export class SubmissionLibraryError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_ARCHIVE'
      | 'INVALID_STORAGE'
      | 'SUBMISSION_ID_CONFLICT'
      | 'NOT_FOUND'
      | 'INVALID_GRADING_RESULT'
      | 'GRADING_RESULT_LOCKED'
      | 'GRADING_COMPLETED'
      | 'GRADING_NOT_COMPLETED'
      | 'GRADING_NOT_READY'
      | 'GRADING_NOT_SETTLED'
      | 'ALREADY_SETTLED'
      | 'SETTLEMENT_CONFLICT',
    message: string,
    public readonly details: Readonly<Record<string, string | number>> = {}
  ) {
    super(message)
    this.name = 'SubmissionLibraryError'
  }
}

export class FileSubmissionLibraryRepository implements SubmissionLibraryRepository {
  private readonly submissions: SubmissionLibraryStore
  private readonly settlements: SubmissionLibraryStore
  private readonly mutationTails = new Map<string, Promise<void>>()

  constructor(root: SubmissionLibraryStore) {
    this.submissions = root.scope('submissions')
    this.settlements = root.scope('settlements')
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

  async listEntries(): Promise<SubmissionLibraryEntry[]> {
    const records = await this.listRecords()
    const settlementBySubmission = settlementLookup(await this.readSettlementIndex())
    const entries: SubmissionLibraryEntry[] = []
    for (const record of records) {
      const key = await submissionStorageKey(record.submissionId)
      const scope = this.submissions.scope(key)
      const archive = await this.readArchive(scope, record.submissionId)
      const grading = await this.readGrading(scope, archive.submission)
      entries.push({
        record,
        grading: grading
          ? {
              status: grading.status,
              gradedCount: grading.items.length,
              totalCount: archive.submission.schemaUses.length,
              totalScore: grading.totalScore,
              maxScore: grading.maxScore,
              ...(grading.readyAt ? { readyAt: grading.readyAt } : {})
            }
          : null,
        settlement: settlementBySubmission.get(record.submissionId) ?? null
      })
    }
    return entries
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
      await this.runMutation(SETTLEMENT_MUTATION_KEY, async () => {
        const scope = this.submissions.scope(key)
        const record = await this.readRecord(scope, key)
        if (!record) return
        if (record.submissionId !== submissionId) {
          throw invalidStorage(`Submission storage key collision: ${submissionId}`)
        }
        const existing = await this.readSettlementIndex()
        const next = removeSubmissionFromSettlements(existing, submissionId)
        if (!sameValue(existing, next)) await this.writeSettlementIndex(existing, next)
        try {
          await scope.clear()
        } catch (reason) {
          if (!sameValue(existing, next)) await this.writeSettlementIndex(next, existing)
          throw reason
        }
      })
    })
  }

  async resetGrading(submissionId: string): Promise<void> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    await this.runMutation(key, async () => {
      await this.runMutation(SETTLEMENT_MUTATION_KEY, async () => {
        const scope = this.submissions.scope(key)
        const archive = await this.readArchive(scope, submissionId)
        const stored = await scope.readText<unknown>(GRADING_FILE)
        if (stored === null) return
        normalizeGradingRecord(stored, archive.submission)
        const existing = await this.readSettlementIndex()
        const next = removeSubmissionFromSettlements(existing, submissionId)
        await scope.deleteText(GRADING_FILE)
        try {
          if (!sameValue(existing, next)) await this.writeSettlementIndex(existing, next)
        } catch (reason) {
          if (!(await scope.compareAndSwapText(GRADING_FILE, null, stored))) {
            throw invalidStorage(
              `Cannot restore grading after settlement conflict: ${submissionId}`
            )
          }
          throw reason
        }
      })
    })
  }

  async listSettlementBatches(): Promise<SubmissionSettlementBatch[]> {
    return structuredClone((await this.readSettlementIndex()).batches).sort(
      (left, right) =>
        Date.parse(right.settledAt) - Date.parse(left.settledAt) ||
        right.batchId.localeCompare(left.batchId)
    )
  }

  async settleSubmissions(submissionIds: readonly string[]): Promise<SubmissionSettlementBatch> {
    const uniqueIds = [...new Set(submissionIds)]
    if (uniqueIds.length === 0 || uniqueIds.some((submissionId) => !nonEmptyString(submissionId))) {
      throw new SubmissionLibraryError(
        'GRADING_NOT_READY',
        'Settlement requires at least one submission'
      )
    }
    return this.runMutation(SETTLEMENT_MUTATION_KEY, async () => {
      const existing = await this.readSettlementIndex()
      const settled = settlementLookup(existing)
      const records: SubmissionSettlementBatchRecord[] = []
      for (const submissionId of uniqueIds) {
        if (settled.has(submissionId)) {
          throw new SubmissionLibraryError(
            'ALREADY_SETTLED',
            `Submission is already settled: ${submissionId}`,
            { submissionId }
          )
        }
        const key = await submissionStorageKey(submissionId)
        const scope = this.submissions.scope(key)
        const archive = await this.readArchive(scope, submissionId)
        const grading = await this.readGrading(scope, archive.submission)
        if (!grading || grading.status !== 'ready') {
          throw new SubmissionLibraryError(
            'GRADING_NOT_READY',
            `Submission grading is not ready for settlement: ${submissionId}`,
            { submissionId }
          )
        }
        records.push({
          submissionId,
          totalScore: grading.totalScore,
          maxScore: grading.maxScore
        })
      }
      const batch: SubmissionSettlementBatch = {
        formatVersion: 1,
        batchId: crypto.randomUUID(),
        settledAt: new Date().toISOString(),
        records
      }
      await this.writeSettlementIndex(existing, {
        ...existing,
        batches: [...existing.batches, batch]
      })
      return structuredClone(batch)
    })
  }

  async startGrading(submissionId: string): Promise<SubmissionGradingWorkspace> {
    const key = await submissionStorageKey(submissionId)
    return this.runMutation(key, async () => {
      if (settlementLookup(await this.readSettlementIndex()).has(submissionId)) {
        throw new SubmissionLibraryError('ALREADY_SETTLED', 'Submission is already settled', {
          submissionId
        })
      }
      const scope = this.submissions.scope(key)
      const archive = await this.readArchive(scope, submissionId)
      const existing = await this.readGrading(scope, archive.submission)
      const next = await applyObjectiveGrades(archive, existing)
      if (!sameValue(existing, next)) {
        await this.writeGrading(scope, archive.submission, existing, next)
      }
      return buildWorkspace(archive, next)
    })
  }

  async submitGradingResult(
    submissionId: string,
    instanceId: string,
    engine: 'human' | 'ai',
    result: GradingResult
  ): Promise<SubmissionGradingWorkspace> {
    const key = await submissionStorageKey(submissionId)
    return this.runMutation(key, async () => {
      const scope = this.submissions.scope(key)
      const archive = await this.readArchive(scope, submissionId)
      const existing = await this.readGrading(scope, archive.submission)
      if (!existing) throw invalidStorage(`Missing grading session: ${submissionId}`)
      if (existing.status === 'ready') {
        throw new SubmissionLibraryError('GRADING_COMPLETED', 'Grading is already completed', {
          submissionId
        })
      }
      const use = archive.submission.schemaUses.find((item) => item.instanceId === instanceId)
      if (!use) {
        throw new SubmissionLibraryError('NOT_FOUND', `Grading item not found: ${instanceId}`)
      }
      if (use.schema.structure.questionType === 'objective') {
        throw new SubmissionLibraryError(
          'INVALID_GRADING_RESULT',
          'Objective items cannot be graded manually'
        )
      }
      if (existing.items.some((item) => item.instanceId === instanceId)) {
        throw new SubmissionLibraryError(
          'GRADING_RESULT_LOCKED',
          `Grading result is already submitted: ${instanceId}`,
          { instanceId }
        )
      }
      assertGradingResult(result, use.schema.data.maxScore)
      const now = new Date().toISOString()
      const items = [
        ...existing.items,
        { instanceId, engine, result: structuredClone(result), gradedAt: now }
      ]
      const next = gradingRecord(archive.submission, items, now, existing.aiRuns)
      await this.writeGrading(scope, archive.submission, existing, next)
      return buildWorkspace(archive, next)
    })
  }

  async saveAIGradingRun(
    submissionId: string,
    instanceId: string,
    run: SubmissionAIGradingRunInput
  ): Promise<SubmissionGradingWorkspace> {
    const key = await submissionStorageKey(submissionId)
    return this.runMutation(key, async () => {
      const scope = this.submissions.scope(key)
      const archive = await this.readArchive(scope, submissionId)
      const existing = await this.readGrading(scope, archive.submission)
      if (!existing) throw invalidStorage(`Missing grading session: ${submissionId}`)
      const use = archive.submission.schemaUses.find((item) => item.instanceId === instanceId)
      if (!use) {
        throw new SubmissionLibraryError('NOT_FOUND', `Grading item not found: ${instanceId}`)
      }
      if (use.schema.structure.questionType === 'objective') {
        throw new SubmissionLibraryError(
          'INVALID_GRADING_RESULT',
          'Objective items cannot have AI grading runs'
        )
      }
      const nextRun: SubmissionAIGradingRun = {
        instanceId,
        ...structuredClone(run),
        updatedAt: new Date().toISOString()
      }
      assertAIGradingRun(nextRun, use.schema.data.maxScore)
      const aiRuns = [...existing.aiRuns.filter((item) => item.instanceId !== instanceId), nextRun]
      const next = { ...existing, aiRuns }
      await this.writeGrading(scope, archive.submission, existing, next)
      return buildWorkspace(archive, next)
    })
  }

  async getGradingRecord(submissionId: string): Promise<SubmissionGradingRecord | null> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    const scope = this.submissions.scope(key)
    const archive = await this.readArchive(scope, submissionId)
    return this.readGrading(scope, archive.submission)
  }

  async getReport(submissionId: string): Promise<SubmissionReport> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    const scope = this.submissions.scope(key)
    const archive = await this.readArchive(scope, submissionId)
    const grading = await this.readGrading(scope, archive.submission)
    if (!grading || grading.status !== 'ready') {
      throw new SubmissionLibraryError(
        'GRADING_NOT_COMPLETED',
        `Submission grading is not completed: ${submissionId}`
      )
    }
    if (!settlementLookup(await this.readSettlementIndex()).has(submissionId)) {
      throw new SubmissionLibraryError(
        'GRADING_NOT_SETTLED',
        `Submission grading is not settled: ${submissionId}`,
        { submissionId }
      )
    }
    const inputs = archive.submission.schemaUses.map((use) => buildGradingInput(archive, use))
    return {
      markdown: buildSubmissionReportMarkdown(archive.submission, grading, inputs),
      resources: Object.fromEntries(
        inputs.flatMap((input) =>
          Object.entries(input.resources).filter(([, resource]) => resource.kind === 'static')
        )
      )
    }
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

  private async readArchive(
    scope: SubmissionLibraryStore,
    submissionId: string
  ): Promise<Awaited<ReturnType<typeof decodeSubmissionPackage>>> {
    const record = await this.readRecord(scope, await submissionStorageKey(submissionId))
    if (!record || record.submissionId !== submissionId) {
      throw new SubmissionLibraryError('NOT_FOUND', `Submission not found: ${submissionId}`)
    }
    const data = await scope.readAsset(archiveFilename(record.archiveSha256))
    if (!data || (await sha256(data)) !== record.archiveSha256) {
      throw invalidStorage(`Submission archive is missing or corrupted: ${submissionId}`)
    }
    try {
      return await decodeSubmissionPackage(data)
    } catch (reason) {
      throw invalidStorage(
        reason instanceof Error ? reason.message : `Cannot decode submission: ${submissionId}`
      )
    }
  }

  private async readGrading(
    scope: SubmissionLibraryStore,
    submission: SubmissionPackage
  ): Promise<SubmissionGradingRecord | null> {
    const value = await scope.readText<unknown>(GRADING_FILE)
    if (value === null) return null
    return normalizeGradingRecord(value, submission)
  }

  private async writeGrading(
    scope: SubmissionLibraryStore,
    submission: SubmissionPackage,
    existing: SubmissionGradingRecord | null,
    next: SubmissionGradingRecord
  ): Promise<void> {
    const stored = await scope.readText<unknown>(GRADING_FILE)
    const current = stored === null ? null : normalizeGradingRecord(stored, submission)
    if (!sameValue(current, existing)) {
      throw invalidStorage(`Concurrent grading update: ${next.submissionId}`)
    }
    if (!(await scope.compareAndSwapText(GRADING_FILE, stored, next))) {
      throw invalidStorage(`Concurrent grading update: ${next.submissionId}`)
    }
  }

  private async readSettlementIndex(): Promise<SubmissionSettlementIndex> {
    const value = await this.settlements.readText<unknown>(SETTLEMENT_FILE)
    if (value === null) return { formatVersion: 1, batches: [] }
    if (!isSettlementIndex(value)) throw invalidStorage('Invalid settlement index')
    return structuredClone(value)
  }

  private async writeSettlementIndex(
    existing: SubmissionSettlementIndex,
    next: SubmissionSettlementIndex
  ): Promise<void> {
    const stored = await this.settlements.readText<unknown>(SETTLEMENT_FILE)
    const current = stored === null ? { formatVersion: 1, batches: [] } : stored
    if (!sameValue(current, existing)) {
      throw new SubmissionLibraryError('SETTLEMENT_CONFLICT', 'Settlement data changed')
    }
    const expected = stored === null ? null : stored
    if (!(await this.settlements.compareAndSwapText(SETTLEMENT_FILE, expected, next))) {
      throw new SubmissionLibraryError('SETTLEMENT_CONFLICT', 'Settlement data changed')
    }
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

export const objectiveGradingEngine: GradingEngine = {
  kind: 'objective',
  async grade(input) {
    if (input.schema.structure.questionType !== 'objective') {
      throw new SubmissionLibraryError(
        'INVALID_GRADING_RESULT',
        'Objective engine only accepts objective grading inputs'
      )
    }
    const answer = input.answers.find(
      (item): item is Extract<ResolvedGradingAnswer, { type: 'text' }> => item.type === 'text'
    )
    const analysis = input.inputs.find(
      (item) => item.inputId === OBJECTIVE_ANALYSIS_INPUT_ID
    )?.value
    if (!answer || analysis === undefined) {
      throw new SubmissionLibraryError(
        'INVALID_GRADING_RESULT',
        'Objective grading input is incomplete'
      )
    }
    return {
      score: answer.value !== null && answer.value === analysis ? input.schema.data.maxScore : 0,
      comment: ''
    }
  }
}

export function createHumanGradingEngine(
  decide: (input: GradingInput) => Promise<GradingResult> | GradingResult
): GradingEngine {
  return {
    kind: 'human',
    async grade(input) {
      if (input.schema.structure.questionType === 'objective') {
        throw new SubmissionLibraryError(
          'INVALID_GRADING_RESULT',
          'Objective items do not enter the human grading engine'
        )
      }
      const result = await decide(input)
      assertGradingResult(result, input.schema.data.maxScore)
      return structuredClone(result)
    }
  }
}

export function buildGradingInput(
  archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>,
  use: SubmissionSchemaUse
): GradingInput {
  const resources = buildResources(archive, gradingResourceKeys(archive.submission, use))
  const descriptions = use.schema.data.answerDescriptions
  const answers = use.answers.map<ResolvedGradingAnswer>((answer) => {
    const description = descriptions[answer.answerId] ?? answer.answerId
    if (answer.type === 'text') {
      return {
        answerId: answer.answerId,
        description,
        type: 'text',
        value: archive.submission.answers.strings[answer.stringAnswerIndex] ?? null
      }
    }
    const audioAnswer = archive.submission.answers.audios[answer.audioAnswerIndex]
    const resource = resources[audioAnswer.resourceKey]
    if (!resource) throw invalidStorage(`Missing answer audio: ${audioAnswer.resourceKey}`)
    const audio = { ...resource, durationMs: audioAnswer.durationMs }
    return answer.type === 'fixed-speech'
      ? { answerId: answer.answerId, description, type: answer.type, text: answer.text, audio }
      : { answerId: answer.answerId, description, type: answer.type, audio }
  })
  return {
    submission: structuredClone(archive.submission.meta),
    instanceId: use.instanceId,
    schema: structuredClone(use.schema),
    inputs: structuredClone(use.inputs),
    answers,
    resources
  }
}

export function buildSubmissionReportMarkdown(
  submission: SubmissionPackage,
  grading: SubmissionGradingRecord,
  inputs: readonly GradingInput[]
): string {
  const candidate = submission.meta.candidate
  const lines = [
    `# ${escapeInline(candidate.displayName)} - ${escapeInline(submission.meta.examTitle)}`,
    '',
    '| 姓名 | 学号 | 试卷名称 | 总分 | 作答时间 |',
    '| :---: | :---: | :---: | :---: | :---: |',
    `| ${escapeTable(candidate.displayName)} | ${escapeTable(candidate.candidateId)} | ${escapeTable(submission.meta.examTitle)} | ${grading.totalScore}/${grading.maxScore} | ${escapeTable(formatDateTime(submission.meta.submittedAt))} |`,
    '',
    '---',
    '',
    '## 分数概览',
    '',
    `| ${inputs.map((_, index) => `第 ${index + 1} 题`).join(' | ')} |`,
    `| ${inputs.map(() => ':---:').join(' | ')} |`,
    `| ${inputs
      .map((input) => {
        const item = grading.items.find((entry) => entry.instanceId === input.instanceId)
        return `${item?.result.score ?? '-'}/${input.schema.data.maxScore}`
      })
      .join(' | ')} |`,
    ''
  ]

  inputs.forEach((input, index) => {
    const item = grading.items.find((entry) => entry.instanceId === input.instanceId)
    const question = input.inputs.find(
      (entry) => entry.inputId === QUESTION_DESCRIPTION_INPUT_ID
    )?.value
    const analysis = input.inputs.find(
      (entry) => entry.inputId === OBJECTIVE_ANALYSIS_INPUT_ID
    )?.value
    const referenceAnswer = input.inputs.find(
      (entry) => entry.inputId === REFERENCE_ANSWER_INPUT_ID
    )?.value
    lines.push(
      '---',
      '',
      `## 第 ${index + 1} 题：${escapeInline(input.schema.data.name)}`,
      '',
      '### 题目',
      '',
      question || '无题目描述',
      '',
      `**分数：${item?.result.score ?? '-'}/${input.schema.data.maxScore}**`,
      '',
      `**评语：${item?.result.comment || '无'}**`,
      ''
    )

    if (input.schema.structure.questionType === 'objective') {
      const answer = input.answers.find(
        (entry): entry is Extract<ResolvedGradingAnswer, { type: 'text' }> => entry.type === 'text'
      )
      const correct = answer?.value !== null && answer?.value === analysis
      lines.push(
        '### 答题详情',
        '',
        `- 正确答案：${analysis ?? ''}`,
        `- 学生答案：${answer?.value ?? '未作答'}`,
        `- 正误：${correct ? '正确' : '错误'}`,
        ''
      )
    } else {
      lines.push('### 参考答案', '', referenceAnswer || '无', '', '### 学生答案', '')
      for (const answer of input.answers) {
        if (answer.type === 'text') {
          lines.push(`- ${answer.description}：${answer.value ?? '未作答'}`)
        } else {
          const fixedText = answer.type === 'fixed-speech' ? `；原文：${answer.text}` : ''
          lines.push(
            `- ${answer.description}：录音 ${formatDuration(answer.audio.durationMs)}${fixedText}`
          )
        }
      }
      lines.push('', '### 评分标准', '', input.schema.data.rubricMarkdown || '无', '')
    }
  })

  return `${lines.join('\n').trim()}\n`
}

async function applyObjectiveGrades(
  archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>,
  existing: SubmissionGradingRecord | null
): Promise<SubmissionGradingRecord> {
  if (existing?.status === 'ready') return existing
  const items = existing ? [...existing.items] : []
  for (const use of archive.submission.schemaUses) {
    if (
      use.schema.structure.questionType !== 'objective' ||
      items.some((item) => item.instanceId === use.instanceId)
    ) {
      continue
    }
    const result = await objectiveGradingEngine.grade(buildGradingInput(archive, use))
    items.push({
      instanceId: use.instanceId,
      engine: 'objective',
      result,
      gradedAt: new Date().toISOString()
    })
  }
  return gradingRecord(archive.submission, items, new Date().toISOString(), existing?.aiRuns ?? [])
}

function gradingRecord(
  submission: SubmissionPackage,
  items: SubmissionGradingItem[],
  readyAt: string,
  aiRuns: SubmissionAIGradingRun[] = []
): SubmissionGradingRecord {
  const expectedIds = new Set(submission.schemaUses.map((use) => use.instanceId))
  const uniqueIds = new Set(items.map((item) => item.instanceId))
  if (uniqueIds.size !== items.length || items.some((item) => !expectedIds.has(item.instanceId))) {
    throw invalidStorage(`Grading results do not match submission: ${submission.meta.submissionId}`)
  }
  const complete = uniqueIds.size === expectedIds.size
  return {
    formatVersion: 1,
    submissionId: submission.meta.submissionId,
    status: complete ? 'ready' : 'grading',
    items: structuredClone(items),
    aiRuns: structuredClone(aiRuns),
    totalScore: items.reduce((total, item) => total + item.result.score, 0),
    maxScore: submission.schemaUses.reduce((total, use) => total + use.schema.data.maxScore, 0),
    ...(complete ? { readyAt } : {})
  }
}

function buildWorkspace(
  archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>,
  grading: SubmissionGradingRecord
): SubmissionGradingWorkspace {
  return {
    submission: structuredClone(archive.submission),
    grading: structuredClone(grading),
    inputs: archive.submission.schemaUses.map((use) => buildGradingInput(archive, use))
  }
}

function buildResources(
  archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>,
  resourceKeys: ReadonlySet<string>
): Record<string, GradingResourceInput> {
  return Object.fromEntries(
    [...resourceKeys].map((resourceKey) => {
      const entry = archive.submission.resources[resourceKey]
      if (!entry) throw invalidStorage(`Unknown submission resource: ${resourceKey}`)
      const data = archive.files[resourceKey]
      if (!data) throw invalidStorage(`Missing submission resource: ${resourceKey}`)
      const resource: GradingResourceInput = {
        resourceKey,
        filename: entry.filename,
        kind: entry.packagePath.startsWith('recordings/') ? 'recording' : 'static',
        data,
        ...(entry.mediaType ? { mediaType: entry.mediaType } : {})
      }
      return [resourceKey, resource]
    })
  )
}

function gradingResourceKeys(
  submission: SubmissionPackage,
  use: SubmissionSchemaUse
): ReadonlySet<string> {
  const keys = new Set<string>()
  const texts = [
    ...use.inputs.map((input) => input.value),
    ...use.answers.flatMap((answer) => (answer.type === 'fixed-speech' ? [answer.text] : []))
  ]
  for (const text of texts) {
    for (const match of text.matchAll(RESOURCE_REFERENCE_PATTERN)) keys.add(match[1])
  }
  for (const answer of use.answers) {
    if (answer.type === 'text') continue
    const audio = submission.answers.audios[answer.audioAnswerIndex]
    if (!audio) throw invalidStorage(`Missing audio answer index: ${answer.audioAnswerIndex}`)
    keys.add(audio.resourceKey)
  }
  return keys
}

function assertGradingResult(result: GradingResult, maxScore: number): void {
  if (
    !result ||
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    result.score > maxScore ||
    typeof result.comment !== 'string'
  ) {
    throw new SubmissionLibraryError(
      'INVALID_GRADING_RESULT',
      `Grading result must contain a score from 0 to ${maxScore} and a string comment`,
      { maxScore }
    )
  }
}

function normalizeGradingRecord(
  value: unknown,
  submission: SubmissionPackage
): SubmissionGradingRecord {
  const legacyCompleted = isRecord(value) && value.status === 'completed'
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    value.submissionId !== submission.meta.submissionId ||
    (value.status !== 'grading' && value.status !== 'ready' && !legacyCompleted) ||
    !Array.isArray(value.items) ||
    !value.items.every(isSubmissionGradingItem) ||
    (value.aiRuns !== undefined &&
      (!Array.isArray(value.aiRuns) || !value.aiRuns.every(isSubmissionAIGradingRun))) ||
    (value.readyAt !== undefined && !isoDate(value.readyAt)) ||
    (legacyCompleted && value.completedAt !== undefined && !isoDate(value.completedAt))
  ) {
    throw invalidStorage(`Invalid grading record: ${submission.meta.submissionId}`)
  }

  const items = structuredClone(value.items) as SubmissionGradingItem[]
  const aiRuns =
    value.aiRuns === undefined ? [] : (structuredClone(value.aiRuns) as SubmissionAIGradingRun[])
  const usesById = new Map(submission.schemaUses.map((use) => [use.instanceId, use]))
  const ids = new Set<string>()
  for (const item of items) {
    const use = usesById.get(item.instanceId)
    if (!use || ids.has(item.instanceId) || item.result.score > use.schema.data.maxScore) {
      throw invalidStorage(`Grading item does not match submission: ${item.instanceId}`)
    }
    ids.add(item.instanceId)
    if (use.schema.structure.questionType === 'objective') {
      const expected = objectiveResult(submission, use)
      if (
        item.engine !== 'objective' ||
        item.result.score !== expected.score ||
        item.result.comment !== expected.comment
      ) {
        throw invalidStorage(`Invalid objective grading result: ${item.instanceId}`)
      }
    } else if (item.engine === 'objective') {
      throw invalidStorage(`Invalid grading engine for item: ${item.instanceId}`)
    }
  }

  const aiRunIds = new Set<string>()
  for (const run of aiRuns) {
    const use = usesById.get(run.instanceId)
    if (
      !use ||
      use.schema.structure.questionType === 'objective' ||
      aiRunIds.has(run.instanceId) ||
      (run.result !== undefined && run.result.score > use.schema.data.maxScore)
    ) {
      throw invalidStorage(`Invalid AI grading run: ${run.instanceId}`)
    }
    aiRunIds.add(run.instanceId)
  }

  const readyAt =
    typeof value.readyAt === 'string'
      ? value.readyAt
      : legacyCompleted && typeof value.completedAt === 'string'
        ? value.completedAt
        : items.reduce(
            (latest, item) =>
              Date.parse(item.gradedAt) > Date.parse(latest) ? item.gradedAt : latest,
            submission.meta.submittedAt
          )
  return gradingRecord(submission, items, readyAt, aiRuns)
}

function settlementLookup(
  index: SubmissionSettlementIndex
): Map<string, SubmissionSettlementSummary> {
  return new Map(
    index.batches.flatMap((batch) =>
      batch.records.map((record) => [
        record.submissionId,
        { batchId: batch.batchId, settledAt: batch.settledAt }
      ])
    )
  )
}

function removeSubmissionFromSettlements(
  index: SubmissionSettlementIndex,
  submissionId: string
): SubmissionSettlementIndex {
  return {
    ...index,
    batches: index.batches.flatMap((batch) => {
      const records = batch.records.filter((record) => record.submissionId !== submissionId)
      return records.length === 0 ? [] : [{ ...batch, records }]
    })
  }
}

function isSettlementIndex(value: unknown): value is SubmissionSettlementIndex {
  if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.batches)) return false
  const batchIds = new Set<string>()
  const submissionIds = new Set<string>()
  for (const batch of value.batches) {
    if (
      !isRecord(batch) ||
      batch.formatVersion !== 1 ||
      !nonEmptyString(batch.batchId) ||
      !isoDate(batch.settledAt) ||
      !Array.isArray(batch.records) ||
      batch.records.length === 0 ||
      batchIds.has(batch.batchId)
    ) {
      return false
    }
    batchIds.add(batch.batchId)
    for (const record of batch.records) {
      if (
        !isRecord(record) ||
        !nonEmptyString(record.submissionId) ||
        typeof record.totalScore !== 'number' ||
        !Number.isFinite(record.totalScore) ||
        record.totalScore < 0 ||
        typeof record.maxScore !== 'number' ||
        !Number.isFinite(record.maxScore) ||
        record.maxScore < 0 ||
        record.totalScore > record.maxScore ||
        submissionIds.has(record.submissionId)
      ) {
        return false
      }
      submissionIds.add(record.submissionId)
    }
  }
  return true
}

function isSubmissionGradingItem(value: unknown): value is SubmissionGradingItem {
  return (
    isRecord(value) &&
    nonEmptyString(value.instanceId) &&
    (value.engine === 'objective' || value.engine === 'human' || value.engine === 'ai') &&
    isRecord(value.result) &&
    typeof value.result.score === 'number' &&
    Number.isFinite(value.result.score) &&
    value.result.score >= 0 &&
    typeof value.result.comment === 'string' &&
    isoDate(value.gradedAt)
  )
}

function isSubmissionAIGradingRun(value: unknown): value is SubmissionAIGradingRun {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.instanceId) ||
    (value.status !== 'processing' && value.status !== 'succeeded' && value.status !== 'failed') ||
    !isAIModelSelection(value.speechRecognitionModel) ||
    !isAIModelSelection(value.textModel) ||
    !Array.isArray(value.answers) ||
    !value.answers.every(isAIProcessedAnswer) ||
    (value.prompt !== undefined && typeof value.prompt !== 'string') ||
    (value.rawResponse !== undefined && typeof value.rawResponse !== 'string') ||
    (value.result !== undefined && !isGradingResult(value.result)) ||
    (value.error !== undefined && typeof value.error !== 'string') ||
    (value.review !== undefined && !isAIReview(value.review)) ||
    !isoDate(value.updatedAt)
  ) {
    return false
  }
  if (value.status === 'succeeded') {
    return (
      value.result !== undefined && value.rawResponse !== undefined && value.error === undefined
    )
  }
  if (value.status === 'failed') return nonEmptyString(value.error)
  return value.result === undefined && value.error === undefined
}

function isAIReview(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.mode === 'none' || value.mode === 'all' || value.mode === 'sample') &&
    typeof value.selected === 'boolean' &&
    typeof value.reviewed === 'boolean' &&
    (value.finalResult === undefined || isGradingResult(value.finalResult)) &&
    (!value.reviewed || (value.selected && value.finalResult !== undefined))
  )
}

function isAIModelSelection(value: unknown): value is SubmissionAIModelSelection {
  return isRecord(value) && nonEmptyString(value.providerId) && nonEmptyString(value.modelId)
}

function isAIProcessedAnswer(value: unknown): value is SubmissionAIProcessedAnswer {
  return (
    isRecord(value) &&
    nonEmptyString(value.answerId) &&
    typeof value.description === 'string' &&
    typeof value.transcript === 'string' &&
    typeof value.correction === 'string' &&
    (value.referenceText === undefined || typeof value.referenceText === 'string')
  )
}

function isGradingResult(value: unknown): value is GradingResult {
  return (
    isRecord(value) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    typeof value.comment === 'string'
  )
}

function assertAIGradingRun(run: SubmissionAIGradingRun, maxScore: number): void {
  if (!isSubmissionAIGradingRun(run) || (run.result && run.result.score > maxScore)) {
    throw new SubmissionLibraryError('INVALID_GRADING_RESULT', 'AI grading run is invalid', {
      maxScore
    })
  }
}

function objectiveResult(submission: SubmissionPackage, use: SubmissionSchemaUse): GradingResult {
  const answer = use.answers.find(
    (item): item is Extract<SubmissionSchemaUse['answers'][number], { type: 'text' }> =>
      item.type === 'text'
  )
  const analysis = use.inputs.find((input) => input.inputId === OBJECTIVE_ANALYSIS_INPUT_ID)?.value
  if (!answer || analysis === undefined) {
    throw invalidStorage(`Incomplete objective grading item: ${use.instanceId}`)
  }
  const studentAnswer = submission.answers.strings[answer.stringAnswerIndex] ?? null
  return {
    score: studentAnswer !== null && studentAnswer === analysis ? use.schema.data.maxScore : 0,
    comment: ''
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function escapeInline(value: string): string {
  return value.replace(/[\\`*_[\]<>]/g, '\\$&').replace(/\s*\n\s*/g, ' ')
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds} 秒`
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
