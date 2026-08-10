import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { describe, expect, it } from 'vitest'
import {
  createHumanGradingEngine,
  FileSubmissionLibraryRepository,
  objectiveGradingEngine,
  type GradingInput,
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

  it('自动批改客观题、锁定已提交结果并完成后生成报告且禁止删除', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    const source = mixedSubmission()
    const bytes = await encodeSubmissionPackage(source, {
      'answer-audio-0': new Uint8Array([82, 73, 70, 70])
    })
    await repository.importArchive(bytes)

    const started = await repository.startGrading(source.meta.submissionId)
    expect(started.grading).toMatchObject({
      status: 'grading',
      totalScore: 2,
      maxScore: 7,
      items: [{ instanceId: 'schema-use:objective', engine: 'objective' }]
    })

    const completed = await repository.submitGradingResult(
      source.meta.submissionId,
      'schema-use:reading',
      'human',
      { score: 4.25, comment: '' }
    )
    expect(completed.grading).toMatchObject({
      status: 'completed',
      totalScore: 6.25,
      maxScore: 7
    })

    await expect(
      repository.submitGradingResult(source.meta.submissionId, 'schema-use:reading', 'human', {
        score: 4,
        comment: '再次提交'
      })
    ).rejects.toMatchObject({ code: 'GRADING_COMPLETED' })
    await expect(repository.deleteSubmission(source.meta.submissionId)).rejects.toMatchObject({
      code: 'GRADING_COMPLETED'
    })

    const report = await repository.getReport(source.meta.submissionId)
    expect(report.markdown).toContain('# Student - Archive exam')
    expect(report.markdown).toContain('| 6.25/7 |')
    expect(report.markdown).toContain('- 正确答案：A')
    expect(report.markdown).toContain('- 学生答案：A')
    expect(report.markdown).toContain('**分数：4.25/5**')
    expect(report.markdown).toContain('**评语：无**')
    expect(report.resources['answer-audio-0'].data).toEqual(new Uint8Array([82, 73, 70, 70]))

    const [entry] = await repository.listEntries()
    expect(entry.grading).toMatchObject({
      status: 'completed',
      gradedCount: 2,
      totalCount: 2,
      totalScore: 6.25,
      maxScore: 7
    })
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
  value.answers.audios = [{ resourceKey: 'answer-audio-0', durationMs: 3200 }]
  value.schemaUses.push({
    instanceId: 'schema-use:reading',
    schema: readingSchema,
    inputs: [{ inputId: 'question-description', type: 'text', value: '请朗读下面的句子。' }],
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
  return value
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
