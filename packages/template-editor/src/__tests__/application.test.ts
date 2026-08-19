import type { InterfaceInstance, InterfaceVarManifest } from '@ls101/core-types'
import { describe, expect, it, vi } from 'vitest'
import { createTemplateApplication, TemplateApplicationError } from '../application'
import {
  createFunctionDocument,
  createFunctionLibraryRelease,
  createFunctionResource,
  createTemplateDocument
} from '../id'
import {
  FileTemplateRepository,
  TemplateRepositoryError,
  type TemplateRepository,
  type TemplateStore
} from '../repository'
import type {
  FunctionContent,
  FunctionDocument,
  FunctionLocator,
  LocalFunctionLibraryDocument,
  TemplateContent,
  TemplateDocument,
  TemplateNode
} from '../types'
import { root, schemaDefinition, schemaText } from './fixtures'

const FUNCTION_A = '10000000-0000-4000-8000-000000000001'
const FUNCTION_B = '10000000-0000-4000-8000-000000000002'
const FUNCTION_C = '10000000-0000-4000-8000-000000000003'
const LIBRARY_ID = '40000000-0000-4000-8000-000000000001'
const IMPORTED_LIBRARY_ID = '40000000-0000-4000-8000-000000000002'
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

function localLibrary(
  functions: readonly FunctionDocument[] = [],
  revision = 0
): LocalFunctionLibraryDocument {
  return {
    libraryId: LIBRARY_ID,
    revision,
    storageRevision: revision,
    content: {
      name: 'Local library',
      functions: functions.map(({ functionId, content }) => ({ functionId, content }))
    },
    editorState: {
      library: {},
      functions: Object.fromEntries(
        functions.map(({ functionId, editorState }) => [functionId, editorState])
      )
    }
  }
}

function functionLocator(functionId: string): FunctionLocator {
  return { library: { source: 'local', libraryId: LIBRARY_ID }, functionId }
}

async function saveFunctions(
  repository: TemplateRepository,
  ...functions: FunctionDocument[]
): Promise<LocalFunctionLibraryDocument> {
  const current = await repository.getLocalFunctionLibrary(LIBRARY_ID)
  const byId = new Map(current?.content.functions.map((entry) => [entry.functionId, entry]) ?? [])
  const editorStates = { ...(current?.editorState.functions ?? {}) }
  functions.forEach((document) => {
    byId.set(document.functionId, {
      functionId: document.functionId,
      content: structuredClone(document.content)
    })
    editorStates[document.functionId] = structuredClone(document.editorState)
  })
  return repository.saveLocalFunctionLibrary({
    ...(current ?? localLibrary()),
    content: { name: current?.content.name ?? 'Local library', functions: [...byId.values()] },
    editorState: { library: current?.editorState.library ?? {}, functions: editorStates }
  })
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
  const schemaManifest = schemaDefinition(SCHEMA_ID, {
    questionType: 'freetalk',
    answerFormat: [],
    templateInputs: [{ inputId: 'prompt', type: 'text', required: true }]
  })
  const instance: InterfaceInstance = {
    instanceId: INSTANCE_ID,
    name: 'Instance',
    generatedAt: '2026-08-04T00:00:00.000Z',
    values: { prompt: 'Resolved prompt' }
  }
  const requestedSchemas: string[] = []
  const externalDependencies = {
    getInterfaceManifest: async (id: string) => (id === INTERFACE_ID ? interfaceManifest : null),
    getSchema: async (id: string) => {
      requestedSchemas.push(id)
      return id === SCHEMA_ID ? schemaManifest : null
    },
    locateInterfaceInstance: async (id: string) =>
      id === INSTANCE_ID ? { interfaceId: INTERFACE_ID, instance, assetUrls: {} } : null
  }
  const application = createTemplateApplication({ repository, ...externalDependencies })
  return { store, repository, application, externalDependencies, requestedSchemas }
}

