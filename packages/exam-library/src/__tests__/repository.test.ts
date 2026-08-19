import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import { describe, expect, it } from 'vitest'
import { FileExamLibraryRepository, type ExamLibraryStore } from '../index'

describe('FileExamLibraryRepository', () => {
  it('导入、列出并原样读取试卷包', async () => {
    const repository = new FileExamLibraryRepository(new MemoryStore())
    const bytes = await encodeExamPackage(exam(), {})

    const imported = await repository.importArchive(bytes)

    expect(imported.status).toBe('created')
    expect(imported.record).toMatchObject({
      packageId: 'exam-package-1',
      title: 'Archive exam',
      pageCount: 1,
      timelineStepCount: 1,
      resourceCount: 0
    })
    expect(await repository.listRecords()).toEqual([imported.record])
    expect(await repository.getRecord('exam-package-1')).toEqual(imported.record)
    expect(await repository.exportArchive('exam-package-1')).toEqual(bytes)
  })

  it('相同归档重复导入时保持幂等', async () => {
    const repository = new FileExamLibraryRepository(new MemoryStore())
    const bytes = await encodeExamPackage(exam(), {})
    const first = await repository.importArchive(bytes)
    const second = await repository.importArchive(bytes)

    expect(second).toEqual({ status: 'duplicate', record: first.record })
    expect(await repository.listRecords()).toHaveLength(1)
  })

  it('拒绝相同 packageId 的不同内容', async () => {
    const repository = new FileExamLibraryRepository(new MemoryStore())
    await repository.importArchive(await encodeExamPackage(exam(), {}))
    const changed = exam()
    changed.examData.title = 'Changed exam'
    changed.submissionTemplate.meta.examTitle = 'Changed exam'

    await expect(
      repository.importArchive(await encodeExamPackage(changed, {}))
    ).rejects.toMatchObject({ code: 'EXAM_ID_CONFLICT' })
  })

  it('删除试卷并拒绝读取不存在的记录', async () => {
    const repository = new FileExamLibraryRepository(new MemoryStore())
    await repository.importArchive(await encodeExamPackage(exam(), {}))

    await repository.deleteExam('exam-package-1')

    expect(await repository.listRecords()).toEqual([])
    await expect(repository.exportArchive('exam-package-1')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('拒绝损坏的试卷包且不创建记录', async () => {
    const repository = new FileExamLibraryRepository(new MemoryStore())

    await expect(repository.importArchive(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE'
    })
    expect(await repository.listRecords()).toEqual([])
  })
})

class MemoryStore implements ExamLibraryStore {
  private readonly state: {
    texts: Map<string, unknown>
    assets: Map<string, Uint8Array>
  }

  constructor(
    state?: { texts: Map<string, unknown>; assets: Map<string, Uint8Array> },
    private readonly path: string[] = []
  ) {
    this.state = state ?? { texts: new Map(), assets: new Map() }
  }

  scope(name: string): ExamLibraryStore {
    return new MemoryStore(this.state, [...this.path, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = this.state.texts.get(this.key(filename))
    return value === undefined ? null : (structuredClone(value) as T)
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.state.texts.get(key)
    if (
      expected === null
        ? current !== undefined
        : JSON.stringify(current) !== JSON.stringify(expected)
    ) {
      return false
    }
    this.state.texts.set(key, structuredClone(data))
    return true
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = this.state.assets.get(this.key(filename))
    return value ? new Uint8Array(value) : null
  }

  async writeAsset(filename: string, data: Uint8Array): Promise<void> {
    this.state.assets.set(this.key(filename), new Uint8Array(data))
  }

  async deleteAsset(filename: string): Promise<void> {
    this.state.assets.delete(this.key(filename))
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
    for (const key of this.state.texts.keys()) {
      if (key.startsWith(prefix)) this.state.texts.delete(key)
    }
    for (const key of this.state.assets.keys()) {
      if (key.startsWith(prefix)) this.state.assets.delete(key)
    }
  }

  private key(filename: string): string {
    return [...this.path, filename].join('/')
  }
}

function exam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-package-1',
    examData: {
      title: 'Archive exam',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'title', type: 'text', x: 10, y: 10, text: 'Start' }],
            timeline: [{ type: 'countdown', seconds: 1 }]
          }
        ],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-package-1', examTitle: 'Archive exam' },
      schemaUses: [],
      resources: {}
    }
  }
}
