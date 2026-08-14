import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { describe, expect, it } from 'vitest'
import {
  createHumanGradingEngine,
  FileSubmissionLibraryRepository,
  objectiveGradingEngine,
  type GradingInput,
  type SubmissionGradingRecord,
  type SubmissionLibraryStore
} from '../index'

const schema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000001',
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'1'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'objective',
    answerFormat: [{ answerId: 'answer', type: 'text' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'analysis', type: 'text', required: true }
    ]
  },
  data: {
    name: 'Objective question',
    description: 'Objective grading schema',
    maxScore: 2,
    answerDescriptions: { answer: 'Student answer' },
    inputDescriptions: {},
    rubricMarkdown: ''
  }
}

function submission(answer = 'A'): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-1',
      examPackageId: 'exam-package-1',
      examTitle: 'Archive exam',
      candidate: { candidateId: 'candidate-1', displayName: 'Student' },
      startedAt: '2026-08-10T01:00:00Z',
      submittedAt: '2026-08-10T01:10:00Z'
    },
    answers: { strings: [answer], audios: [] },
    schemaUses: [
      {
        instanceId: 'schema-use:objective',
        schema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: 'Choose one.' },
          { inputId: 'analysis', type: 'text', value: 'A' }
        ],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      }
    ],
    resources: {}
  }
}

