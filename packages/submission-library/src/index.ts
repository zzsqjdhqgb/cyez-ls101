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
const ARCHIVE_EXTENSION = '.lssubmission'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const QUESTION_DESCRIPTION_INPUT_ID = 'question-description'
const OBJECTIVE_ANALYSIS_INPUT_ID = 'analysis'

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

export interface SubmissionGradingRecord {
  formatVersion: 1
  submissionId: string
  status: 'grading' | 'completed'
  items: SubmissionGradingItem[]
  totalScore: number
  maxScore: number
  completedAt?: string
}

export interface SubmissionGradingSummary {
  status: SubmissionGradingRecord['status']
  gradedCount: number
  totalCount: number
  totalScore: number
  maxScore: number
  completedAt?: string
}

export interface SubmissionLibraryEntry {
  record: SubmissionLibraryRecord
  grading: SubmissionGradingSummary | null
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
  startGrading(submissionId: string): Promise<SubmissionGradingWorkspace>
  submitGradingResult(
    submissionId: string,
    instanceId: string,
    engine: 'human' | 'ai',
    result: GradingResult
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
      | 'GRADING_NOT_COMPLETED',
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

  async listEntries(): Promise<SubmissionLibraryEntry[]> {
    const records = await this.listRecords()
    return Promise.all(
      records.map(async (record) => {
        const key = await submissionStorageKey(record.submissionId)
        const grading = await this.readGrading(this.submissions.scope(key), record.submissionId)
        return {
          record,
          grading: grading
            ? {
                status: grading.status,
                gradedCount: grading.items.length,
                totalCount: record.schemaUseCount,
                totalScore: grading.totalScore,
                maxScore: grading.maxScore,
                ...(grading.completedAt ? { completedAt: grading.completedAt } : {})
              }
            : null
        }
      })
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
      const grading = await this.readGrading(scope, submissionId)
      if (grading?.status === 'completed') {
        throw new SubmissionLibraryError(
          'GRADING_COMPLETED',
          `Completed submission cannot be deleted: ${submissionId}`,
          { submissionId }
        )
      }
      await scope.clear()
    })
  }

  async startGrading(submissionId: string): Promise<SubmissionGradingWorkspace> {
    const key = await submissionStorageKey(submissionId)
    return this.runMutation(key, async () => {
      const scope = this.submissions.scope(key)
      const archive = await this.readArchive(scope, submissionId)
      const existing = await this.readGrading(scope, submissionId)
      const next = await applyObjectiveGrades(archive, existing)
      if (!sameValue(existing, next)) await this.writeGrading(scope, existing, next)
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
      const existing = await this.readGrading(scope, submissionId)
      if (!existing) throw invalidStorage(`Missing grading session: ${submissionId}`)
      if (existing.status === 'completed') {
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
      const next = gradingRecord(archive.submission, items, now)
      await this.writeGrading(scope, existing, next)
      return buildWorkspace(archive, next)
    })
  }

  async getGradingRecord(submissionId: string): Promise<SubmissionGradingRecord | null> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    return this.readGrading(this.submissions.scope(key), submissionId)
  }

  async getReport(submissionId: string): Promise<SubmissionReport> {
    assertSubmissionId(submissionId)
    const key = await submissionStorageKey(submissionId)
    const scope = this.submissions.scope(key)
    const archive = await this.readArchive(scope, submissionId)
    const grading = await this.readGrading(scope, submissionId)
    if (!grading || grading.status !== 'completed') {
      throw new SubmissionLibraryError(
        'GRADING_NOT_COMPLETED',
        `Submission grading is not completed: ${submissionId}`
      )
    }
    const inputs = archive.submission.schemaUses.map((use) => buildGradingInput(archive, use))
    return {
      markdown: buildSubmissionReportMarkdown(archive.submission, grading, inputs),
      resources: inputs[0]?.resources ?? buildResources(archive)
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
    submissionId: string
  ): Promise<SubmissionGradingRecord | null> {
    const value = await scope.readText<unknown>(GRADING_FILE)
    if (value === null) return null
    if (!isSubmissionGradingRecord(value) || value.submissionId !== submissionId) {
      throw invalidStorage(`Invalid grading record: ${submissionId}`)
    }
    return structuredClone(value)
  }

  private async writeGrading(
    scope: SubmissionLibraryStore,
    existing: SubmissionGradingRecord | null,
    next: SubmissionGradingRecord
  ): Promise<void> {
    if (!(await scope.compareAndSwapText(GRADING_FILE, existing, next))) {
      throw invalidStorage(`Concurrent grading update: ${next.submissionId}`)
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
  const resources = buildResources(archive)
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
      lines.push('### 学生答案', '')
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
  if (existing?.status === 'completed') return existing
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
  return gradingRecord(archive.submission, items, new Date().toISOString())
}

function gradingRecord(
  submission: SubmissionPackage,
  items: SubmissionGradingItem[],
  completedAt: string
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
    status: complete ? 'completed' : 'grading',
    items: structuredClone(items),
    totalScore: items.reduce((total, item) => total + item.result.score, 0),
    maxScore: submission.schemaUses.reduce((total, use) => total + use.schema.data.maxScore, 0),
    ...(complete ? { completedAt } : {})
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
  archive: Awaited<ReturnType<typeof decodeSubmissionPackage>>
): Record<string, GradingResourceInput> {
  return Object.fromEntries(
    Object.entries(archive.submission.resources).map(([resourceKey, entry]) => {
      const data = archive.files[resourceKey]
      if (!data) throw invalidStorage(`Missing submission resource: ${resourceKey}`)
      const resource: GradingResourceInput = {
        resourceKey,
        filename: entry.filename,
        kind: entry.packagePath.startsWith('recordings/') ? 'recording' : 'static',
        data: new Uint8Array(data),
        ...(entry.mediaType ? { mediaType: entry.mediaType } : {})
      }
      return [resourceKey, resource]
    })
  )
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

function isSubmissionGradingRecord(value: unknown): value is SubmissionGradingRecord {
  if (
    !isRecord(value) ||
    value.formatVersion !== 1 ||
    !nonEmptyString(value.submissionId) ||
    (value.status !== 'grading' && value.status !== 'completed') ||
    !Array.isArray(value.items) ||
    !value.items.every(isSubmissionGradingItem) ||
    typeof value.totalScore !== 'number' ||
    !Number.isFinite(value.totalScore) ||
    value.totalScore < 0 ||
    typeof value.maxScore !== 'number' ||
    !Number.isFinite(value.maxScore) ||
    value.maxScore < 0
  ) {
    return false
  }
  const ids = new Set(value.items.map((item) => item.instanceId))
  if (ids.size !== value.items.length) return false
  return value.status === 'completed' ? isoDate(value.completedAt) : value.completedAt === undefined
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
