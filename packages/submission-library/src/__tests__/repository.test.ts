import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { describe, expect, it } from 'vitest'
import { FileSubmissionLibraryRepository, type SubmissionLibraryStore } from '../index'

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

  it('拒绝损坏的作答包', async () => {
    const repository = new FileSubmissionLibraryRepository(new MemoryStore())
    await expect(repository.importArchive(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE'
    })
  })
})

interface MemoryState {
  texts: Map<string, unknown>
  assets: Map<string, Uint8Array>
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