describe('FileTemplateRepository', () => {
  it('保存、读取、列出和删除 Template 与本地函数库工作文档', async () => {
    const { repository } = setup()
    const template = { ...createTemplateDocument(emptyContent()), templateId: TEMPLATE_ID }
    const library = localLibrary([functionDocument(FUNCTION_A, 'Function')])

    await repository.saveTemplate(template)
    await repository.saveLocalFunctionLibrary(library)

    expect(await repository.listTemplateIds()).toEqual([TEMPLATE_ID])
    expect(await repository.listLocalFunctionLibraryIds()).toEqual([LIBRARY_ID])
    expect(await repository.getTemplate(TEMPLATE_ID)).toEqual(template)
    expect(await repository.getLocalFunctionLibrary(LIBRARY_ID)).toEqual(library)

    await repository.deleteTemplate(TEMPLATE_ID)
    await repository.deleteLocalFunctionLibrary(LIBRARY_ID)
    expect(await repository.getTemplate(TEMPLATE_ID)).toBeNull()
    expect(await repository.getLocalFunctionLibrary(LIBRARY_ID)).toBeNull()
  })

  it('登记和删除不可变的导入 release，并单独维护内置 active 版本', async () => {
    const { repository } = setup()
    const imported = await createFunctionLibraryRelease(LIBRARY_ID, 2, {
      name: 'Imported',
      functions: [
        {
          functionId: FUNCTION_A,
          content: functionDocument(FUNCTION_A, 'Imported function').content
        }
      ]
    })
    const builtin = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: '基础组件库',
      functions: [
        {
          functionId: 'builtin:page',
          content: functionDocument(FUNCTION_A, 'Page').content
        }
      ]
    })

    await repository.registerImportedFunctionLibrary(imported)
    await repository.registerBuiltinFunctionLibrary(builtin)
    await repository.setActiveBuiltinFunctionLibraryVersion('builtin:basic', 1)

    expect(await repository.listImportedFunctionLibraryIds()).toEqual([LIBRARY_ID])
    expect(await repository.listImportedFunctionLibraryVersions(LIBRARY_ID)).toEqual([2])
    expect(await repository.getImportedFunctionLibrary(LIBRARY_ID, 2)).toEqual(imported)
    expect(await repository.listBuiltinFunctionLibraryIds()).toEqual(['builtin:basic'])
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toEqual(builtin)

    await repository.deleteImportedFunctionLibrary(LIBRARY_ID, 2)
    expect(await repository.getImportedFunctionLibrary(LIBRARY_ID, 2)).toBeNull()
    expect(await repository.listImportedFunctionLibraryVersions(LIBRARY_ID)).toEqual([])
    expect(await repository.listImportedFunctionLibraryIds()).toEqual([])

    await expect(
      repository.registerBuiltinFunctionLibrary({
        ...builtin,
        contentHash: `sha256:${'0'.repeat(64)}`
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('拒绝非法 UUID、重复函数 ID 和被篡改的 Template 函数资源', async () => {
    const { repository } = setup()
    await expect(repository.getTemplate('bad-id')).rejects.toBeInstanceOf(TemplateRepositoryError)
    await expect(
      repository.saveLocalFunctionLibrary({
        ...localLibrary([
          functionDocument(FUNCTION_A, 'First'),
          functionDocument(FUNCTION_A, 'Duplicate')
        ])
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    await expect(
      repository.saveLocalFunctionLibrary({
        ...localLibrary([
          functionDocument(FUNCTION_A, 'Recursive', [functionCall('call-self', FUNCTION_A)])
        ])
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    await expect(
      repository.saveLocalFunctionLibrary({
        ...localLibrary([
          functionDocument(FUNCTION_A, 'Missing dependency', [
            functionCall('call-missing', FUNCTION_B)
          ])
        ])
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })

    const resource = await createFunctionResource(functionDocument(FUNCTION_A, 'Original').content)
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

  it('读取损坏的 Template 和本地函数库文件时返回 INVALID_DATA', async () => {
    const { store, repository } = setup()
    const template = { ...createTemplateDocument(emptyContent()), templateId: TEMPLATE_ID }
    const templateScope = store.scope('template-editor').scope('templates').scope(TEMPLATE_ID)
    const libraryScope = store
      .scope('template-editor')
      .scope('function-libraries')
      .scope('local')
      .scope(LIBRARY_ID)

    for (const corrupt of [
      { ...template, content: { ...template.content, root: {} } },
      { ...template, content: { ...template.content, interfaces: [null] } },
      { ...template, content: { ...template.content, schemaUses: [{}] } }
    ]) {
      await templateScope.writeText('template.json', corrupt)
      await expect(repository.getTemplate(TEMPLATE_ID)).rejects.toMatchObject({
        code: 'INVALID_DATA'
      })
    }

    const library = localLibrary([functionDocument(FUNCTION_A, 'Broken')])
    await libraryScope.writeText('library.json', {
      ...library,
      content: { ...library.content, functions: [{ functionId: FUNCTION_A, content: {} }] }
    })
    await expect(repository.getLocalFunctionLibrary(LIBRARY_ID)).rejects.toMatchObject({
      code: 'INVALID_DATA',
      params: { libraryId: LIBRARY_ID }
    })
  })

  it('无损升级 storageRevision 拆分前的本地函数库', async () => {
    const { store, repository } = setup()
    const libraryScope = store
      .scope('template-editor')
      .scope('function-libraries')
      .scope('local')
      .scope(LIBRARY_ID)
    const current = localLibrary([functionDocument(FUNCTION_A, 'Legacy function')], 7)
    const { storageRevision: _storageRevision, ...legacy } = current
    await libraryScope.writeText('library.json', {
      ...legacy,
      exportState: { version: 3, contentHash: `sha256:${'a'.repeat(64)}` }
    })

    await expect(repository.getLocalFunctionLibrary(LIBRARY_ID)).resolves.toMatchObject({
      revision: 3,
      storageRevision: 7,
      content: { functions: [{ content: { name: 'Legacy function' } }] },
      exportState: { contentHash: `sha256:${'a'.repeat(64)}` }
    })
    await expect(libraryScope.readText('library.json')).resolves.toMatchObject({
      revision: 3,
      storageRevision: 7,
      exportState: { contentHash: `sha256:${'a'.repeat(64)}` }
    })
  })

  it('使用 revision/CAS 拒绝过期 Template 和本地函数库保存', async () => {
    const { repository } = setup()
    const template = await repository.saveTemplate({
      ...createTemplateDocument(emptyContent()),
      templateId: TEMPLATE_ID
    })
    const library = await repository.saveLocalFunctionLibrary(
      localLibrary([functionDocument(FUNCTION_A, 'Function')])
    )

    const updatedTemplate = await repository.saveTemplate({
      ...template,
      content: { ...template.content, name: 'Updated' }
    })
    const updatedLibrary = await repository.saveLocalFunctionLibrary({
      ...library,
      content: { ...library.content, name: 'Updated' }
    })
    expect(updatedTemplate.revision).toBe(1)
    expect(updatedLibrary.revision).toBe(0)
    expect(updatedLibrary.storageRevision).toBe(1)

    await expect(repository.saveTemplate(template)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      params: { currentRevision: 1, providedRevision: 0 }
    })
    await expect(repository.saveLocalFunctionLibrary(library)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT'
    })
  })

  it('跨仓储实例原子拒绝并发 Template 和本地函数库保存', async () => {
    const store = new MemoryStore()
    const rootStore = store.scope('template-editor')
    const firstRepository = new FileTemplateRepository(rootStore)
    const secondRepository = new FileTemplateRepository(rootStore)
    const template = await firstRepository.saveTemplate({
      ...createTemplateDocument(emptyContent()),
      templateId: TEMPLATE_ID
    })
    const library = await firstRepository.saveLocalFunctionLibrary(
      localLibrary([functionDocument(FUNCTION_A, 'Original')])
    )

    const templateResults = await Promise.allSettled([
      firstRepository.saveTemplate({
        ...template,
        content: { ...template.content, name: 'First edit' }
      }),
      secondRepository.saveTemplate({
        ...template,
        content: { ...template.content, name: 'Second edit' }
      })
    ])
    const libraryResults = await Promise.allSettled([
      firstRepository.saveLocalFunctionLibrary({
        ...library,
        content: { ...library.content, name: 'First edit' }
      }),
      secondRepository.saveLocalFunctionLibrary({
        ...library,
        content: { ...library.content, name: 'Second edit' }
      })
    ])

    for (const results of [templateResults, libraryResults]) {
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'REVISION_CONFLICT' }
      })
    }
    const savedTemplate = templateResults.find((result) => result.status === 'fulfilled')
    const savedLibrary = libraryResults.find((result) => result.status === 'fulfilled')
    expect((await firstRepository.getTemplate(TEMPLATE_ID))?.content.name).toBe(
      savedTemplate?.value.content.name
    )
    expect((await firstRepository.getLocalFunctionLibrary(LIBRARY_ID))?.content.name).toBe(
      savedLibrary?.value.content.name
    )
  })

  it('将底层 JSON 语法错误转换为 INVALID_DATA', async () => {
    const repository = new FileTemplateRepository(new SyntaxErrorStore())

    await expect(repository.getTemplate(TEMPLATE_ID)).rejects.toMatchObject({
      code: 'INVALID_DATA'
    })
    await expect(repository.getLocalFunctionLibrary(LIBRARY_ID)).rejects.toMatchObject({
      code: 'INVALID_DATA'
    })
  })

  it('保存时拒绝非普通对象和循环 JSON 状态', async () => {
    const { repository } = setup()
    const base = { ...createTemplateDocument(emptyContent()), templateId: TEMPLATE_ID }
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    for (const editorState of [new Date(), new Map([['zoom', 1]]), cyclic]) {
      await expect(
        repository.saveTemplate({ ...base, editorState } as unknown as TemplateDocument)
      ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    }
  })
})

describe('TemplateApplication', () => {
  it('由 Template 应用读取并幂等登记 builtin manifest', async () => {
    const { repository, externalDependencies } = setup()
    const release = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: '基础组件库',
      functions: []
    })
    const getBuiltinFunctionLibraryManifest = vi.fn().mockResolvedValue({ libraries: [release] })
    const application = createTemplateApplication({
      repository,
      ...externalDependencies,
      getBuiltinFunctionLibraryManifest
    })

    await application.initialize()
    await application.initialize()

    expect(getBuiltinFunctionLibraryManifest).toHaveBeenCalledTimes(1)
    expect(await repository.getActiveBuiltinFunctionLibrary('builtin:basic')).toEqual(release)
  })

  it('创建并浏览工作文档', async () => {
    const { application } = setup()
    const template = await application.templates.create({ name: 'Exam' })
    const library = await application.functionLibraries.local.create('Question library')
    const created = await application.functionLibraries.local.createFunction(library.libraryId, {
      name: 'Question'
    })

    expect(await application.browser.listTemplates()).toEqual([
      { templateId: template.templateId, name: 'Exam', description: '' }
    ])
    expect(await application.browser.listFunctionLibraries()).toEqual([
      {
        source: 'local',
        exportStatus: 'never',
        libraryId: library.libraryId,
        name: 'Question library',
        functions: [{ functionId: created.function.functionId, name: 'Question' }]
      }
    ])
  })

  it('按源 ID、内容冲突和本地 revision 执行 Template 混合导入', async () => {
    const { application } = setup()
    const source: TemplateDocument = {
      ...createTemplateDocument(emptyContent(), { functions: [] }, { selected: 'root' }),
      templateId: TEMPLATE_ID,
      revision: 7,
      content: { ...emptyContent(), name: 'Imported template' }
    }

    await expect(application.templates.inspectImport(source)).resolves.toEqual({
      status: 'new',
      existing: null
    })
    const preserved = await application.templates.importDocument(source, 'preserve-id')
    expect(preserved).toEqual({ ...source, revision: 0 })

    await expect(
      application.templates.inspectImport({
        ...source,
        editorState: { selected: 'another-node' }
      })
    ).resolves.toMatchObject({
      status: 'identical',
      existing: { templateId: TEMPLATE_ID, revision: 0 }
    })
    await expect(application.templates.importDocument(source, 'preserve-id')).rejects.toMatchObject(
      { code: 'REVISION_CONFLICT' }
    )

    const conflicting = {
      ...source,
      revision: 2,
      content: { ...source.content, name: 'Changed import' }
    }
    await expect(application.templates.inspectImport(conflicting)).resolves.toMatchObject({
      status: 'conflict',
      existing: { templateId: TEMPLATE_ID, revision: 0 }
    })

    const overwritten = await application.templates.importDocument(conflicting, 'overwrite', 0)
    expect(overwritten).toMatchObject({
      templateId: TEMPLATE_ID,
      revision: 1,
      content: { name: 'Changed import' }
    })
    await expect(
      application.templates.importDocument(
        { ...conflicting, content: { ...conflicting.content, name: 'Stale overwrite' } },
        'overwrite',
        0
      )
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    const copy = await application.templates.importDocument(conflicting, 'copy')
    expect(copy).toMatchObject({ revision: 0, content: { name: 'Changed import' } })
    expect(copy.templateId).not.toBe(TEMPLATE_ID)
    expect(copy.templateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  it('浏览函数库时隔离损坏的本地库，不阻塞其他库', async () => {
    const { store, application } = setup()
    const validId = '40000000-0000-4000-8000-000000000010'
    const invalidId = '40000000-0000-4000-8000-000000000011'
    await store
      .scope('template-editor')
      .scope('function-libraries')
      .scope('local')
      .scope(validId)
      .writeText('library.json', { ...localLibrary([], 0), libraryId: validId })
    await store
      .scope('template-editor')
      .scope('function-libraries')
      .scope('local')
      .scope(invalidId)
      .writeText('library.json', { libraryId: invalidId, revision: 0, content: null })

    await expect(application.browser.listFunctionLibraries()).resolves.toEqual([
      expect.objectContaining({ source: 'local', libraryId: validId, name: 'Local library' }),
      expect.objectContaining({
        source: 'local',
        libraryId: invalidId,
        name: '损坏的本地函数库',
        error: expect.stringContaining(invalidId)
      })
    ])
  })

  it('把基础组件库的单节点函数体作为可直接插入的节点预设返回', async () => {
    const { repository, application } = setup()
    const page = { id: 'page', type: 'page' as const, content: { blocks: [] }, timeline: [] }
    const release = await createFunctionLibraryRelease('builtin:basic', 2, {
      name: '基础组件库',
      functions: [
        {
          functionId: 'builtin:page',
          content: functionDocument(FUNCTION_A, '页面', [page]).content
        }
      ]
    })
    await repository.registerBuiltinFunctionLibrary(release)
    await repository.setActiveBuiltinFunctionLibraryVersion(release.libraryId, release.version)

    expect(await application.browser.listFunctionLibraries()).toEqual([
      {
        source: 'builtin',
        libraryId: 'builtin:basic',
        version: 2,
        name: '基础组件库',
        functions: [
          {
            functionId: 'builtin:page',
            name: '页面',
            component: { ...page, name: '页面' }
          }
        ]
      }
    ])
  })

  it('按函数库来源定位本地、导入和当前内置 release 中的函数', async () => {
    const { repository, application } = setup()
    await saveFunctions(repository, functionDocument(FUNCTION_A, 'Local function'))
    const imported = await createFunctionLibraryRelease(LIBRARY_ID, 3, {
      name: 'Imported library',
      functions: [
        {
          functionId: FUNCTION_B,
          content: functionDocument(FUNCTION_B, 'Imported function').content
        }
      ]
    })
    const builtin = await createFunctionLibraryRelease('builtin:basic', 1, {
      name: '基础组件库',
      functions: [
        {
          functionId: 'builtin:page',
          content: functionDocument(FUNCTION_C, 'Builtin function').content
        }
      ]
    })
    await repository.registerImportedFunctionLibrary(imported)
    await repository.registerBuiltinFunctionLibrary(builtin)
    await repository.setActiveBuiltinFunctionLibraryVersion('builtin:basic', 1)
    const template = await application.templates.create()

    await application.templates.embedFunction(template.templateId, functionLocator(FUNCTION_A))
    await application.templates.embedFunction(template.templateId, {
      library: { source: 'imported', libraryId: LIBRARY_ID, version: 3 },
      functionId: FUNCTION_B
    })
    const result = await application.templates.embedFunction(template.templateId, {
      library: { source: 'builtin', libraryId: 'builtin:basic' },
      functionId: 'builtin:page'
    })

    expect(result.template.resources.functions.map((item) => item.name).sort()).toEqual([
      'Builtin function',
      'Imported function',
      'Local function'
    ])
  })

  it('复制完整函数依赖闭包、改写引用并按内容 ID 去重', async () => {
    const { repository, application } = setup()
    const leaf = functionDocument(FUNCTION_B, 'Leaf')
    const parent = functionDocument(FUNCTION_A, 'Parent', [
      {
        id: 'nested-frame',
        type: 'frame',
        children: [functionCall('leaf-call', FUNCTION_B)]
      }
    ])
    await saveFunctions(repository, leaf, parent)
    const template = await application.templates.create({ name: 'Exam' })

    const first = await application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )
    expect(first.template.resources.functions).toHaveLength(2)
    const parentResource = first.template.resources.functions.find(
      (resource) => resource.id === first.functionRef
    )
    const nestedFrame = parentResource?.body.children[0]
    expect(nestedFrame?.type).toBe('frame')
    if (nestedFrame?.type !== 'frame') return
    const nested = nestedFrame.children[0]
    expect(nested?.type).toBe('function')
    if (nested?.type !== 'function') return
    expect(nested.functionRef).toMatch(/^sha256:/)
    expect(first.template.resources.functions.some((item) => item.id === nested.functionRef)).toBe(
      true
    )

    const second = await application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )
    expect(second.functionRef).toBe(first.functionRef)
    expect(second.template.resources.functions).toHaveLength(2)

    await repository.deleteLocalFunctionLibrary(LIBRARY_ID)
    expect(
      (await application.templates.get(template.templateId))?.resources.functions
    ).toHaveLength(2)
  })

  it('原子复制函数闭包并插入已补齐绑定的调用节点', async () => {
    const { repository, application } = setup()
    const source = functionDocument(FUNCTION_A, 'Question')
    source.content.inputs = [
      { name: 'prompt', type: 'string' },
      { name: 'duration', type: 'number' }
    ]
    source.content.outputs = [
      {
        name: 'result',
        type: 'string',
        expression: {
          type: 'string',
          source: 'variable',
          ref: { scope: 'local', name: 'prompt' }
        }
      }
    ]
    await saveFunctions(repository, source)
    const template = await application.templates.create({
      name: 'Exam',
      root: root([
        {
          id: 'function-call',
          type: 'choice-question',
          stem: { type: 'string', parts: [{ type: 'literal', value: 'Existing' }] },
          options: [
            { id: 'a', content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] } },
            { id: 'b', content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] } }
          ],
          outputName: 'result-1'
        }
      ])
    })

    const inserted = await application.templates.insertFunctionCall(
      template.templateId,
      functionLocator(FUNCTION_A),
      'root'
    )

    expect(inserted.template.revision).toBe(template.revision + 1)
    expect(inserted.template.resources.functions).toHaveLength(1)
    expect(inserted.callNodeId).toBe('function-call-1')
    expect(inserted.template.content.root.children[1]).toMatchObject({
      id: 'function-call-1',
      type: 'function',
      functionRef: inserted.functionRef,
      inputs: {
        prompt: { type: 'string', source: 'literal', value: '' },
        duration: { type: 'number', source: 'literal', value: 0 }
      },
      outputNames: { result: 'result-2' }
    })
  })

  it('把任意来源的函数依赖闭包复制为本地库内部快照后插入调用', async () => {
    const { repository, application } = setup()
    const target = functionDocument(FUNCTION_A, 'Target')
    await saveFunctions(repository, target)
    const imported = await createFunctionLibraryRelease(IMPORTED_LIBRARY_ID, 2, {
      name: 'Imported library',
      functions: [
        {
          functionId: FUNCTION_B,
          content: functionDocument(FUNCTION_B, 'Imported parent', [
            functionCall('nested-call', FUNCTION_C)
          ]).content
        },
        {
          functionId: FUNCTION_C,
          content: functionDocument(FUNCTION_C, 'Imported leaf').content
        }
      ]
    })
    await repository.registerImportedFunctionLibrary(imported)

    const inserted = await application.functionLibraries.local.insertFunctionCall(
      LIBRARY_ID,
      FUNCTION_A,
      {
        library: { source: 'imported', libraryId: IMPORTED_LIBRARY_ID, version: 2 },
        functionId: FUNCTION_B
      },
      'root'
    )

    expect(inserted.library.content.functions).toHaveLength(3)
    const internalEntries = inserted.library.content.functions.filter(
      (entry) => entry.exposed === false
    )
    expect(internalEntries.map((entry) => entry.content.name).sort()).toEqual([
      'Imported leaf',
      'Imported parent'
    ])
    const call = inserted.function.content.body.children[0]
    expect(call).toMatchObject({ id: inserted.callNodeId, type: 'function' })
    if (call?.type !== 'function') return
    const copiedParent = internalEntries.find((entry) => entry.functionId === call.functionRef)
    const nested = copiedParent?.content.body.children[0]
    expect(nested?.type).toBe('function')
    if (nested?.type !== 'function') return
    expect(internalEntries.some((entry) => entry.functionId === nested.functionRef)).toBe(true)
    expect(await application.browser.listFunctionLibraries()).toEqual([
      expect.objectContaining({
        source: 'imported',
        libraryId: IMPORTED_LIBRARY_ID,
        functions: [
          expect.objectContaining({ functionId: FUNCTION_B }),
          expect.objectContaining({ functionId: FUNCTION_C })
        ]
      }),
      expect.objectContaining({
        source: 'local',
        libraryId: LIBRARY_ID,
        functions: [{ functionId: FUNCTION_A, name: 'Target' }]
      })
    ])

    await repository.deleteImportedFunctionLibrary(IMPORTED_LIBRARY_ID, 2)
    const template = await application.templates.create()
    const embedded = await application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )
    expect(embedded.template.resources.functions).toHaveLength(3)

    const cleaned = await application.functionLibraries.local.saveFunction(inserted.library, {
      ...inserted.function,
      content: { ...inserted.function.content, body: root() }
    })
    expect(cleaned.content.functions).toEqual([expect.objectContaining({ functionId: FUNCTION_A })])
  })

  it('拒绝插入会回指当前函数的同库调用', async () => {
    const { repository, application } = setup()
    await saveFunctions(
      repository,
      functionDocument(FUNCTION_A, 'A'),
      functionDocument(FUNCTION_B, 'B', [functionCall('call-a', FUNCTION_A)])
    )
    const before = await repository.getLocalFunctionLibrary(LIBRARY_ID)

    await expect(
      application.functionLibraries.local.insertFunctionCall(
        LIBRARY_ID,
        FUNCTION_A,
        functionLocator(FUNCTION_B),
        'root'
      )
    ).rejects.toMatchObject({ code: 'RECURSIVE_FUNCTION_DEPENDENCY' })
    expect(await repository.getLocalFunctionLibrary(LIBRARY_ID)).toEqual(before)
  })

  it('调用节点插入失败时不保存刚复制的函数资源', async () => {
    const { repository, application } = setup()
    await saveFunctions(repository, functionDocument(FUNCTION_A, 'Question'))
    const template = await application.templates.create({ name: 'Exam' })

    await expect(
      application.templates.insertFunctionCall(
        template.templateId,
        functionLocator(FUNCTION_A),
        'missing-parent'
      )
    ).rejects.toMatchObject({
      code: 'EDIT_REJECTED',
      params: { code: 'PARENT_NOT_FOUND', path: 'parentId' }
    })

    expect(await repository.getTemplate(template.templateId)).toEqual(template)
  })

  it('从可达的函数资源收集 Schema manifest', async () => {
    const { repository, application, requestedSchemas } = setup()
    const source = functionDocument(FUNCTION_A, 'Schema consumer')
    source.content.schemaUses = [
      {
        useId: 'function-text',
        schemaId: SCHEMA_ID,
        inputBindings: { prompt: schemaText('Inside function') },
        answerBindings: {},
        attachments: []
      }
    ]
    await saveFunctions(repository, source)
    const template = await application.templates.create({ name: 'Exam' })
    const embedded = await application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )
    const saved = await application.templates.save({
      ...embedded.template,
      content: {
        ...embedded.template.content,
        root: root([functionCall('function-call', embedded.functionRef)])
      }
    })

    await expect(application.templates.validate(saved.templateId)).resolves.toEqual({
      valid: true,
      errors: []
    })
    expect(requestedSchemas).toContain(SCHEMA_ID)
  })

  it('拒绝递归或缺失的函数依赖', async () => {
    const { repository, application } = setup()
    await expect(
      saveFunctions(
        repository,
        functionDocument(FUNCTION_A, 'A', [functionCall('b', FUNCTION_B)]),
        functionDocument(FUNCTION_B, 'B', [functionCall('a', FUNCTION_A)])
      )
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    await saveFunctions(
      repository,
      functionDocument(FUNCTION_A, 'A'),
      functionDocument(FUNCTION_B, 'B')
    )
    const template = await application.templates.create()

    await expect(
      application.templates.embedFunction(template.templateId, functionLocator(FUNCTION_C))
    ).rejects.toEqual(
      expect.objectContaining<Partial<TemplateApplicationError>>({ code: 'FUNCTION_NOT_FOUND' })
    )
  })

  it('按根节点和嵌套引用清理不可达函数资源', async () => {
    const { repository, application } = setup()
    await saveFunctions(repository, functionDocument(FUNCTION_A, 'A'))
    const template = await application.templates.create()
    const embedded = await application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )

    const referenced = {
      ...embedded.template,
      content: {
        ...embedded.template.content,
        root: root([functionCall('call', embedded.functionRef)])
      }
    }
    const savedReferenced = await application.templates.save(referenced)
    const unchanged = await application.templates.pruneFunctionResources(template.templateId)
    expect(unchanged.content).toEqual(savedReferenced.content)
    expect(unchanged.resources).toEqual(savedReferenced.resources)

    await application.templates.save({
      ...unchanged,
      content: { ...unchanged.content, root: root() }
    })
    const pruned = await application.templates.pruneFunctionResources(template.templateId)
    expect(pruned.resources.functions).toEqual([])
  })

  it('autosave 与 embedFunction 交错时以 revision 冲突阻止覆盖', async () => {
    const { repository, externalDependencies } = setup()
    await saveFunctions(repository, functionDocument(FUNCTION_A, 'Slow function'))
    const entered = deferred<void>()
    const release = deferred<void>()
    const delayedRepository = forwardRepository(repository, {
      async getLocalFunctionLibrary(libraryId) {
        entered.resolve()
        await release.promise
        return repository.getLocalFunctionLibrary(libraryId)
      }
    })
    const application = createTemplateApplication({
      repository: delayedRepository,
      ...externalDependencies
    })
    const template = await application.templates.create({ name: 'Before edit' })

    const embedding = application.templates.embedFunction(
      template.templateId,
      functionLocator(FUNCTION_A)
    )
    await entered.promise
    const edited = await application.templates.save({
      ...template,
      content: { ...template.content, name: 'Autosaved edit' }
    })
    release.resolve()

    await expect(embedding).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect((await repository.getTemplate(template.templateId))?.content.name).toBe('Autosaved edit')
    expect(edited.resources.functions).toEqual([])
  })

  it('autosave 与 pruneFunctionResources 交错时以 revision 冲突阻止覆盖', async () => {
    const { repository, externalDependencies } = setup()
    const resource = await createFunctionResource(functionDocument(FUNCTION_A, 'Unused').content)
    const baseApplication = createTemplateApplication({ repository, ...externalDependencies })
    const template = await baseApplication.templates.create({ name: 'Before edit' })
    const withResource = await baseApplication.templates.save({
      ...template,
      resources: { functions: [resource] }
    })
    const entered = deferred<void>()
    const release = deferred<void>()
    const delayedRepository = forwardRepository(repository, {
      async saveTemplate(document) {
        if (document.resources.functions.length === 0) {
          entered.resolve()
          await release.promise
        }
        return repository.saveTemplate(document)
      }
    })
    const application = createTemplateApplication({
      repository: delayedRepository,
      ...externalDependencies
    })

    const pruning = application.templates.pruneFunctionResources(template.templateId)
    await entered.promise
    await repository.saveTemplate({
      ...withResource,
      content: { ...withResource.content, name: 'Autosaved edit' }
    })
    release.resolve()

    await expect(pruning).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    const stored = await repository.getTemplate(template.templateId)
    expect(stored?.content.name).toBe('Autosaved edit')
    expect(stored?.resources.functions).toHaveLength(1)
  })

  it('加载 Interface 与 Schema 依赖并编译所选实例', async () => {
    const { application } = setup()
    const template = await application.templates.create({
      name: 'Compiled exam',
      root: root([
        {
          id: 'page',
          type: 'page',
          content: { blocks: [] },
          timeline: [
            { type: 'countdown', seconds: { type: 'number', source: 'literal', value: 1 } }
          ]
        }
      ]),
      interfaces: [{ alias: 'data', interfaceId: INTERFACE_ID, acceptedVars: ['prompt'] }],
      schemaUses: [
        {
          useId: 'text',
          schemaId: SCHEMA_ID,
          inputBindings: {
            prompt: {
              type: 'string',
              parts: [
                {
                  type: 'variable',
                  ref: { scope: 'interface', alias: 'data', varName: 'prompt' }
                }
              ]
            }
          },
          answerBindings: {},
          attachments: []
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
        examData: { title: 'Compiled exam' },
        submissionTemplate: {
          schemaUses: [
            {
              schema: { schemaId: SCHEMA_ID },
              inputs: [
                {
                  inputId: 'prompt',
                  type: 'text',
                  value: 'Resolved prompt'
                }
              ],
              answers: []
            }
          ]
        }
      }
    })

    const preview = await application.templates.preview(
      {
        ...template,
        content: { ...template.content, name: 'Unsaved preview title' }
      },
      [{ alias: 'data', interfaceId: INTERFACE_ID, instanceId: INSTANCE_ID }]
    )
    expect(preview).toMatchObject({
      success: true,
      preview: {
        title: 'Unsaved preview title',
        pages: [{ sourceNodeId: 'page', timeline: [{ type: 'countdown', seconds: 1 }] }]
      }
    })
  })

  it('使用未保存的函数正文和临时输入生成无 Schema 预览', async () => {
    const { application, repository } = setup()
    const original = functionDocument(FUNCTION_A, 'Preview function')
    original.content.inputs = [{ name: 'title', type: 'string' }]
    await saveFunctions(repository, original)
    const unsaved: FunctionDocument = {
      ...original,
      content: {
        ...original.content,
        body: root([
          {
            id: 'preview-page',
            type: 'page',
            content: {
              blocks: [
                {
                  id: 'title',
                  type: 'text',
                  x: 10,
                  y: 20,
                  text: {
                    type: 'string',
                    parts: [{ type: 'variable', ref: { scope: 'local', name: 'title' } }]
                  }
                }
              ]
            },
            timeline: [
              { type: 'countdown', seconds: { type: 'number', source: 'literal', value: 3 } }
            ]
          }
        ])
      }
    }

    const result = await application.functionLibraries.local.preview(LIBRARY_ID, unsaved, {
      title: { type: 'string', source: 'literal', value: 'Unsaved preview title' }
    })

    expect(result).toMatchObject({
      success: true,
      preview: {
        title: 'Preview function',
        pages: [
          {
            sourceNodeId: 'preview-page',
            content: [{ id: expect.any(String), type: 'text', text: 'Unsaved preview title' }],
            timeline: [{ type: 'countdown', seconds: 3 }]
          }
        ]
      }
    })
    expect(await repository.listTemplateIds()).toEqual([])
  })

  it('为外部选择题组输入生成函数预览元数据', async () => {
    const { application, repository } = setup()
    const source = functionDocument(FUNCTION_A, 'Choice group preview')
    source.content.inputs = [
      {
        name: 'questions',
        type: 'choice-group',
        shape: { kind: 'range', pageCounts: [1, 2] }
      }
    ]
    source.content.body = root([
      {
        id: 'choice-preview-page',
        type: 'page',
        content: {
          blocks: [
            {
              id: 'choice-preview-view',
              type: 'choice-view',
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              defaultViewport: {
                mode: 'free',
                group: { scope: 'local', name: 'questions' }
              }
            }
          ]
        },
        timeline: [{ type: 'countdown', seconds: { type: 'number', source: 'literal', value: 1 } }]
      }
    ])
    await saveFunctions(repository, source)

    const result = await application.functionLibraries.local.preview(LIBRARY_ID, source, {
      questions: {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'range', startPage: 1 }
      }
    })

    expect(result).toMatchObject({
      success: true,
      preview: {
        pages: [
          {
            sourceNodeId: 'choice-preview-page',
            content: [
              {
                type: 'choice-view',
                defaultViewport: { mode: 'range', startPage: 1, endPage: 2 }
              }
            ]
          }
        ]
      }
    })
  })

  it('函数预览的外层 Collector 会同时收集函数自身题目', async () => {
    const { application, repository } = setup()
    const source = functionDocument(FUNCTION_A, 'Choice group preview with question')
    source.content.inputs = [
      {
        name: 'questions',
        type: 'choice-group',
        shape: { kind: 'range', pageCounts: [1, 2] }
      }
    ]
    source.content.body = root([previewChoiceQuestion(), previewChoicePage()])
    await saveFunctions(repository, source)

    const result = await application.functionLibraries.local.preview(LIBRARY_ID, source, {
      questions: {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'range', startPage: 0 }
      }
    })

    expect(result).toMatchObject({
      success: true,
      preview: {
        choiceMeta: {
          pages: [{ questionIndices: [0] }, { questionIndices: [1, 2] }, { questionIndices: [3] }],
          questions: [{}, {}, {}, { stem: 'Own question' }]
        },
        pages: [
          {
            sourceNodeId: 'choice-preview-page',
            content: [
              {
                type: 'choice-view',
                defaultViewport: { mode: 'range', startPage: 0, endPage: 1 }
              }
            ]
          }
        ]
      }
    })
  })

  it('全量题组输入会用函数自身题目填充目标形状', async () => {
    const { application, repository } = setup()
    const source = functionDocument(FUNCTION_A, 'Whole choice group preview with question')
    source.content.inputs = [
      {
        name: 'questions',
        type: 'choice-group',
        shape: { kind: 'all', pageCounts: [1, 2] }
      }
    ]
    source.content.body = root([previewChoiceQuestion(), previewChoicePage()])
    await saveFunctions(repository, source)

    const result = await application.functionLibraries.local.preview(LIBRARY_ID, source, {
      questions: {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'all' }
      }
    })

    expect(result).toMatchObject({
      success: true,
      preview: {
        choiceMeta: {
          pages: [{ questionIndices: [0] }, { questionIndices: [1, 2] }],
          questions: [{}, {}, { stem: 'Own question' }]
        }
      }
    })
  })

  it('函数已有 Collector 时预览不会再创建嵌套 Collector', async () => {
    const { application, repository } = setup()
    const source = functionDocument(FUNCTION_A, 'Collected choice group preview')
    source.content.inputs = [
      {
        name: 'questions',
        type: 'choice-group',
        shape: { kind: 'all', pageCounts: [1] }
      }
    ]
    source.content.body = root([previewChoiceQuestion(), previewChoicePage()])
    source.content.body.choiceCollector = { pages: [{ questionCount: 1 }] }
    await saveFunctions(repository, source)

    const result = await application.functionLibraries.local.preview(LIBRARY_ID, source, {
      questions: {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'all' }
      }
    })

    expect(result).toMatchObject({
      success: true,
      preview: {
        choiceMeta: {
          pages: [{ questionIndices: [0] }],
          questions: [{ stem: 'Own question' }]
        }
      }
    })
  })
})

