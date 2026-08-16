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

const TEMPLATE_ID = '0c283c54-683a-498c-bf69-fb1490f99356'
const SECTION_TEMPLATES = [
  {
    templateId: '261d2ad9-225e-41ac-a394-1887b912b917',
    name: '上海高考口语 - 朗读句子',
    functionName: '朗读句子题组'
  },
  {
    templateId: 'c77c98f4-049d-4991-a5dc-3c39b7088100',
    name: '上海高考口语 - 朗读短文',
    functionName: '朗读短文题组'
  },
  {
    templateId: 'bf2dddd5-f85f-4fbe-8e2f-9f2aa86f5e05',
    name: '上海高考口语 - 情景提问',
    functionName: '情景提问题组'
  },
  {
    templateId: 'dccc9ca8-6b17-4b54-8fb8-bc5be6517e88',
    name: '上海高考口语 - 看图说话',
    functionName: '看图说话题组'
  },
  {
    templateId: '490f6873-a39d-409e-954c-c345a90004a3',
    name: '上海高考口语 - 快速应答',
    functionName: '快速应答题组'
  },
  {
    templateId: 'ef1dc645-eba5-4144-a82b-f52e24d5f925',
    name: '上海高考口语 - 听短文回答',
    functionName: '听短文回答题组'
  }
] as const

describe('内置 Template 启动初始化', () => {
  it('幂等安装导出的上海高考口语模板并移除占位模板', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const manifest = JSON.parse(
      await readFile('resources/builtin/template-editor/.text/builtin-templates.json', 'utf8')
    ) as unknown

    await initializeBuiltinTemplates(repository, manifest)
    await initializeBuiltinTemplates(repository, manifest)

    expect(await repository.listBuiltinTemplateIds()).toEqual(
      [TEMPLATE_ID, ...SECTION_TEMPLATES.map(({ templateId }) => templateId)].sort()
    )
    expect(await repository.getActiveBuiltinTemplate(TEMPLATE_ID)).toMatchObject({
      templateId: TEMPLATE_ID,
      version: 2,
      releaseHash: 'sha256:07ba9ec2f59740f555a69e87242d57dec7e95d871246074f5a05433b3b4cc38f',
      document: {
        content: {
          name: '上海高考口语标准题型',
          root: {
            children: expect.arrayContaining([expect.objectContaining({ id: 'function-call' })])
          }
        },
        resources: {
          functions: expect.arrayContaining([
            expect.objectContaining({ id: expect.stringMatching(/^sha256:/) })
          ])
        }
      }
    })
    await expect(
      repository.getActiveBuiltinTemplate('11111111-1111-4111-8111-111111111111')
    ).resolves.toBeNull()

    const standard = await repository.getActiveBuiltinTemplate(TEMPLATE_ID)
    const standardInterface = standard?.document.content.interfaces[0]
    expect(standardInterface).toBeDefined()

    for (const expected of SECTION_TEMPLATES) {
      const section = await repository.getActiveBuiltinTemplate(expected.templateId)
      expect(section).toMatchObject({
        templateId: expected.templateId,
        version: 1,
        document: {
          content: {
            name: expected.name,
            interfaces: [standardInterface],
            root: {
              children: [{ type: 'function', name: expected.functionName }]
            }
          }
        }
      })

      const rootCall = section?.document.content.root.children[0]
      expect(rootCall?.type).toBe('function')
      if (!section || rootCall?.type !== 'function') continue

      const resources = new Map(
        section.document.resources.functions.map((resource) => [resource.id, resource])
      )
      expect(resources.get(rootCall.functionRef)?.name).toBe(expected.functionName)
      expect(resources.size).toBe(3)
    }
  })

  it('将内置模板完整复制为 UUID 和 revision 重置的本地模板', async () => {
    const repository = new FileTemplateRepository(new MemoryStore().scope('template-editor'))
    const source = await release(1, '内置模板')
    await initializeBuiltinTemplates(repository, { templates: [source] })
    const application = createTemplateApplication({
      repository,
      getInterfaceManifest: async () => null,
      getSchema: async () => null,
      locateInterfaceInstance: () => null
    })

    const copy = await application.builtinTemplates.createCopy(TEMPLATE_ID)

    expect(copy.templateId).not.toBe(TEMPLATE_ID)
    expect(copy.templateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(copy.revision).toBe(0)
    expect(copy.content).toEqual(source.document.content)
    expect(copy.resources).toEqual(source.document.resources)
    expect(copy.editorState).toEqual(source.document.editorState)
    expect(copy.content).not.toBe(source.document.content)
    expect(copy.resources).not.toBe(source.document.resources)
    expect(copy.editorState).not.toBe(source.document.editorState)
    await expect(application.templates.get(copy.templateId)).resolves.toEqual(copy)
    copy.content.name = '修改副本'
    await expect(application.builtinTemplates.get(TEMPLATE_ID)).resolves.toEqual(source)
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
