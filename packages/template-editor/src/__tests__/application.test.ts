import type {
  InterfaceInstance,
  InterfaceVarManifest,
  SchemaBlockManifest
} from '@ls101/core-types'
import { describe, expect, it } from 'vitest'
import { createTemplateApplication, TemplateApplicationError } from '../application'
import { createFunctionDocument, createTemplateDocument } from '../id'
import { FileTemplateRepository, TemplateRepositoryError, type TemplateStore } from '../repository'
import type { FunctionContent, FunctionDocument, TemplateContent } from '../types'
import { root } from './fixtures'

const FUNCTION_A = '10000000-0000-4000-8000-000000000001'
const FUNCTION_B = '10000000-0000-4000-8000-000000000002'
const FUNCTION_C = '10000000-0000-4000-8000-000000000003'
const TEMPLATE_ID = '20000000-0000-4000-8000-000000000001'
const INTERFACE_ID = `sha256:${'1'.repeat(64)}`
const SCHEMA_ID = `sha256:${'2'.repeat(64)}`
const INSTANCE_ID = '30000000-0000-4000-8000-000000000001'

function functionDocument(
  functionId: string,
  name: string,
  children: FunctionContent['body']['children'] = []
): FunctionDocument {
  return {
    functionId,
    content: {
      name,
      inputs: [],
      body: root(children),
      outputs: [],
      schemaUses: []
    },
    editorState: {}
  }
}

function functionCall(id: string, functionRef: string) {
  return { id, type: 'function' as const, functionRef, inputs: {}, outputNames: {} }
}

function emptyContent(name = 'Template'): TemplateContent {
  return {
    name,
    description: '',
    interfaces: [],
    root: root(),
    schemaUses: []
  }
}

function setup() {
  const store = new MemoryStore()
  const repository = new FileTemplateRepository(store.scope('template-editor'))
  const interfaceManifest: InterfaceVarManifest = {
    interfaceId: INTERFACE_ID,
    interfaceName: 'Data',
    vars: [
      {
        varName: 'prompt',
        type: 'text',
        description: 'Prompt',
        example: 'Hello',
        path: 'prompt'
      }
    ]
  }
  const schemaManifest: SchemaBlockManifest = {
    schemaId: SCHEMA_ID,
    schemaName: 'Schema',
    blocks: [
      {
        blockId: 'text',
        blockName: 'Text',
        fields: [{ varName: 'prompt', type: 'text' }]
      }
    ]
  }
  const instance: InterfaceInstance = {
    instanceId: INSTANCE_ID,
    name: 'Instance',
    generatedAt: '2026-08-04T00:00:00.000Z',
    values: { prompt: 'Resolved prompt' }
  }
  const application = createTemplateApplication({
    repository,
    getInterfaceManifest: async (id) => (id === INTERFACE_ID ? interfaceManifest : null),
    getSchemaManifest: async (id) => (id === SCHEMA_ID ? schemaManifest : null),
    locateInterfaceInstance: async (id) =>
      id === INSTANCE_ID ? { interfaceId: INTERFACE_ID, instance } : null
  })
  return { store, repository, application }
}

describe('FileTemplateRepository', () => {
  it('保存、读取、列出和删除 Template 与 Function 工作文档', async () => {
    const { repository } = setup()
    const template = { ...createTemplateDocument(emptyContent()), templateId: TEMPLATE_ID }
    const func = functionDocument(FUNCTION_A, 'Function')

    await repository.saveTemplate(template)
    await repository.saveFunction(func)

    expect(await repository.listTemplateIds()).toEqual([TEMPLATE_ID])
    expect(await repository.listFunctionIds()).toEqual([FUNCTION_A])
    expect(await repository.getTemplate(TEMPLATE_ID)).toEqual(template)
    expect(await repository.getFunction(FUNCTION_A)).toEqual(func)

    await repository.deleteTemplate(TEMPLATE_ID)
    await repository.deleteFunction(FUNCTION_A)
    expect(await repository.getTemplate(TEMPLATE_ID)).toBeNull()
    expect(await repository.getFunction(FUNCTION_A)).toBeNull()
  })

  it('拒绝非法 UUID 和被篡改的内嵌函数资源', async () => {
    const { repository } = setup()
    await expect(repository.getTemplate('bad-id')).rejects.toBeInstanceOf(TemplateRepositoryError)

    const resource = await import('../id').then(({ createFunctionResource }) =>
      createFunctionResource(functionDocument(FUNCTION_A, 'Original').content)
    )
    const template = {
      ...createTemplateDocument(emptyContent(), {
        functions: [{ ...resource, name: 'Tampered' }]
      }),
      templateId: TEMPLATE_ID
    }
    await expect(repository.saveTemplate(template)).rejects.toMatchObject({
      code: 'INVALID_DATA'
    })
  })
})