describe('FileSubmissionLibraryRepository', () => {
  it('导入、列出并原样导出作答包', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const bytes = await encodeSubmissionPackage(submission(), {})

    const imported = await repository.importArchive(bytes)
    expect(imported.status).toBe('created')
    expect(imported.record).toMatchObject({
      submissionId: 'submission-1',
      examTitle: 'Archive exam',
      candidateId: 'candidate-1',
      candidateName: 'Student',
      schemaUseCount: 1
    })
    expect(await repository.listRecords()).toEqual([imported.record])
    expect(await repository.getRecord('submission-1')).toEqual(imported.record)
    expect(await repository.exportArchive('submission-1')).toEqual(bytes)
  })

  it('相同归档重复导入时保持幂等', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const bytes = await encodeSubmissionPackage(submission(), {})
    const first = await repository.importArchive(bytes)
    const second = await repository.importArchive(bytes)

    expect(second).toEqual({ status: 'duplicate', record: first.record })
    expect(await repository.listRecords()).toHaveLength(1)
  })

  it('拒绝相同 submissionId 的不同内容', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    await repository.importArchive(await encodeSubmissionPackage(submission('A'), {}))

    await expect(
      repository.importArchive(await encodeSubmissionPackage(submission('B'), {}))
    ).rejects.toMatchObject({
      code: 'SUBMISSION_ID_CONFLICT'
    })
  })

  it('删除作答并拒绝导出不存在的记录', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    await repository.importArchive(await encodeSubmissionPackage(submission(), {}))
    await repository.deleteSubmission('submission-1')

    expect(await repository.listRecords()).toEqual([])
    await expect(repository.exportArchive('submission-1')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('按 submissionId 串行化导入和删除', async () => {
    const store = new MemoryStore()
    const repository = new FileSubmissionLibraryRepository(store)
    const bytes = await encodeSubmissionPackage(submission(), {})
    let releaseWrite: () => void = () => undefined
    let signalWrite: () => void = () => undefined
    const writeReached = new Promise<void>((resolve) => {
      signalWrite = resolve
    })
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    store.pauseNextAssetWrite(async () => {
      signalWrite()
      await writeBlocked
    })

    const importing = repository.importArchive(bytes)
    await writeReached
    const deleting = repository.deleteSubmission('submission-1')
    releaseWrite()
    await Promise.all([importing, deleting])

    expect(await repository.listRecords()).toEqual([])
    await expect(repository.exportArchive('submission-1')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('按实际时间而不是 ISO 字符串排序', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const earlier = submission()
    earlier.meta.submissionId = 'submission-earlier'
    earlier.meta.startedAt = '2026-08-10T11:50:00+08:00'
    earlier.meta.submittedAt = '2026-08-10T12:00:00+08:00'
    const later = submission()
    later.meta.submissionId = 'submission-later'
    later.meta.startedAt = '2026-08-10T04:50:00Z'
    later.meta.submittedAt = '2026-08-10T05:00:00Z'

    await repository.importArchive(await encodeSubmissionPackage(earlier, {}))
    await repository.importArchive(await encodeSubmissionPackage(later, {}))

    expect((await repository.listRecords()).map((record) => record.submissionId)).toEqual([
      'submission-later',
      'submission-earlier'
    ])
  })

  it('拒绝损坏的作答包', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    await expect(repository.importArchive(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE'
    })
  })

  it('客观题严格比较学生答案和解析，空答案计零分', async () => {
    const correct = objectiveInput('A', 'A')
    await expect(objectiveGradingEngine.grade(correct)).resolves.toEqual({ score: 2, comment: '' })
    await expect(objectiveGradingEngine.grade(objectiveInput('a', 'A'))).resolves.toEqual({
      score: 0,
      comment: ''
    })
    await expect(objectiveGradingEngine.grade(objectiveInput(null, ''))).resolves.toEqual({
      score: 0,
      comment: ''
    })
  })

  it('人工引擎与客观题引擎使用同一输入契约并允许小数和空评语', async () => {
    const input = readingInput()
    const engine = createHumanGradingEngine((received) => {
      expect(received).toBe(input)
      return { score: 3.75, comment: '' }
    })

    await expect(engine.grade(input)).resolves.toEqual({ score: 3.75, comment: '' })
  })

  it('自动批改客观题、锁定已提交结果并在结算后生成报告', async () => {
    const store = new MemoryStore()
    const repository = new FileSubmissionLibraryRepository(store)
    const source = mixedSubmission()
    const bytes = await encodeSubmissionPackage(source, mixedSubmissionFiles())
    await repository.importArchive(bytes)

    const started = await repository.startGrading(source.meta.submissionId)
    expect(started.grading).toMatchObject({
      status: 'grading',
      totalScore: 2,
      maxScore: 7,
      items: [{ instanceId: 'schema-use:objective', engine: 'objective' }]
    })
    expect(Object.keys(started.inputs[0].resources)).toEqual(['objective-image'])
    expect(Object.keys(started.inputs[1].resources).sort()).toEqual([
      'answer-audio-0',
      'reading-image'
    ])
    expect(started.inputs[1].resources['answer-audio-0'].data).toEqual(
      new Uint8Array([82, 73, 70, 70])
    )

    const ready = await repository.submitGradingResult(
      source.meta.submissionId,
      'schema-use:reading',
      'human',
      { score: 4.25, comment: '' }
    )
    expect(ready.grading).toMatchObject({
      status: 'ready',
      totalScore: 6.25,
      maxScore: 7
    })

    const scope = await importedSubmissionScope(store)
    const stored = await scope.readText<SubmissionGradingRecord>('grading.json')
    expect(stored).not.toBeNull()
    expect(
      await scope.compareAndSwapText('grading.json', stored, {
        ...stored!,
        totalScore: 999,
        maxScore: 999
      })
    ).toBe(true)

    await expect(
      repository.submitGradingResult(source.meta.submissionId, 'schema-use:reading', 'human', {
        score: 4,
        comment: '再次提交'
      })
    ).rejects.toMatchObject({ code: 'GRADING_COMPLETED' })
    const batch = await repository.settleSubmissions([source.meta.submissionId])
    expect(batch.records).toEqual([
      { submissionId: source.meta.submissionId, totalScore: 6.25, maxScore: 7 }
    ])

    const report = await repository.getReport(source.meta.submissionId)
    expect(report.markdown).toContain('# Student - Archive exam')
    expect(report.markdown).toContain('| 6.25/7 |')
    expect(report.markdown).toContain('- 正确答案：A')
    expect(report.markdown).toContain('- 学生答案：A')
    expect(report.markdown).toContain('**分数：4.25/5**')
    expect(report.markdown).toContain('**评语：无**')
    expect(Object.keys(report.resources).sort()).toEqual(['objective-image', 'reading-image'])

    const [entry] = await repository.listEntries()
    expect(entry.grading).toMatchObject({
      status: 'ready',
      gradedCount: 2,
      totalCount: 2,
      totalScore: 6.25,
      maxScore: 7
    })
    expect(entry.settlement).toEqual({ batchId: batch.batchId, settledAt: batch.settledAt })
  })

  it('结算整体校验全部记录并拒绝产生部分批次', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const ready = submission()
    const pending = mixedSubmission()
    pending.meta.submissionId = 'submission-pending'
    await repository.importArchive(await encodeSubmissionPackage(ready, {}))
    await repository.importArchive(await encodeSubmissionPackage(pending, mixedSubmissionFiles()))
    await repository.startGrading(ready.meta.submissionId)
    await repository.startGrading(pending.meta.submissionId)

    await expect(
      repository.settleSubmissions([ready.meta.submissionId, pending.meta.submissionId])
    ).rejects.toMatchObject({ code: 'GRADING_NOT_READY' })
    expect(await repository.listSettlementBatches()).toEqual([])
    expect((await repository.listEntries()).every((entry) => entry.settlement === null)).toBe(true)
  })

  it('重新评分会删除评分结果并从批次移回未结算列表', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const first = submission()
    const second = submission('B')
    second.meta.submissionId = 'submission-2'
    await repository.importArchive(await encodeSubmissionPackage(first, {}))
    await repository.importArchive(await encodeSubmissionPackage(second, {}))
    await repository.startGrading(first.meta.submissionId)
    await repository.startGrading(second.meta.submissionId)
    const batch = await repository.settleSubmissions([
      first.meta.submissionId,
      second.meta.submissionId
    ])

    await repository.resetGrading(first.meta.submissionId)

    expect(await repository.getGradingRecord(first.meta.submissionId)).toBeNull()
    const entries = await repository.listEntries()
    expect(
      entries.find((entry) => entry.record.submissionId === first.meta.submissionId)
    ).toMatchObject({
      grading: null,
      settlement: null
    })
    expect(await repository.listSettlementBatches()).toEqual([
      {
        ...batch,
        records: [{ submissionId: second.meta.submissionId, totalScore: 0, maxScore: 2 }]
      }
    ])
  })

  it('已结算记录仍可删除并在最后一条移除后删除空批次', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const source = submission()
    await repository.importArchive(await encodeSubmissionPackage(source, {}))
    await repository.startGrading(source.meta.submissionId)
    await repository.settleSubmissions([source.meta.submissionId])

    await repository.deleteSubmission(source.meta.submissionId)

    expect(await repository.listEntries()).toEqual([])
    expect(await repository.listSettlementBatches()).toEqual([])
  })

  it('根据原始作答包重算评分汇总和完成状态', async () => {
    const store = new MemoryStore()
    const repository = new FileSubmissionLibraryRepository(store)
    const source = mixedSubmission()
    await repository.importArchive(await encodeSubmissionPackage(source, mixedSubmissionFiles()))
    await repository.startGrading(source.meta.submissionId)

    const scope = await importedSubmissionScope(store)
    const stored = await scope.readText<SubmissionGradingRecord>('grading.json')
    expect(stored).not.toBeNull()
    const corrupted = {
      ...stored!,
      status: 'ready' as const,
      totalScore: 999,
      maxScore: 999,
      readyAt: '2026-08-10T04:00:00Z'
    }
    expect(await scope.compareAndSwapText('grading.json', stored, corrupted)).toBe(true)

    const [entry] = await repository.listEntries()
    expect(entry.grading).toEqual({
      status: 'grading',
      gradedCount: 1,
      totalCount: 2,
      totalScore: 2,
      maxScore: 7
    })
    await expect(repository.deleteSubmission(source.meta.submissionId)).resolves.toBeUndefined()
  })

  it('拒绝与作答包题目或分数上限不一致的持久化评分项', async () => {
    const store = new MemoryStore()
    const repository = new FileSubmissionLibraryRepository(store)
    const source = mixedSubmission()
    await repository.importArchive(await encodeSubmissionPackage(source, mixedSubmissionFiles()))
    await repository.startGrading(source.meta.submissionId)

    const scope = await importedSubmissionScope(store)
    const stored = await scope.readText<SubmissionGradingRecord>('grading.json')
    expect(stored).not.toBeNull()
    const corrupted = structuredClone(stored!)
    corrupted.items[0].result.score = 999
    expect(await scope.compareAndSwapText('grading.json', stored, corrupted)).toBe(true)

    await expect(repository.listEntries()).rejects.toMatchObject({ code: 'INVALID_STORAGE' })
  })
})

