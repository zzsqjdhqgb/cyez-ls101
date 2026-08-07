import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BuiltinFunctionLibraryInitializationError,
  initializeBuiltinFunctionLibraries
} from '../builtin-initializer'
import { createFunctionLibraryRelease } from '../id'
import { FileTemplateRepository, type TemplateStore } from '../repository'

describe('内置函数库启动初始化', () => {
  it('预校验安装清单后幂等登记 release 并更新 active 版本', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const manifest = JSON.parse(
      await readFile(
        'resources/builtin/template-editor/.text/builtin-function-libraries.json',
        'utf8'
      )
    ) as unknown

    await initializeBuiltinFunctionLibraries(repository, manifest)
    await initializeBuiltinFunctionLibraries(repository, manifest)

    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([
      'builtin:basic',
      'builtin:examples'
    ])
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toMatchObject({
      libraryId: 'builtin:basic',
      version: 2,
      content: {
        name: '基础组件库',
        functions: [
          { functionId: 'builtin:frame', content: { name: '框架' } },
          { functionId: 'builtin:page', content: { name: '页面' } },
          { functionId: 'builtin:choice-question', content: { name: '选择题' } }
        ]
      }
    })
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:examples')).toMatchObject({
      libraryId: 'builtin:examples',
      version: 2,
      content: {
        name: '示例组件库',
        functions: [
          {
            functionId: 'builtin:example-title-page',
            content: {
              name: '标题页组合',
              body: { children: [{ type: 'frame', children: [{ type: 'page' }] }] }
            }
          },
          {
            functionId: 'builtin:example-choice-section',
            content: {
              name: '选择题组合',
              body: {
                children: [
                  {
                    type: 'frame',
                    children: [{ type: 'page' }, { type: 'choice-question' }]
                  }
                ]
              }
            }
          }
        ]
      }
    })
  })

  it('清单中任一 release 无效时不写入前面的有效 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const valid = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Basic',
      functions: []
    })

    await expect(
      initializeBuiltinFunctionLibraries(repository, {
        libraries: [valid, { ...valid, libraryId: 'invalid' }]
      })
    ).rejects.toBeInstanceOf(BuiltinFunctionLibraryInitializationError)
    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([])
  })

  it('拒绝以相同 libraryId 和版本登记不同内容', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const first = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'First',
      functions: []
    })
    const conflicting = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Conflicting',
      functions: []
    })

    await initializeBuiltinFunctionLibraries(repository, { libraries: [first] })
    await expect(
      initializeBuiltinFunctionLibraries(repository, { libraries: [conflicting] })
    ).rejects.toMatchObject({ code: 'RELEASE_CONFLICT' })
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toEqual(first)
  })

  it('升级时停用已从清单移除的内置库并保留历史 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const basic = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: 'Basic',
      functions: []
    })
    const legacy = await createFunctionLibraryRelease('builtin:legacy', 1, {
      name: 'Legacy',
      functions: []
    })

    await initializeBuiltinFunctionLibraries(repository, { libraries: [basic, legacy] })
    await initializeBuiltinFunctionLibraries(repository, { libraries: [basic] })

    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual(['builtin:basic'])
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:legacy')).toBeNull()
    expect(await repository.getBuiltinFunctionLibrary('builtin:legacy', 1)).toEqual(legacy)
  })

  it('内容变化时使用新版本激活并保留旧版本', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const previous = await createFunctionLibraryRelease('builtin:examples', 1, {
      name: '旧示例组件库',
      functions: []
    })
    const manifest = JSON.parse(
      await readFile(
        'resources/builtin/template-editor/.text/builtin-function-libraries.json',
        'utf8'
      )
    ) as { libraries: { libraryId: string; version: number }[] }

    await initializeBuiltinFunctionLibraries(repository, { libraries: [previous] })
    await initializeBuiltinFunctionLibraries(repository, manifest)

    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:examples')).toMatchObject({
      libraryId: 'builtin:examples',
      version: 2,
      content: { name: '示例组件库' }
    })
    expect(await repository.getBuiltinFunctionLibrary('builtin:examples', 1)).toEqual(previous)
  })

  it('在启动期拒绝缺失、非法和递归的内置函数依赖', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const entry = (functionId: string, functionRef?: string) => ({
      functionId,
      content: {
        name: functionId,
        inputs: [],
        body: {
          id: 'root',
          type: 'frame' as const,
          children: functionRef
            ? [{ id: 'call', type: 'function' as const, functionRef, inputs: {}, outputNames: {} }]
            : []
        },
        outputs: [],
        schemaUses: []
      }
    })
    const invalidContents = [
      [entry('builtin:root', 'builtin:missing')],
      [entry('builtin:root', 'not-builtin')],
      [entry('builtin:root', 'builtin:child'), entry('builtin:child', 'builtin:root')]
    ]

    for (const functions of invalidContents) {
      const release = await createFunctionLibraryRelease('builtin:broken', 1, {
        name: 'Broken',
        functions
      })
      await expect(
        initializeBuiltinFunctionLibraries(repository, { libraries: [release] })
      ).rejects.toBeInstanceOf(BuiltinFunctionLibraryInitializationError)
    }
    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual([])
  })
})

class MemoryStore implements TemplateStore {
  constructor(
    private readonly state = new Map<string, unknown>(),
    private readonly path: string[] = []
  ) {}

  scope(name: string): TemplateStore {
    return new MemoryStore(this.state, [...this.path, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (this.state.get(this.key(filename)) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.state.set(this.key(filename), structuredClone(data))
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.state.has(key) ? this.state.get(key) : null
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false
    this.state.set(key, structuredClone(data))
    return true
  }

  async listScopes(): Promise<string[]> {
    const prefix = `${this.path.join('/')}/`
    const scopes = new Set<string>()
    this.state.forEach((_value, key) => {
      if (!key.startsWith(prefix)) return
      const remainder = key.slice(prefix.length)
      const segment = remainder.split('/')[0]
      if (segment && remainder.includes('/')) scopes.add(segment)
    })
    return [...scopes].sort()
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) this.state.delete(key)
    }
  }

  private key(filename: string): string {
    return `${this.path.join('/')}/${filename}`
  }
}