describe('TemplateApplication', () => {
  it('创建并浏览工作文档', async () => {
    const { application } = setup()
    const template = await application.templates.create({ name: 'Exam' })
    const func = await application.functions.create({ name: 'Question' })

    expect(await application.browser.listTemplates()).toEqual([
      { templateId: template.templateId, name: 'Exam', description: '' }
    ])
    expect(await application.browser.listFunctions()).toEqual([
      { functionId: func.functionId, name: 'Question' }
    ])
  })

  it('复制完整函数依赖闭包、改写引用并按内容 ID 去重', async () => {
    const { repository, application } = setup()
    const leaf = functionDocument(FUNCTION_B, 'Leaf')
    const parent = functionDocument(FUNCTION_A, 'Parent', [functionCall('leaf-call', FUNCTION_B)])
    await repository.saveFunction(leaf)
    await repository.saveFunction(parent)
    const template = await application.templates.create({ name: 'Exam' })

    const first = await application.templates.embedFunction(template.templateId, FUNCTION_A)
    expect(first.template.resources.functions).toHaveLength(2)
    const parentResource = first.template.resources.functions.find(
      (resource) => resource.id === first.functionRef
    )
    const nested = parentResource?.body.children[0]
    expect(nested?.type).toBe('function')
    if (nested?.type !== 'function') return
    expect(nested.functionRef).toMatch(/^sha256:/)
    expect(first.template.resources.functions.some((item) => item.id === nested.functionRef)).toBe(
      true
    )

    const second = await application.templates.embedFunction(template.templateId, FUNCTION_A)
    expect(second.functionRef).toBe(first.functionRef)
    expect(second.template.resources.functions).toHaveLength(2)

    await repository.deleteFunction(FUNCTION_A)
    await repository.deleteFunction(FUNCTION_B)
    expect(
      (await application.templates.get(template.templateId))?.resources.functions
    ).toHaveLength(2)
  })

  it('拒绝递归或缺失的函数依赖', async () => {
    const { repository, application } = setup()
    await repository.saveFunction(
      functionDocument(FUNCTION_A, 'A', [functionCall('b', FUNCTION_B)])
    )
    await repository.saveFunction(
      functionDocument(FUNCTION_B, 'B', [functionCall('a', FUNCTION_A)])
    )
    const template = await application.templates.create()

    await expect(
      application.templates.embedFunction(template.templateId, FUNCTION_A)
    ).rejects.toMatchObject({ code: 'RECURSIVE_FUNCTION_DEPENDENCY' })
    await expect(
      application.templates.embedFunction(template.templateId, FUNCTION_C)
    ).rejects.toEqual(
      expect.objectContaining<Partial<TemplateApplicationError>>({ code: 'FUNCTION_NOT_FOUND' })
    )
  })

  it('按根节点和嵌套引用清理不可达函数资源', async () => {
    const { repository, application } = setup()
    await repository.saveFunction(functionDocument(FUNCTION_A, 'A'))
    const template = await application.templates.create()
    const embedded = await application.templates.embedFunction(template.templateId, FUNCTION_A)

    const referenced = {
      ...embedded.template,
      content: {
        ...embedded.template.content,
        root: root([functionCall('call', embedded.functionRef)])
      }
    }
    await application.templates.save(referenced)
    expect(await application.templates.pruneFunctionResources(template.templateId)).toEqual(
      referenced
    )

    await application.templates.save({
      ...referenced,
      content: { ...referenced.content, root: root() }
    })
    const pruned = await application.templates.pruneFunctionResources(template.templateId)
    expect(pruned.resources.functions).toEqual([])
  })

  it('加载 Interface 与 Schema 依赖并编译所选实例', async () => {
    const { application } = setup()
    const template = await application.templates.create({
      name: 'Compiled exam',
      interfaces: [{ alias: 'data', interfaceId: INTERFACE_ID, acceptedVars: ['prompt'] }],
      schemaUses: [
        {
          useId: 'text',
          schemaId: SCHEMA_ID,
          blockId: 'text',
          bindings: {
            prompt: { type: 'variable', scope: 'interface', alias: 'data', varName: 'prompt' }
          }
        }
      ]
    })

    await expect(application.templates.validate(template.templateId)).resolves.toEqual({
      valid: true,
      errors: []
    })
    const result = await application.templates.compile(template.templateId, [
      { alias: 'data', interfaceId: INTERFACE_ID, instanceId: INSTANCE_ID }
    ])
    expect(result).toMatchObject({
      success: true,
      examPackage: {
        title: 'Compiled exam',
        schema: {
          usages: [
            {
              fields: [{ varName: 'prompt', type: 'text', value: 'Resolved prompt' }]
            }
          ]
        }
      }
    })
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
    return [...this.path, filename].join('/')
  }
}