const readingSchema: SchemaDefinition = {
  ...schema,
  schemaId: '10000000-0000-4000-8000-000000000002',
  sourceDraftId: '20000000-0000-4000-8000-000000000002',
  structureHash: `sha256:${'2'.repeat(64)}`,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
    templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
  },
  data: {
    name: '朗读题',
    description: '人工朗读评分',
    maxScore: 5,
    answerDescriptions: { reading: '朗读录音' },
    inputDescriptions: {},
    rubricMarkdown: '按准确度和流利度评分。'
  }
}

function mixedSubmission(): SubmissionPackage {
  const value = submission('A')
  value.schemaUses[0].inputs[0].value = 'Choose one.\n\n![Objective](resource:objective-image)'
  value.answers.audios = [{ resourceKey: 'answer-audio-0', durationMs: 3200 }]
  value.schemaUses.push({
    instanceId: 'schema-use:reading',
    schema: readingSchema,
    inputs: [
      {
        inputId: 'question-description',
        type: 'text',
        value: '请朗读下面的句子。\n\n![Reading](resource:reading-image)'
      }
    ],
    answers: [
      {
        answerId: 'reading',
        type: 'fixed-speech',
        text: 'The weather is beautiful today.',
        audioAnswerIndex: 0
      }
    ]
  })
  value.resources['answer-audio-0'] = {
    filename: 'recording-0.wav',
    packagePath: 'recordings/answer-audio-0/recording-0.wav',
    mediaType: 'audio/wav'
  }
  value.resources['objective-image'] = {
    filename: 'objective.png',
    packagePath: 'resources/objective-image/objective.png',
    mediaType: 'image/png'
  }
  value.resources['reading-image'] = {
    filename: 'reading.png',
    packagePath: 'resources/reading-image/reading.png',
    mediaType: 'image/png'
  }
  value.resources.unused = {
    filename: 'unused.png',
    packagePath: 'resources/unused/unused.png',
    mediaType: 'image/png'
  }
  return value
}

