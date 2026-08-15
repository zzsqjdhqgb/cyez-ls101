import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BuiltinTemplateInitializationError,
  initializeBuiltinTemplates
} from '../builtin-initializer'
import { createTemplateApplication } from '../application'
import { createBuiltinTemplateRelease } from '../id'
import { FileTemplateRepository, type TemplateStore } from '../repository'
import type { BuiltinTemplateRelease } from '../types'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'

describe('内置 Template 启动初始化', () => {
  it('幂等安装 bundled release 并可直接编译生成试卷', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const manifest = JSON.parse(
      await readFile('resources/builtin/template-editor/.text/builtin-templates.json', 'utf8')
    ) as unknown

    await initializeBuiltinTemplates(repository, manifest)
    await initializeBuiltinTemplates(repository, manifest)

    expect(await repository.listBuiltinTemplateIds()).toEqual([TEMPLATE_ID])
    expect(await repository.getActiveBuiltinTemplate(TEMPLATE_ID)).toMatchObject({
      templateId: TEMPLATE_ID,
      version: 1,
      releaseHash: 'sha256:371a3aee9c3e86d7678cd5e631c6d044b6ae5e0f2f6c04567d32f4e73a28a170',
      document: { content: { name: '基础试卷' } }
    })

    const application = createTemplateApplication({
      repository,
      getInterfaceManifest: async () => null,
      getSchema: async () => null,
      locateInterfaceInstance: () => null
    })
    await expect(application.builtinTemplates.compile(TEMPLATE_ID, [])).resolves.toMatchObject({
      success: true,
      examPackage: { examData: { title: '基础试卷' } }
    })
  })

  it('升级 active 版本并停用已移除模板，同时保留历史 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const first = await release(1, '第一版')
    const second = await release(2, '第二版')
    const removed = await createBuiltinTemplateRelease(
      '22222222-2222-4222-8222-222222222222',
      1,
      snapshot('已移除模板')
    )

    await initializeBuiltinTemplates(repository, { templates: [first, removed] })
    await initializeBuiltinTemplates(repository, { templates: [second] })

    expect(await repository.listBuiltinTemplateIds()).toEqual([TEMPLATE_ID])
    expect(await repository.getActiveBuiltinTemplate(TEMPLATE_ID)).toEqual(second)
    expect(await repository.getBuiltinTemplate(TEMPLATE_ID, 1)).toEqual(first)
    expect(await repository.getActiveBuiltinTemplate(removed.templateId)).toBeNull()
    expect(await repository.getBuiltinTemplate(removed.templateId, 1)).toEqual(removed)
  })

  it('拒绝相同 templateId/version 的不同 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const first = await release(1, '第一份内容')
    const conflict = await release(1, '冲突内容')

    await initializeBuiltinTemplates(repository, { templates: [first] })
    await expect(
      initializeBuiltinTemplates(repository, { templates: [conflict] })
    ).rejects.toMatchObject({ code: 'RELEASE_CONFLICT' })
    expect(await repository.getActiveBuiltinTemplate(TEMPLATE_ID)).toEqual(first)
  })

  it('清单预校验失败时不写入任何 release', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const valid = await release(1, '有效模板')

    await expect(
      initializeBuiltinTemplates(repository, {
        templates: [valid, { ...valid, templateId: 'invalid-template-id' }]
      })
    ).rejects.toBeInstanceOf(BuiltinTemplateInitializationError)
    expect(await repository.listBuiltinTemplateIds()).toEqual([])
    expect(await repository.getBuiltinTemplate(TEMPLATE_ID, 1)).toBeNull()
  })

  it('缺少 Interface 依赖时启动成功，但在浏览摘要中标记为不可用', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const dependent = await createBuiltinTemplateRelease(TEMPLATE_ID, 1, {
      ...snapshot('依赖题型的模板'),
      content: {
        ...snapshot('依赖题型的模板').content,
        interfaces: [
          {
            alias: 'questions',
            interfaceId: `sha256:${'a'.repeat(64)}`,
            acceptedVars: ['prompt']
          }
        ]
      }
    })
    const application = createTemplateApplication({
      repository,
      getBuiltinTemplateManifest: async () => ({ templates: [dependent] }),
      getInterfaceManifest: async () => null,
      getSchema: async () => null,
      locateInterfaceInstance: () => null
    })

    await expect(application.initialize()).resolves.toBeUndefined()
    await expect(application.browser.listBuiltinTemplates()).resolves.toEqual([
      expect.objectContaining({
        templateId: TEMPLATE_ID,
        available: false,
        errors: [expect.objectContaining({ code: 'UNKNOWN_INTERFACE' })]
      })
    ])
  })
})

async function release(version: number, name: string): Promise<BuiltinTemplateRelease> {
  return createBuiltinTemplateRelease(TEMPLATE_ID, version, snapshot(name))
}

function snapshot(name: string): BuiltinTemplateRelease['document'] {
  return {
    content: {
      name,
      description: '',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'page',
            type: 'page',
            content: { blocks: [] },
            timeline: [
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 1 }
              }
            ]
          }
        ]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

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
    for (const key of this.state.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) scopes.add(rest.split('/')[0])
    }
    return [...scopes]
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of this.state.keys()) if (key.startsWith(prefix)) this.state.delete(key)
  }

  private key(filename: string): string {
    return [...this.path, filename].join('/')
  }
}