function previewChoiceQuestion(): TemplateNode {
  return {
    id: 'own-question',
    type: 'choice-question',
    stem: { type: 'string', parts: [{ type: 'literal', value: 'Own question' }] },
    options: [
      {
        id: 'own-option-a',
        content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] }
      },
      {
        id: 'own-option-b',
        content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] }
      }
    ],
    outputName: 'own-answer'
  }
}

function previewChoicePage(): TemplateNode {
  return {
    id: 'choice-preview-page',
    type: 'page',
    content: {
      blocks: [
        {
          id: 'choice-preview-view',
          type: 'choice-view',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          defaultViewport: {
            mode: 'free',
            group: { scope: 'local', name: 'questions' }
          }
        }
      ]
    },
    timeline: [{ type: 'countdown', seconds: { type: 'number', source: 'literal', value: 1 } }]
  }
}

function forwardRepository(
  base: TemplateRepository,
  overrides: Partial<TemplateRepository>
): TemplateRepository {
  return {
    listTemplateIds: () => base.listTemplateIds(),
    getTemplate: (id) => base.getTemplate(id),
    createTemplate: (document) => base.createTemplate(document),
    saveTemplate: (document) => base.saveTemplate(document),
    deleteTemplate: (id) => base.deleteTemplate(id),
    listLocalFunctionLibraryIds: () => base.listLocalFunctionLibraryIds(),
    getLocalFunctionLibrary: (id) => base.getLocalFunctionLibrary(id),
    saveLocalFunctionLibrary: (document) => base.saveLocalFunctionLibrary(document),
    deleteLocalFunctionLibrary: (id) => base.deleteLocalFunctionLibrary(id),
    listImportedFunctionLibraryIds: () => base.listImportedFunctionLibraryIds(),
    listImportedFunctionLibraryVersions: (id) => base.listImportedFunctionLibraryVersions(id),
    getImportedFunctionLibrary: (id, version) => base.getImportedFunctionLibrary(id, version),
    registerImportedFunctionLibrary: (release) => base.registerImportedFunctionLibrary(release),
    deleteImportedFunctionLibrary: (id, version) => base.deleteImportedFunctionLibrary(id, version),
    listBuiltinFunctionLibraryIds: () => base.listBuiltinFunctionLibraryIds(),
    getActiveBuiltinFunctionLibrary: (id) => base.getActiveBuiltinFunctionLibrary(id),
    getBuiltinFunctionLibrary: (id, version) => base.getBuiltinFunctionLibrary(id, version),
    registerBuiltinFunctionLibrary: (release) => base.registerBuiltinFunctionLibrary(release),
    setActiveBuiltinFunctionLibraryVersion: (id, version) =>
      base.setActiveBuiltinFunctionLibraryVersion(id, version),
    ...overrides
  }
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
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

class SyntaxErrorStore implements TemplateStore {
  scope(): TemplateStore {
    return this
  }

  async readText<T>(): Promise<T | null> {
    throw new SyntaxError('Unexpected end of JSON input')
  }

  async writeText<T>(_filename: string, _data: T): Promise<void> {}

  async compareAndSwapText<T>(_filename: string, _expected: T | null, _data: T): Promise<boolean> {
    return false
  }

  async listScopes(): Promise<string[]> {
    return []
  }

  async clear(): Promise<void> {}
}