function mixedSubmissionFiles(): Record<string, Uint8Array> {
  return {
    'answer-audio-0': new Uint8Array([82, 73, 70, 70]),
    'objective-image': new Uint8Array([1]),
    'reading-image': new Uint8Array([2]),
    unused: new Uint8Array([3])
  }
}

async function importedSubmissionScope(store: MemoryStore): Promise<SubmissionLibraryStore> {
  const submissions = store.scope('submissions')
  const [key] = await submissions.listScopes()
  if (!key) throw new Error('Expected an imported submission scope')
  return submissions.scope(key)
}

function objectiveInput(answer: string | null, analysis: string): GradingInput {
  return {
    submission: submission().meta,
    instanceId: 'schema-use:objective',
    schema,
    inputs: [
      { inputId: 'question-description', type: 'text', value: 'Choose one.' },
      { inputId: 'analysis', type: 'text', value: analysis }
    ],
    answers: [{ answerId: 'answer', description: 'Student answer', type: 'text', value: answer }],
    resources: {}
  }
}

function readingInput(): GradingInput {
  return {
    submission: submission().meta,
    instanceId: 'schema-use:reading',
    schema: readingSchema,
    inputs: [{ inputId: 'question-description', type: 'text', value: 'Read it.' }],
    answers: [
      {
        answerId: 'reading',
        description: '朗读录音',
        type: 'fixed-speech',
        text: 'Read it.',
        audio: {
          resourceKey: 'audio',
          filename: 'audio.wav',
          mediaType: 'audio/wav',
          kind: 'recording',
          durationMs: 1000,
          data: new Uint8Array([1])
        }
      }
    ],
    resources: {}
  }
}

interface MemoryState {
  texts: Map<string, unknown>
  assets: Map<string, Uint8Array>
  nextAssetWrite?: () => Promise<void>
}

class MemoryStore implements SubmissionLibraryStore {
  private readonly state: MemoryState

  constructor(
    state?: MemoryState,
    private readonly path: string[] = []
  ) {
    this.state = state ?? { texts: new Map(), assets: new Map() }
  }

  scope(name: string): SubmissionLibraryStore {
    return new MemoryStore(this.state, [...this.path, name])
  }

  pauseNextAssetWrite(operation: () => Promise<void>): void {
    this.state.nextAssetWrite = operation
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = this.state.texts.get(this.fileKey(filename))
    return value === undefined ? null : (structuredClone(value) as T)
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.fileKey(filename)
    const current = this.state.texts.get(key)
    if (expected === null ? current !== undefined : !deepEqual(current, expected)) return false
    this.state.texts.set(key, structuredClone(data))
    return true
  }

  async deleteText(filename: string): Promise<void> {
    this.state.texts.delete(this.fileKey(filename))
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = this.state.assets.get(this.fileKey(filename))
    return value ? new Uint8Array(value) : null
  }

  async writeAsset(filename: string, data: Uint8Array): Promise<void> {
    this.state.assets.set(this.fileKey(filename), new Uint8Array(data))
    const operation = this.state.nextAssetWrite
    this.state.nextAssetWrite = undefined
    if (operation) await operation()
  }

  async deleteAsset(filename: string): Promise<void> {
    this.state.assets.delete(this.fileKey(filename))
  }

  async listScopes(): Promise<string[]> {
    const prefix = this.path.length === 0 ? '' : `${this.path.join('/')}/`
    const names = new Set<string>()
    for (const key of [...this.state.texts.keys(), ...this.state.assets.keys()]) {
      if (!key.startsWith(prefix)) continue
      const remainder = key.slice(prefix.length)
      const slash = remainder.indexOf('/')
      if (slash > 0) names.add(remainder.slice(0, slash))
    }
    return [...names].sort()
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of this.state.texts.keys())
      if (key.startsWith(prefix)) this.state.texts.delete(key)
    for (const key of this.state.assets.keys())
      if (key.startsWith(prefix)) this.state.assets.delete(key)
  }

  private fileKey(filename: string): string {
    return [...this.path, filename].join('/')
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
