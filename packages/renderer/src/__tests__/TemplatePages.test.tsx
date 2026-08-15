// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import type { JSX } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import { TemplateBrowserPage } from '../features/templates/TemplateBrowserPage'
import {
  BuiltinTemplateDocumentPage,
  TemplateDocumentPage
} from '../features/templates/TemplateDocumentPage'

const functionLibraryFileDialog = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('@ls101/file-dialog/renderer', () => ({ fileDialog: functionLibraryFileDialog }))

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'
const FUNCTION_ID = '20000000-0000-4000-8000-000000000002'
const MISSING_TEMPLATE_ID = '30000000-0000-4000-8000-000000000003'
const NEW_LIBRARY_ID = '70000000-0000-4000-8000-000000000007'
const NEW_FUNCTION_ID = '80000000-0000-4000-8000-000000000008'
const IMPORTED_TEMPLATE_ID = '90000000-0000-4000-8000-000000000009'
const BUILTIN_TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const BUILTIN_COPY_ID = 'a0000000-0000-4000-8000-00000000000a'
const INTERFACE_ID = `sha256:${'a'.repeat(64)}`

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  functionLibraryFileDialog.readText.mockReset()
  functionLibraryFileDialog.writeText.mockReset()
})

function template(revision = 1, templateId = TEMPLATE_ID, name = '听力模板'): TemplateDocument {
  return {
    templateId,
    revision,
    content: {
      name,
      description: '十道选择题',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [{ id: 'page-1', type: 'page', content: { blocks: [] }, timeline: [] }]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function clickLibraryFunction(name: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: `添加${name}` }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存' })).not.toHaveTextContent('正在保存')
  )
}

async function openTemplateBrowserTab(name: '内置模板' | '我的模板' | '函数库'): Promise<void> {
  fireEvent.click(await screen.findByRole('tab', { name }))
}

function TemplateRouteSwitcher(): JSX.Element {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate(`/templates/${TEMPLATE_ID}`)}>
        打开现有模板
      </button>
      <button type="button" onClick={() => navigate(`/templates/${MISSING_TEMPLATE_ID}`)}>
        打开缺失模板
      </button>
      <Routes>
        <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
      </Routes>
    </>
  )
}

function TemplateNavigationHarness(): JSX.Element {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/templates')}>
        前往模板列表
      </button>
      <Routes>
        <Route path="/templates" element={<TemplateBrowserPage />} />
        <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
      </Routes>
    </>
  )
}

function application(document = template()): TemplateApplication {
  let storedDocument = structuredClone(document)
  const app = {
    browser: {
      listTemplates: vi.fn().mockResolvedValue([
        {
          templateId: TEMPLATE_ID,
          name: document.content.name,
          description: document.content.description
        }
      ]),
      listBuiltinTemplates: vi.fn().mockResolvedValue([
        {
          templateId: BUILTIN_TEMPLATE_ID,
          version: 1,
          name: '基础试卷',
          description: '内置基础模板',
          available: true,
          errors: []
        }
      ]),
      listFunctionLibraries: vi.fn().mockResolvedValue([
        {
          source: 'builtin',
          libraryId: 'builtin:basic',
          version: 2,
          name: '基础组件库',
          functions: [
            {
              functionId: 'builtin:frame',
              name: '框架',
              component: createLibraryNode('builtin:frame')
            },
            {
              functionId: 'builtin:page',
              name: '页面',
              component: createLibraryNode('builtin:page')
            },
            {
              functionId: 'builtin:choice-question',
              name: '选择题',
              component: createLibraryNode('builtin:choice-question')
            },
            {
              functionId: 'builtin:variable',
              name: '变量',
              component: createLibraryNode('builtin:variable')
            }
          ]
        },
        {
          source: 'builtin',
          libraryId: 'builtin:examples',
          version: 3,
          name: '示例组件库',
          functions: [
            {
              functionId: 'builtin:example-title-page',
              name: '标题页组合'
            },
            {
              functionId: 'builtin:example-choice-section',
              name: '选择题组合'
            }
          ]
        },
        {
          source: 'imported',
          libraryId: '50000000-0000-4000-8000-000000000005',
          version: 3,
          name: '导入题型库',
          functions: [{ functionId: '60000000-0000-4000-8000-000000000006', name: '口语题' }]
        },
        {
          source: 'local',
          libraryId: '40000000-0000-4000-8000-000000000004',
          name: '听力函数库',
          functions: [{ functionId: FUNCTION_ID, name: '单题函数' }]
        }
      ]),
      listInterfaces: vi.fn().mockResolvedValue([
        {
          interfaceId: INTERFACE_ID,
          interfaceName: '考试数据',
          vars: [
            {
              varName: 'prompt',
              type: 'text',
              description: '题目文本',
              example: '请作答',
              path: 'prompt'
            },
            {
              varName: 'picture',
              type: 'image',
              description: '题目图片',
              example: 'image.png',
              path: 'picture'
            }
          ]
        }
      ]),
      listInterfaceInstances: vi.fn().mockResolvedValue([])
    },
    templates: {
      create: vi.fn().mockResolvedValue(document),
      inspectImport: vi.fn().mockResolvedValue({ status: 'new', existing: null }),
      importDocument: vi.fn().mockImplementation(async (source, mode) => ({
        ...structuredClone(source),
        templateId: mode === 'copy' ? IMPORTED_TEMPLATE_ID : source.templateId,
        revision: 0
      })),
      get: vi.fn().mockImplementation(async () => structuredClone(storedDocument)),
      save: vi.fn().mockImplementation(async (value: TemplateDocument) => {
        storedDocument = { ...value, revision: value.revision + 1 }
        return storedDocument
      }),
      delete: vi.fn(),
      embedFunction: vi.fn(),
      insertFunctionCall: vi.fn(),
      pruneFunctionResources: vi.fn(),
      validate: vi.fn(),
      compile: vi.fn(),
      preview: vi.fn()
    },
    builtinTemplates: {
      get: vi.fn().mockResolvedValue({
        templateId: BUILTIN_TEMPLATE_ID,
        version: 1,
        releaseHash: `sha256:${'b'.repeat(64)}`,
        document: {
          content: {
            name: '基础试卷',
            description: '内置基础模板',
            interfaces: [],
            root: {
              id: 'builtin-root',
              type: 'frame',
              children: [
                {
                  id: 'builtin-page',
                  name: '封面',
                  type: 'page',
                  content: { blocks: [] },
                  timeline: []
                }
              ]
            },
            schemaUses: []
          },
          resources: { functions: [] },
          editorState: { selectedNodeId: 'builtin-root' }
        }
      }),
      createCopy: vi.fn().mockResolvedValue(template(0, BUILTIN_COPY_ID, '基础试卷')),
      validate: vi.fn(),
      compile: vi.fn(),
      preview: vi.fn()
    },
    functionLibraries: {
      imported: {
        register: vi.fn().mockImplementation(async (release) => release),
        delete: vi.fn().mockResolvedValue(undefined)
      },
      local: {
        create: vi.fn().mockImplementation(async (name = '') => ({
          libraryId: NEW_LIBRARY_ID,
          revision: 0,
          storageRevision: 1,
          content: { name, functions: [] },
          editorState: { library: {}, functions: {} }
        })),
        get: vi.fn().mockResolvedValue({
          libraryId: '40000000-0000-4000-8000-000000000004',
          revision: 0,
          storageRevision: 1,
          content: { name: '听力函数库', functions: [] },
          editorState: { library: {}, functions: {} }
        }),
        save: vi.fn().mockImplementation(async (library) => ({
          ...library,
          storageRevision: library.storageRevision + 1
        })),
        createFunction: vi.fn().mockImplementation(async (libraryId, initial = {}) => {
          const content = emptyFunctionContent(initial.name ?? '')
          return {
            library: {
              libraryId,
              revision: 0,
              storageRevision: 2,
              content: {
                name: '未命名函数库',
                functions: [{ functionId: NEW_FUNCTION_ID, content }]
              },
              editorState: { library: {}, functions: { [NEW_FUNCTION_ID]: {} } }
            },
            function: { functionId: NEW_FUNCTION_ID, content, editorState: {} }
          }
        }),
        deleteFunction: vi.fn().mockImplementation(async (library, functionId) => ({
          ...library,
          storageRevision: library.storageRevision + 1,
          content: {
            ...library.content,
            functions: library.content.functions.filter((item) => item.functionId !== functionId)
          }
        })),
        delete: vi.fn().mockResolvedValue(undefined)
      }
    }
  } as unknown as TemplateApplication
  return app
}

function emptyFunctionContent(name: string) {
  return {
    name,
    inputs: [],
    body: { id: 'root', type: 'frame' as const, children: [] },
    outputs: [],
    schemaUses: []
  }
}

function createLibraryNode(
  functionId: string
): TemplateDocument['content']['root']['children'][number] {
  if (functionId === 'builtin:frame') return { id: 'frame', type: 'frame', children: [] }
  if (functionId === 'builtin:page') {
    return { id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }
  }
  if (functionId === 'builtin:variable') {
    return {
      id: 'variable',
      type: 'variable',
      variableName: 'value',
      value: { type: 'string', parts: [{ type: 'literal', value: '' }] }
    }
  }
  return {
    id: 'question',
    type: 'choice-question',
    stem: { type: 'string', parts: [{ type: 'literal', value: '' }] },
    options: [
      { id: 'option-a', content: { type: 'string', parts: [{ type: 'literal', value: '' }] } },
      { id: 'option-b', content: { type: 'string', parts: [{ type: 'literal', value: '' }] } }
    ],
    outputName: 'choice'
  }
}

describe('Template pages', () => {
  it('previews every timeline step in a vertical filmstrip', async () => {
    const document = template()
    const page = document.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    page.name = '开场页面'
    page.timeline = [
      { type: 'play', text: { type: 'string', parts: [{ type: 'literal', value: '请听题' }] } },
      { type: 'countdown', seconds: { type: 'number', source: 'literal', value: 3 } }
    ]
    const app = application(document)
    vi.mocked(app.templates.preview).mockResolvedValue({
      success: true,
      preview: {
        title: '听力模板',
        pages: [
          {
            id: 'page:page-1',
            sourceNodeId: 'page-1',
            sourceNodeName: '开场页面',
            callPath: [],
            content: [
              {
                id: 'block:title',
                type: 'text',
                x: 10,
                y: 10,
                width: 80,
                text: '请听题'
              }
            ],
            timeline: [
              { type: 'play', text: '请听题' },
              { type: 'countdown', seconds: 3 }
            ]
          }
        ],
        recordingIndices: [],
        resources: {}
      },
      resourceSources: []
    })

    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('tab', { name: '预览' }))

    expect(await screen.findByRole('complementary', { name: '预览序列' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '函数库' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '预览配置' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '预览画面 1，TTS 播放' })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.getByRole('button', { name: '预览画面 2，倒计时' })).toBeInTheDocument()
    expect(screen.getByLabelText('最终画面 1').shadowRoot?.textContent).toContain('请听题')

    fireEvent.click(screen.getByRole('button', { name: '预览画面 2，倒计时' }))
    expect(screen.getByLabelText('最终画面 2')).toBeInTheDocument()
    expect(app.templates.preview).toHaveBeenCalledWith(document, [])
  })

  it('从工具栏进入独立的全屏试卷生成路由', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
            <Route path="/templates/:templateId/generate" element={<h1>试卷生成设置</h1>} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '生成试卷' }))

    expect(await screen.findByRole('heading', { name: '试卷生成设置' })).toBeInTheDocument()
  })

  it('从只读编辑器进入内置模板生成路由且不尝试保存', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/builtin/${BUILTIN_TEMPLATE_ID}`]}>
          <Routes>
            <Route
              path="/templates/builtin/:templateId"
              element={<BuiltinTemplateDocumentPage />}
            />
            <Route
              path="/templates/builtin/:templateId/generate"
              element={<h1>内置模板生成设置</h1>}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '生成试卷' }))

    expect(await screen.findByRole('heading', { name: '内置模板生成设置' })).toBeInTheDocument()
    expect(app.templates.save).not.toHaveBeenCalled()
  })

  it('进入生成路由前先保存模板的未保存修改', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
            <Route path="/templates/:templateId/generate" element={<h1>试卷生成设置</h1>} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const properties = await screen.findByRole('complementary', { name: '属性' })
    fireEvent.change(within(properties).getByLabelText('名称'), {
      target: { value: '已修改模板' }
    })
    fireEvent.click(await screen.findByRole('button', { name: '生成试卷' }))

    expect(await screen.findByRole('heading', { name: '试卷生成设置' })).toBeInTheDocument()
    expect(app.templates.save).toHaveBeenCalledOnce()
  })

  it('adds and configures an Interface requirement in global properties', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const properties = await screen.findByRole('complementary', { name: '属性' })
    fireEvent.click(await within(properties).findByRole('button', { name: '添加 Interface' }))
    fireEvent.change(within(properties).getByLabelText('选择 Interface'), {
      target: { value: INTERFACE_ID }
    })

    expect(within(properties).getByLabelText('新 Interface 别名')).toHaveValue('data')
    expect(within(properties).getByLabelText('新 Interface 变量 prompt')).toBeChecked()
    expect(within(properties).getByLabelText('新 Interface 变量 picture')).toBeChecked()
    fireEvent.click(within(properties).getByLabelText('新 Interface 变量 picture'))
    fireEvent.click(within(properties).getByRole('button', { name: '添加', exact: true }))

    expect(within(properties).getByText('考试数据')).toBeInTheDocument()
    fireEvent.change(within(properties).getByLabelText('Interface data 别名'), {
      target: { value: 'speaking' }
    })
    expect(within(properties).getByLabelText('Interface speaking 变量 prompt')).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    expect(vi.mocked(app.templates.save).mock.calls[0][0].content.interfaces).toEqual([
      { alias: 'speaking', interfaceId: INTERFACE_ID, acceptedVars: ['prompt'] }
    ])
  })

  it('lists templates and function libraries and opens a template', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByRole('tab', { name: '内置模板' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: '我的模板' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: '函数库' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByText('基础试卷')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '创建副本' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '生成试卷' })).toBeEnabled()
    const builtinRow = screen.getByText('基础试卷').closest('article')
    expect(builtinRow).not.toBeNull()
    expect(within(builtinRow as HTMLElement).queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '听力模板' })).not.toBeInTheDocument()
    expect(screen.queryByText('听力函数库')).not.toBeInTheDocument()

    await openTemplateBrowserTab('函数库')
    expect(screen.getByText('听力函数库')).toBeInTheDocument()
    expect(screen.queryByText('基础试卷')).not.toBeInTheDocument()

    await openTemplateBrowserTab('我的模板')
    expect(screen.getByRole('button', { name: '听力模板' })).toBeInTheDocument()
    expect(screen.queryByText('听力函数库')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '听力模板' }))

    expect(await screen.findByRole('heading', { name: '结构' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '函数库' })).toBeInTheDocument()
    const properties = screen.getByRole('complementary', { name: '属性' })
    expect(properties).toBeInTheDocument()
    const globalProperties = within(properties).getByRole('button', { name: '全局属性' })
    expect(globalProperties).toHaveAttribute('aria-expanded', 'true')
    expect(within(properties).getByRole('button', { name: '节点属性' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    fireEvent.click(globalProperties)
    expect(within(properties).queryByLabelText('名称')).not.toBeInTheDocument()
    fireEvent.click(globalProperties)
    expect(within(properties).getByLabelText('名称')).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '调整函数库宽度' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '调整属性栏宽度' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '内置函数库' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '导入函数库' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.getByRole('tab', { name: '本地函数库' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
    expect(screen.getByRole('button', { name: '基础组件库，版本 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加框架' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加页面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加选择题' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加变量' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '示例组件库，版本 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加标题页组合' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加选择题组合' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '导入函数库' }))
    expect(screen.getByRole('button', { name: '导入题型库，版本 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加口语题' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加框架' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    expect(screen.getByRole('button', { name: '听力函数库，未导出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加单题函数' })).toBeInTheDocument()
    expect(screen.getByText('page-1')).toBeInTheDocument()
    expect(app.templates.get).toHaveBeenCalledWith(TEMPLATE_ID)
    expect(app.browser.listFunctionLibraries).toHaveBeenCalledTimes(2)
  })

  it('creates an editable local copy from the built-in template list', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '创建副本' }))

    await waitFor(() =>
      expect(app.builtinTemplates.createCopy).toHaveBeenCalledWith(BUILTIN_TEMPLATE_ID)
    )
    expect(screen.getByRole('tab', { name: '我的模板' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '基础试卷' })).toBeInTheDocument()
  })

  it('opens exam generation directly from a local template row', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
            <Route path="/templates/:templateId/generate" element={<h1>试卷生成设置</h1>} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    const row = screen.getByRole('button', { name: '听力模板' }).closest('article')
    expect(row).not.toBeNull()
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '生成试卷' }))

    expect(await screen.findByRole('heading', { name: '试卷生成设置' })).toBeInTheDocument()
    expect(app.templates.get).not.toHaveBeenCalled()
  })

  it('opens a built-in template in the original editor read-only mode and creates a copy', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/builtin/${BUILTIN_TEMPLATE_ID}`]}>
          <Routes>
            <Route
              path="/templates/builtin/:templateId"
              element={<BuiltinTemplateDocumentPage />}
            />
            <Route path="/templates/:templateId" element={<div>可编辑副本</div>} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '基础试卷' })).toBeInTheDocument()
    expect(app.builtinTemplates.get).toHaveBeenCalledWith(BUILTIN_TEMPLATE_ID)
    expect(app.templates.get).not.toHaveBeenCalled()
    expect(screen.getByText('内置模板 · 只读')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '函数库' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '属性' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '预览' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加框架' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择节点 builtin-root' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '选择节点 builtin-page' }))
    expect(screen.getByRole('tab', { name: '页面' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: '名称', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: '查看节点 builtin-page 页面内容' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除节点/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '创建副本' }))

    await waitFor(() =>
      expect(app.builtinTemplates.createCopy).toHaveBeenCalledWith(BUILTIN_TEMPLATE_ID)
    )
    expect(await screen.findByText('可编辑副本')).toBeInTheDocument()
  })

  it('disables generation for a builtin template with missing dependencies', async () => {
    const app = application()
    vi.mocked(app.browser.listBuiltinTemplates).mockResolvedValue([
      {
        templateId: '11111111-1111-4111-8111-111111111111',
        version: 2,
        name: '依赖缺失模板',
        description: '',
        available: false,
        errors: [{ path: 'interfaces[0]', code: 'UNKNOWN_INTERFACE', params: {} }]
      }
    ])
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const row = (await screen.findByText('依赖缺失模板')).closest('article')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByRole('button', { name: '生成试卷' })).toBeDisabled()
    expect(within(row as HTMLElement).getByText(/当前版本暂不可用/)).toBeInTheDocument()
  })

  it('deletes a template from the browser after confirmation', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    await screen.findByRole('button', { name: '听力模板' })
    fireEvent.click(screen.getByRole('button', { name: '删除模板“听力模板”' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(app.templates.delete).toHaveBeenCalledWith(TEMPLATE_ID))
    expect(screen.queryByRole('button', { name: '听力模板' })).not.toBeInTheDocument()
  })

  it('exports a persisted template from the browser row action', async () => {
    const app = application()
    functionLibraryFileDialog.writeText.mockResolvedValue(true)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    await screen.findByRole('button', { name: '听力模板' })
    fireEvent.click(screen.getByRole('button', { name: '导出模板“听力模板”' }))

    await waitFor(() => expect(functionLibraryFileDialog.writeText).toHaveBeenCalledOnce())
    expect(JSON.parse(functionLibraryFileDialog.writeText.mock.calls[0][0])).toEqual(template())
    expect(functionLibraryFileDialog.writeText.mock.calls[0][1]).toEqual({
      title: '导出模板',
      defaultName: '听力模板-r1.lstemplate',
      filters: [{ name: 'LS101 Template', extensions: ['lstemplate'] }]
    })
  })

  it('imports a new template with its source ID and resets its revision', async () => {
    const app = application()
    const source = template(8, IMPORTED_TEMPLATE_ID, '外部新模板')
    functionLibraryFileDialog.readText.mockResolvedValue({
      name: 'import.lstemplate',
      data: JSON.stringify(source)
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByRole('tab', { name: '内置模板' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: '导入模板' }))

    expect(await screen.findByRole('button', { name: '外部新模板' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '我的模板' })).toHaveAttribute('aria-selected', 'true')
    expect(app.templates.inspectImport).toHaveBeenCalledWith(source)
    expect(app.templates.importDocument).toHaveBeenCalledWith(source, 'preserve-id')
  })

  it('does not import a source ID whose stored content is identical', async () => {
    const existing = template()
    const app = application(existing)
    vi.mocked(app.templates.inspectImport).mockResolvedValue({
      status: 'identical',
      existing
    })
    functionLibraryFileDialog.readText.mockResolvedValue({
      name: 'same.lstemplate',
      data: JSON.stringify({ ...existing, revision: 9 })
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    await screen.findByRole('button', { name: '听力模板' })
    fireEvent.click(screen.getByRole('button', { name: '导入模板' }))

    await waitFor(() => expect(app.templates.inspectImport).toHaveBeenCalledOnce())
    expect(app.templates.importDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('offers copy and overwrite actions when imported content conflicts', async () => {
    const existing = template()
    const source = template(4, TEMPLATE_ID, '外部模板')
    const app = application(existing)
    vi.mocked(app.templates.inspectImport).mockResolvedValue({
      status: 'conflict',
      existing
    })
    functionLibraryFileDialog.readText.mockResolvedValue({
      name: 'conflict.lstemplate',
      data: JSON.stringify(source)
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    await screen.findByRole('button', { name: '听力模板' })
    fireEvent.click(screen.getByRole('button', { name: '导入模板' }))
    const dialog = await screen.findByRole('alertdialog', { name: '模板“外部模板”已存在' })
    expect(within(dialog).getByText(/本地 revision 1 与文件 revision 4/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '导入为副本' }))

    await waitFor(() =>
      expect(app.templates.importDocument).toHaveBeenCalledWith(source, 'copy', undefined)
    )
    expect(await screen.findByRole('button', { name: '外部模板' })).toBeInTheDocument()
  })

  it('replaces the existing row after a confirmed conflict overwrite', async () => {
    const existing = template()
    const source = template(4, TEMPLATE_ID, '覆盖后的模板')
    const app = application(existing)
    vi.mocked(app.templates.inspectImport).mockResolvedValue({
      status: 'conflict',
      existing
    })
    vi.mocked(app.templates.importDocument).mockResolvedValue({ ...source, revision: 2 })
    functionLibraryFileDialog.readText.mockResolvedValue({
      name: 'conflict.lstemplate',
      data: JSON.stringify(source)
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await openTemplateBrowserTab('我的模板')
    await screen.findByRole('button', { name: '听力模板' })
    fireEvent.click(screen.getByRole('button', { name: '导入模板' }))
    const dialog = await screen.findByRole('alertdialog', { name: '模板“覆盖后的模板”已存在' })
    fireEvent.click(within(dialog).getByRole('button', { name: '覆盖本地模板' }))

    await waitFor(() =>
      expect(app.templates.importDocument).toHaveBeenCalledWith(source, 'overwrite', 1)
    )
    expect(screen.queryByRole('button', { name: '听力模板' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '覆盖后的模板' })).toBeInTheDocument()
  })

  it('saves editor changes before exporting the persisted template revision', async () => {
    const app = application()
    functionLibraryFileDialog.writeText.mockResolvedValue(true)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const properties = await screen.findByRole('complementary', { name: '属性' })
    fireEvent.change(within(properties).getByLabelText('名称'), {
      target: { value: '已修改模板' }
    })
    fireEvent.click(screen.getByRole('button', { name: '导出模板' }))

    await waitFor(() => expect(functionLibraryFileDialog.writeText).toHaveBeenCalledOnce())
    expect(app.templates.save).toHaveBeenCalledOnce()
    expect(JSON.parse(functionLibraryFileDialog.writeText.mock.calls[0][0])).toMatchObject({
      revision: 2,
      content: { name: '已修改模板' }
    })
    expect(functionLibraryFileDialog.writeText.mock.calls[0][1]).toMatchObject({
      defaultName: '已修改模板-r2.lstemplate'
    })
  })

  it('shows a source-aware empty state when a function library source is empty', async () => {
    const app = application()
    vi.mocked(app.browser.listFunctionLibraries).mockResolvedValue([])
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByText('暂无内置函数库')).toBeInTheDocument()
    expect(screen.getByText('当前没有可用的内置组件')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '导入函数库' }))
    expect(screen.getByText('暂无导入函数库')).toBeInTheDocument()
    expect(screen.getByText('导入函数库后会显示在这里')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    expect(screen.getByText('暂无本地函数库')).toBeInTheDocument()
    expect(screen.getByText('创建本地函数库后会显示在这里')).toBeInTheDocument()
  })

  it('offers to reset a damaged local function library and creates a replacement', async () => {
    const app = application()
    const invalidLibraryId = '40000000-0000-4000-8000-000000000004'
    vi.mocked(app.browser.listFunctionLibraries)
      .mockResolvedValueOnce([
        {
          source: 'builtin',
          libraryId: 'builtin:basic',
          version: 2,
          name: '基础组件库',
          functions: []
        },
        {
          source: 'local',
          libraryId: invalidLibraryId,
          name: '损坏的本地函数库',
          functions: [],
          error: `Local function library ${invalidLibraryId} is invalid`
        }
      ])
      .mockResolvedValueOnce([])

    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(invalidLibraryId)
    fireEvent.click(screen.getByRole('button', { name: '重置损坏函数库' }))
    const dialog = screen.getByRole('alertdialog', { name: '重置损坏的本地函数库？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重置函数库' }))

    await waitFor(() =>
      expect(app.functionLibraries.local.delete).toHaveBeenCalledWith(invalidLibraryId)
    )
    expect(app.functionLibraries.local.create).toHaveBeenCalledWith('未命名函数库')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: '本地函数库' })).toHaveAttribute('aria-selected', 'true')
  })

  it('creates and deletes local function libraries from the library panel', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('button', { name: '新建本地函数库' }))

    await waitFor(() =>
      expect(app.functionLibraries.local.create).toHaveBeenCalledWith('未命名函数库')
    )
    expect(screen.getByRole('tab', { name: '本地函数库' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '未命名函数库，未导出' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /删除本地函数库“基础组件库”/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '在“未命名函数库”中新建函数' }))
    await waitFor(() =>
      expect(app.functionLibraries.local.createFunction).toHaveBeenCalledWith(NEW_LIBRARY_ID, {
        name: '未命名函数'
      })
    )
    expect(screen.getByRole('button', { name: '添加未命名函数' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除本地函数库“未命名函数库”' }))
    expect(
      screen.getByRole('alertdialog', { name: '删除本地函数库“未命名函数库”？' })
    ).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(app.functionLibraries.local.delete).toHaveBeenCalledWith(NEW_LIBRARY_ID)
    )
    expect(screen.queryByRole('button', { name: '未命名函数库，未导出' })).not.toBeInTheDocument()
  })

  it('deletes a local function from its library row after confirmation', async () => {
    const app = application()
    const library = {
      libraryId: '40000000-0000-4000-8000-000000000004',
      revision: 0,
      storageRevision: 1,
      content: {
        name: '听力函数库',
        functions: [{ functionId: FUNCTION_ID, content: emptyFunctionContent('单题函数') }]
      },
      editorState: { library: {}, functions: { [FUNCTION_ID]: {} } }
    }
    vi.mocked(app.functionLibraries.local.get).mockResolvedValueOnce(library)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    fireEvent.click(screen.getByRole('button', { name: '删除本地函数“单题函数”' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(app.functionLibraries.local.deleteFunction).toHaveBeenCalledWith(library, FUNCTION_ID)
    )
    expect(screen.queryByRole('button', { name: '编辑单题函数' })).not.toBeInTheDocument()
  })

  it('renames only local function libraries and refreshes their row actions', async () => {
    const app = application()
    const localDocument = {
      libraryId: '40000000-0000-4000-8000-000000000004',
      revision: 3,
      storageRevision: 3,
      content: {
        name: '听力函数库',
        functions: [
          {
            functionId: FUNCTION_ID,
            content: emptyFunctionContent('单题函数')
          }
        ]
      },
      editorState: { library: {}, functions: { [FUNCTION_ID]: {} } },
      exportState: { contentHash: `sha256:${'0'.repeat(64)}` }
    }
    vi.mocked(app.functionLibraries.local.get).mockResolvedValueOnce(localDocument)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('tab', { name: '导入函数库' }))
    expect(screen.queryByRole('button', { name: /重命名.*导入题型库/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    fireEvent.click(screen.getByRole('button', { name: '重命名本地函数库“听力函数库”' }))
    const input = screen.getByRole('textbox', { name: '函数库“听力函数库”名称' })
    fireEvent.change(input, { target: { value: '听力题型库' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(app.functionLibraries.local.save).toHaveBeenCalledWith({
        ...localDocument,
        content: { ...localDocument.content, name: '听力题型库' }
      })
    )
    expect(screen.getByRole('button', { name: '听力题型库，v3 后有修改' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出本地函数库“听力题型库”' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除本地函数库“听力题型库”' })).toBeInTheDocument()
  })

  it('imports and deletes a specific imported function library release', async () => {
    const app = application()
    const release = {
      libraryId: '90000000-0000-4000-8000-000000000009',
      version: 4,
      contentHash: `sha256:${'9'.repeat(64)}`,
      content: { name: '共享函数库', functions: [] }
    }
    functionLibraryFileDialog.readText.mockResolvedValue({
      name: 'shared.lsfunclib',
      data: JSON.stringify(release)
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('button', { name: '导入函数库' }))

    await waitFor(() =>
      expect(app.functionLibraries.imported.register).toHaveBeenCalledWith(release)
    )
    expect(screen.getByRole('tab', { name: '导入函数库' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '共享函数库，版本 4' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '删除导入函数库“共享函数库”版本 4' }))
    const dialog = screen.getByRole('alertdialog', {
      name: '删除导入函数库“共享函数库”版本 4？'
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(app.functionLibraries.imported.delete).toHaveBeenCalledWith(release.libraryId, 4)
    )
    expect(screen.queryByRole('button', { name: '共享函数库，版本 4' })).not.toBeInTheDocument()
  })

  it('exports a local function library release from its row action', async () => {
    const app = application()
    functionLibraryFileDialog.writeText.mockResolvedValue(true)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    fireEvent.click(screen.getByRole('button', { name: '导出本地函数库“听力函数库”' }))

    await waitFor(() => expect(functionLibraryFileDialog.writeText).toHaveBeenCalledOnce())
    expect(functionLibraryFileDialog.writeText.mock.calls[0][1]).toMatchObject({
      defaultName: '听力函数库-v1.lsfunclib'
    })
    expect(app.functionLibraries.local.save).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        exportState: expect.objectContaining({ contentHash: expect.any(String) })
      })
    )
    expect(screen.getByRole('button', { name: '听力函数库，已导出 v1' })).toBeInTheDocument()
  })

  it('inserts an example library entry as a function call', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('标题页组合')
    expect(app.templates.insertFunctionCall).toHaveBeenCalledWith(
      TEMPLATE_ID,
      {
        library: { source: 'builtin', libraryId: 'builtin:examples' },
        functionId: 'builtin:example-title-page'
      },
      'root',
      undefined
    )
  })

  it('edits function call inputs and output names from the card and inspector', async () => {
    const document = template()
    const functionRef = `sha256:${'c'.repeat(64)}`
    document.resources.functions = [
      {
        id: functionRef,
        name: '参数示例',
        inputs: [
          { name: 'title', type: 'string' },
          { name: 'delay', type: 'number' },
          { name: 'asset', type: 'file' }
        ],
        body: { id: 'function-root', type: 'frame', children: [] },
        outputs: [
          {
            name: 'heading',
            type: 'string',
            expression: {
              type: 'string',
              source: 'variable',
              ref: { scope: 'local', name: 'title' }
            }
          },
          {
            name: 'delayResult',
            type: 'number',
            expression: {
              type: 'number',
              source: 'variable',
              ref: { scope: 'local', name: 'delay' }
            }
          },
          {
            name: 'assetResult',
            type: 'file',
            expression: {
              type: 'file',
              source: 'variable',
              ref: { scope: 'local', name: 'asset' }
            }
          }
        ],
        schemaUses: []
      }
    ]
    document.content.root.children = [
      {
        id: 'call',
        name: '参数示例',
        type: 'function',
        functionRef,
        inputs: {
          title: { type: 'string', source: 'literal', value: '旧标题' },
          delay: { type: 'number', source: 'literal', value: 3 },
          asset: { type: 'file', source: 'literal', value: '' }
        },
        outputNames: {
          heading: 'heading',
          delayResult: 'delay-result',
          assetResult: 'asset-result'
        }
      }
    ]
    const app = application(document)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '选择节点 call' }))
    const selectedCard = screen
      .getByRole('button', { name: '选择节点 call' })
      .closest('[data-selected]')
    if (!selectedCard) throw new Error('expected selected function card')

    expect(within(selectedCard).getByLabelText('节点 call 入参 title')).toHaveValue('旧标题')
    expect(within(selectedCard).getByLabelText('节点 call 入参 delay')).toHaveValue('3')
    expect(within(selectedCard).getByLabelText('节点 call 出参 heading')).toHaveValue('heading')

    const properties = screen.getByRole('complementary', { name: '属性' })
    fireEvent.change(within(properties).getByLabelText('函数 入参 title'), {
      target: { value: '新标题' }
    })
    fireEvent.change(within(properties).getByLabelText('函数 入参 delay'), {
      target: { value: '8' }
    })
    fireEvent.change(within(properties).getByLabelText('函数 入参 asset'), {
      target: { value: 'cover.png' }
    })
    fireEvent.change(within(properties).getByLabelText('函数 出参 heading'), {
      target: { value: 'page-heading' }
    })

    expect(within(selectedCard).getByLabelText('节点 call 入参 title')).toHaveValue('新标题')
    expect(within(selectedCard).getByLabelText('节点 call 入参 delay')).toHaveValue('8')
    expect(within(selectedCard).getByLabelText('节点 call 入参 asset')).toHaveValue('cover.png')
    expect(within(selectedCard).getByLabelText('节点 call 出参 heading')).toHaveValue(
      'page-heading'
    )

    fireEvent.click(screen.getByRole('button', { name: '折叠节点 call' }))
    expect(within(selectedCard).queryByLabelText('节点 call 入参 title')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开节点 call' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const call = saved.content.root.children[0]
    expect(call).toMatchObject({
      type: 'function',
      inputs: {
        title: {
          type: 'string',
          parts: [{ type: 'literal', value: '新标题' }]
        },
        delay: { type: 'number', source: 'literal', value: 8 },
        asset: { type: 'file', source: 'literal', value: 'cover.png' }
      },
      outputNames: {
        heading: 'page-heading',
        delayResult: 'delay-result',
        assetResult: 'asset-result'
      }
    })
  })

  it('creates a template and enters its editor route', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/templates']}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '新建模板' }))
    expect(await screen.findByRole('heading', { name: '全局属性' })).toBeInTheDocument()
    expect(app.templates.create).toHaveBeenCalledWith({ name: '未命名模板' })
  })

  it('saves the immutable edit and replaces the local revision', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const name = await screen.findByLabelText('名称')
    fireEvent.change(name, { target: { value: '更新后的模板' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    expect(app.templates.save).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 1,
        content: expect.objectContaining({ name: '更新后的模板' })
      })
    )
    expect(await screen.findByText('Revision 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('preserves edits made while saving and advances their revision baseline', async () => {
    const app = application()
    const pendingSave = deferred<TemplateDocument>()
    let savedSnapshot: TemplateDocument | null = null
    vi.mocked(app.templates.save)
      .mockImplementationOnce((value) => {
        savedSnapshot = value
        return pendingSave.promise
      })
      .mockImplementationOnce(async (value) => ({ ...value, revision: value.revision + 1 }))

    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const name = await screen.findByLabelText('名称')
    fireEvent.change(name, { target: { value: '第一次修改' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.change(name, { target: { value: '保存期间的新修改' } })

    expect(name).toHaveValue('保存期间的新修改')
    if (!savedSnapshot) throw new Error('save did not capture the document snapshot')
    await act(async () => {
      pendingSave.resolve({ ...savedSnapshot, revision: 2 })
      await pendingSave.promise
    })

    expect(name).toHaveValue('保存期间的新修改')
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledTimes(2))
    expect(app.templates.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 2,
        content: expect.objectContaining({ name: '保存期间的新修改' })
      })
    )
  })

  it('asks before leaving a template with unsaved edits', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates" element={<TemplateBrowserPage />} />
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.change(await screen.findByLabelText('名称'), {
      target: { value: '尚未保存的模板' }
    })
    fireEvent.click(screen.getByRole('button', { name: '返回模板' }))

    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('名称')).toHaveValue('尚未保存的模板')

    fireEvent.click(screen.getByRole('button', { name: '返回模板' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(await screen.findByRole('heading', { name: '试卷模板' })).toBeInTheDocument()
  })

  it('guards route navigation and window unload while template edits are unsaved', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <TemplateNavigationHarness />
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.change(await screen.findByLabelText('名称'), {
      target: { value: '由路由保护的修改' }
    })

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(beforeUnload)).toBe(false)
    expect(beforeUnload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '前往模板列表' }))
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('由路由保护的修改')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('由路由保护的修改')

    fireEvent.click(screen.getByRole('button', { name: '前往模板列表' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(await screen.findByRole('heading', { name: '试卷模板' })).toBeInTheDocument()
  })

  it('clears the previous document and page state when the route parameter changes', async () => {
    const app = application()
    const missing = deferred<TemplateDocument | null>()
    vi.mocked(app.templates.get).mockImplementation((templateId) =>
      templateId === TEMPLATE_ID ? Promise.resolve(template()) : missing.promise
    )

    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <TemplateRouteSwitcher />
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const name = await screen.findByLabelText('名称')
    fireEvent.change(name, { target: { value: '不应残留的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '打开缺失模板' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))

    await waitFor(() => expect(app.templates.get).toHaveBeenCalledWith(MISSING_TEMPLATE_ID))
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue(''))
    expect(screen.getByLabelText('名称')).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    await act(async () => {
      missing.resolve(null)
      await missing.promise
    })
    expect(screen.getByRole('alert')).toHaveTextContent('模板不存在。')

    fireEvent.click(screen.getByRole('button', { name: '打开现有模板' }))
    expect(await screen.findByDisplayValue('听力模板')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('edits nested node structure through immutable mutations', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('框架')
    expect(screen.getByRole('button', { name: '选择节点 frame' })).toBeInTheDocument()

    await clickLibraryFunction('页面')
    expect(screen.getByRole('button', { name: '选择节点 page' })).toBeInTheDocument()
    await clickLibraryFunction('选择题')
    expect(screen.getByRole('button', { name: '选择节点 question' })).toBeInTheDocument()
    expect(app.templates.insertFunctionCall).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '选择节点 page' }))
    fireEvent.click(screen.getByRole('button', { name: '复制节点' }))
    expect(screen.getByRole('button', { name: '选择节点 page-2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下移节点' }))
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }))
    expect(screen.getByRole('alertdialog', { name: '删除节点“page-2”？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    expect(saved.content.root.children.map((node) => node.id)).toEqual(['page-1', 'frame'])
    const frame = saved.content.root.children[1]
    expect(frame).toMatchObject({ id: 'frame', type: 'frame' })
    if (frame.type !== 'frame') throw new Error('expected inserted frame')
    expect(frame.children.map(({ id, type }) => ({ id, type }))).toEqual([
      { id: 'page', type: 'page' },
      { id: 'question', type: 'choice-question' }
    ])
  })

  it('tracks undo and redo against the last saved history entry', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('页面')
    expect(screen.getByRole('button', { name: '选择节点 page' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.queryByRole('button', { name: '选择节点 page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制节点' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('button', { name: '选择节点 page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制节点' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('Revision 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('reveals a new child when inserting into a collapsed frame', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('框架')
    await clickLibraryFunction('页面')
    fireEvent.click(screen.getByRole('button', { name: '选择节点 frame' }))
    fireEvent.click(screen.getByRole('button', { name: '折叠节点 frame' }))
    expect(screen.queryByRole('button', { name: '选择节点 page' })).not.toBeInTheDocument()

    await clickLibraryFunction('页面')
    expect(screen.getByRole('button', { name: '选择节点 page-2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '折叠节点 frame' }))

    expect(screen.queryByRole('button', { name: '选择节点 page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择节点 page-2' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开节点 frame' })).toBeInTheDocument()
  })

  it('collapses an expanded frame while one of its children is selected', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('框架')
    await clickLibraryFunction('页面')
    expect(screen.getByRole('button', { name: '选择节点 page' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠节点 frame' }))

    expect(screen.queryByRole('button', { name: '选择节点 page' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开节点 frame' })).toBeInTheDocument()
  })

  it('edits choice question text parts, options and output name', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('选择题')
    const selectedCard = screen
      .getByRole('button', { name: '选择节点 question' })
      .closest('[data-selected]')
    if (!selectedCard) throw new Error('expected selected node card')
    expect(within(selectedCard).getByText('选择题内容')).toBeInTheDocument()
    expect(within(selectedCard).getByLabelText('节点 question 输出名称')).toHaveValue('choice')
    expect(within(selectedCard).getByLabelText('节点 question 题干')).toHaveValue('')
    expect(within(selectedCard).getByLabelText('节点 question 选项 A 内容')).toHaveValue('')
    expect(within(selectedCard).getByLabelText('节点 question 选项 B 内容')).toHaveValue('')
    const properties = screen.getByRole('complementary', { name: '属性' })
    expect(within(properties).getByRole('heading', { name: '节点属性' })).toBeInTheDocument()
    fireEvent.change(within(selectedCard).getByLabelText('节点 question 输出名称'), {
      target: { value: 'answer-1' }
    })
    fireEvent.change(within(selectedCard).getByLabelText('节点 question 题干'), {
      target: { value: '请回答：' }
    })
    fireEvent.change(within(selectedCard).getByLabelText('节点 question 选项 A 内容'), {
      target: { value: '正确答案' }
    })
    fireEvent.change(within(selectedCard).getByLabelText('节点 question 选项 B 内容'), {
      target: { value: '干扰项' }
    })
    fireEvent.click(within(selectedCard).getByRole('button', { name: '节点 question 添加选项' }))
    fireEvent.change(within(selectedCard).getByLabelText('节点 question 选项 C 内容'), {
      target: { value: '第三项' }
    })
    fireEvent.click(within(selectedCard).getByRole('button', { name: '上移节点 question 选项 C' }))

    fireEvent.click(screen.getByRole('button', { name: '折叠节点 question' }))
    expect(within(selectedCard).queryByText('选择题内容')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开节点 question' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const question = saved.content.root.children[1]
    expect(question).toMatchObject({
      type: 'choice-question',
      outputName: 'answer-1',
      stem: {
        parts: [{ type: 'literal', value: '请回答：' }]
      }
    })
    if (question.type !== 'choice-question') throw new Error('expected choice question')
    expect(question.options.map((option) => option.content.parts[0])).toEqual([
      { type: 'literal', value: '正确答案' },
      { type: 'literal', value: '第三项' },
      { type: 'literal', value: '干扰项' }
    ])
  })

  it('configures collector pages against descendant questions', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    await clickLibraryFunction('选择题')
    await clickLibraryFunction('选择题')
    fireEvent.click(screen.getByRole('button', { name: '选择节点 root' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择题 Collector' }))

    expect(screen.getByText('2 / 2 题')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('第 1 页题目数'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '添加分页' }))
    expect(screen.getByText('2 / 2 题')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    expect(vi.mocked(app.templates.save).mock.calls[0][0].content.root.choiceCollector).toEqual({
      pages: [{ questionCount: 1 }, { questionCount: 1 }]
    })
  })

  it('counts choice questions propagated by embedded function calls', async () => {
    const document = template()
    const functionRef = `sha256:${'a'.repeat(64)}`
    document.content.root.children = [
      { id: 'single-question-call', type: 'function', functionRef, inputs: {}, outputNames: {} }
    ]
    document.resources.functions = [
      {
        id: functionRef,
        name: '单题',
        inputs: [],
        outputs: [],
        schemaUses: [],
        body: {
          id: 'function-root',
          type: 'frame',
          children: [
            {
              id: 'function-question',
              type: 'choice-question',
              stem: { type: 'string', parts: [{ type: 'literal', value: '题目' }] },
              options: [
                {
                  id: 'function-option-a',
                  content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] }
                },
                {
                  id: 'function-option-b',
                  content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] }
                }
              ],
              outputName: 'answer'
            }
          ]
        }
      }
    ]
    const app = application(document)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '选择节点 root' })
    fireEvent.click(screen.getByRole('checkbox', { name: '选择题 Collector' }))

    expect(screen.getByText('1 / 1 题')).toBeInTheDocument()
  })

  it('adds and edits a non-visual variable node without losing input focus', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    await screen.findByRole('button', { name: '添加变量' })
    fireEvent.click(screen.getByRole('button', { name: '添加变量' }))
    const nameInput = screen.getByLabelText('节点 variable 变量名称')
    nameInput.focus()
    fireEvent.change(nameInput, { target: { value: 'greeting' } })
    expect(nameInput).toHaveFocus()
    expect(nameInput).toHaveValue('greeting')

    fireEvent.change(screen.getByLabelText('节点 variable 类型'), { target: { value: 'number' } })
    fireEvent.change(screen.getByLabelText('节点 variable 值'), { target: { value: '12' } })
    expect(screen.getByLabelText('节点 variable 值')).toHaveValue('12')
    expect(screen.getByRole('tab', { name: '预览' })).toBeDisabled()
  })

  it('edits page timeline values, variables and record outputs', async () => {
    const document = template()
    document.content.interfaces = [
      { alias: 'exam', interfaceId: INTERFACE_ID, acceptedVars: ['prompt'] }
    ]
    const app = application(document)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '选择节点 page-1' }))
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '开场页面' } })
    expect(screen.getByText('开场页面')).toBeInTheDocument()
    const collapsePage = screen.getByRole('button', { name: '折叠节点 page-1' })
    expect(collapsePage).toBeEnabled()
    fireEvent.click(collapsePage)
    expect(
      screen.queryByRole('button', { name: '添加节点 page-1 时间线项目' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开节点 page-1' }))

    const addTimelineItem = screen.getByRole('button', {
      name: '添加节点 page-1 时间线项目'
    })
    fireEvent.click(addTimelineItem)
    expect(addTimelineItem).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '添加 TTS 播放' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加 倒计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加 录音' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加 TTS 播放' }))
    const insertedTimeline = screen.getByRole('list', { name: '节点 page-1 时间线' })
    expect(within(insertedTimeline).getAllByRole('listitem')).toHaveLength(1)
    const inlineTts = within(insertedTimeline).getByLabelText('节点 page-1 时间线项目 1 TTS 文本')
    fireEvent.change(inlineTts, { target: { value: '卡片内文本' } })
    expect(inlineTts).toHaveValue('卡片内文本')
    fireEvent.click(
      within(insertedTimeline).getByRole('button', {
        name: '删除节点 page-1 时间线项目 1'
      })
    )
    expect(screen.queryByRole('list', { name: '节点 page-1 时间线' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'TTS 播放' }))
    const ttsInput = screen.getByLabelText('TTS 文本')
    fireEvent.change(ttsInput, {
      target: { value: '请朗读：@pr', selectionStart: 7 }
    })
    fireEvent.keyDown(ttsInput, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: '倒计时' }))
    fireEvent.change(screen.getByLabelText('倒计时（秒）'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '录音' }))
    fireEvent.change(screen.getByLabelText('录音时长（秒）'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('输出名称'), { target: { value: 'response-audio' } })
    fireEvent.click(screen.getByRole('button', { name: '复制录音 3' }))

    const timelineSummary = screen.getByRole('list', { name: '节点 page-1 时间线' })
    expect(within(timelineSummary).getAllByRole('listitem')).toHaveLength(4)
    expect(within(timelineSummary).getByLabelText('节点 page-1 时间线项目 1 TTS 文本')).toHaveValue(
      '请朗读：[@exam.prompt]'
    )
    expect(
      within(timelineSummary).getByLabelText('节点 page-1 时间线项目 2 倒计时时长')
    ).toHaveValue('5')
    expect(within(timelineSummary).getByLabelText('节点 page-1 时间线项目 3 录音时长')).toHaveValue(
      '30'
    )
    expect(
      within(timelineSummary).getByLabelText('节点 page-1 时间线项目 3 录音输出名称')
    ).toHaveValue('response-audio')
    expect(within(timelineSummary).queryByText('倒计时')).not.toBeInTheDocument()
    expect(within(timelineSummary).queryByText('录音')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const page = saved.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    expect(page.name).toBe('开场页面')
    expect(page.timeline).toEqual([
      {
        type: 'play',
        text: {
          type: 'string',
          parts: [
            { type: 'literal', value: '请朗读：' },
            {
              type: 'variable',
              ref: { scope: 'interface', alias: 'exam', varName: 'prompt' }
            }
          ]
        }
      },
      { type: 'countdown', seconds: { type: 'number', source: 'literal', value: 5 } },
      {
        type: 'record',
        duration: { type: 'number', source: 'literal', value: 30 },
        outputName: 'response-audio'
      },
      {
        type: 'record',
        duration: { type: 'number', source: 'literal', value: 30 },
        outputName: 'response-audio-1'
      }
    ])
  })

  it('edits page content blocks on the graphical canvas', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '选择节点 page-1' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑节点 page-1 页面内容' }))
    expect(screen.getByRole('heading', { name: '页面' })).toBeInTheDocument()
    expect(screen.getByRole('application')).toHaveAccessibleName('页面 page-1 内容编辑器')

    fireEvent.click(screen.getByRole('button', { name: '添加内容块' }))
    fireEvent.click(screen.getByRole('button', { name: '添加文本' }))
    const properties = screen.getByRole('complementary', { name: '属性' })
    const textInput = within(properties).getByLabelText('内容块文本')
    fireEvent.change(textInput, { target: { value: '欢迎参加考试' } })

    const stage = screen.getByLabelText('页面 page-1')
    const textBlock = screen.getByRole('button', { name: '文本 text' })
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1200,
      height: 800
    } as DOMRect)
    vi.spyOn(textBlock, 'getBoundingClientRect').mockReturnValue({
      left: 120,
      top: 80,
      width: 480,
      height: 64
    } as DOMRect)
    fireEvent.pointerDown(textBlock, { button: 0, clientX: 120, clientY: 80 })
    fireEvent.pointerMove(window, { clientX: 240, clientY: 160 })
    fireEvent.pointerUp(window, { clientX: 240, clientY: 160 })
    expect(within(properties).getByLabelText('X')).toHaveValue(20)
    expect(within(properties).getByLabelText('Y')).toHaveValue(20)

    fireEvent.click(screen.getByRole('button', { name: '复制内容块' }))
    expect(screen.getByRole('button', { name: '文本 text-1' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除内容块' }))
    expect(screen.queryByRole('button', { name: '文本 text-1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '添加内容块' }))
    fireEvent.click(screen.getByRole('button', { name: '添加图片' }))
    fireEvent.click(screen.getByRole('button', { name: '添加内容块' }))
    fireEvent.click(screen.getByRole('button', { name: '添加选择题视图' }))
    expect(screen.getByText('3 个内容块')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '图片 image' }))
    expect(within(properties).getByLabelText('高度')).toHaveValue(40)
    fireEvent.change(within(properties).getByLabelText('高度'), { target: { value: '30' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const page = saved.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    expect(page.content.blocks).toHaveLength(3)
    expect(page.content.blocks[0]).toMatchObject({
      id: 'text',
      type: 'text',
      x: 20,
      y: 20,
      width: 40,
      text: { parts: [{ type: 'literal', value: '欢迎参加考试' }] }
    })
    expect(page.content.blocks.map((block) => block.type)).toEqual(['text', 'image', 'choice-view'])
    expect(page.content.blocks[1]).toMatchObject({ type: 'image', width: 40, height: 30 })
  })

  it('selects a focused choice target by page and question number', async () => {
    const document = template()
    const page = document.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    page.content.blocks = [
      {
        id: 'choices',
        type: 'choice-view',
        x: 10,
        y: 10,
        width: 80,
        height: 70,
        defaultViewport: {
          mode: 'focus',
          questionRef: { scope: 'absolute', callPath: [], questionId: 'question-2' }
        }
      }
    ]
    document.content.root.choiceCollector = {
      pages: [{ questionCount: 2 }, { questionCount: 1 }]
    }
    document.content.root.children.push(
      createChoiceQuestion('question-1'),
      createChoiceQuestion('question-2'),
      createChoiceQuestion('question-3')
    )
    const app = application(document)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '编辑节点 page-1 页面内容' }))
    fireEvent.click(screen.getByRole('button', { name: '选择题视图 choices' }))
    const properties = screen.getByRole('complementary', { name: '属性' })
    expect(within(properties).queryByText('调用路径')).not.toBeInTheDocument()
    expect(within(properties).queryByText('题目 ID')).not.toBeInTheDocument()
    expect(within(properties).getByLabelText('聚焦页面')).toHaveValue('0')
    expect(within(properties).getByLabelText('聚焦题目')).toHaveValue('1')

    fireEvent.change(within(properties).getByLabelText('聚焦页面'), {
      target: { value: '1' }
    })
    expect(within(properties).getByLabelText('聚焦题目')).toHaveValue('0')

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const savedPage = vi.mocked(app.templates.save).mock.calls[0][0].content.root.children[0]
    if (savedPage.type !== 'page') throw new Error('expected page')
    expect(savedPage.content.blocks[0]).toMatchObject({
      type: 'choice-view',
      defaultViewport: {
        mode: 'focus',
        questionRef: { scope: 'absolute', callPath: [], questionId: 'question-3' }
      }
    })
  })

  it('selects free and range page numbers from the collector pages', async () => {
    const document = template()
    const page = document.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    page.content.blocks = [
      {
        id: 'choices',
        type: 'choice-view',
        x: 10,
        y: 10,
        width: 80,
        height: 70,
        defaultViewport: { mode: 'free' }
      }
    ]
    document.content.root.choiceCollector = {
      pages: [{ questionCount: 1 }, { questionCount: 1 }]
    }
    document.content.root.children.push(
      createChoiceQuestion('question-1'),
      createChoiceQuestion('question-2')
    )
    const app = application(document)
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '编辑节点 page-1 页面内容' }))
    fireEvent.click(screen.getByRole('button', { name: '选择题视图 choices' }))
    const properties = screen.getByRole('complementary', { name: '属性' })
    const initialPage = within(properties).getByLabelText('初始页')
    expect(initialPage.tagName).toBe('SELECT')
    expect(
      within(initialPage)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['默认', '第 1 页', '第 2 页'])
    fireEvent.change(initialPage, { target: { value: '1' } })

    fireEvent.change(within(properties).getByLabelText('显示模式'), {
      target: { value: 'range' }
    })
    const startPage = within(properties).getByLabelText('起始页')
    const endPage = within(properties).getByLabelText('结束页')
    expect(startPage.tagName).toBe('SELECT')
    expect(endPage.tagName).toBe('SELECT')
    fireEvent.change(startPage, { target: { value: '1' } })
    expect(endPage).toHaveValue('1')

    const rangeInitialPage = within(properties).getByLabelText('初始页')
    expect(
      within(rangeInitialPage)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['默认', '第 2 页'])
    fireEvent.change(rangeInitialPage, { target: { value: '1' } })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const savedPage = vi.mocked(app.templates.save).mock.calls[0][0].content.root.children[0]
    if (savedPage.type !== 'page') throw new Error('expected page')
    expect(savedPage.content.blocks[0]).toMatchObject({
      type: 'choice-view',
      defaultViewport: { mode: 'range', startPage: 1, endPage: 1, initialPage: 1 }
    })
  })
})

function createChoiceQuestion(id: string): TemplateDocument['content']['root']['children'][number] {
  return {
    id,
    type: 'choice-question',
    stem: { type: 'string', parts: [{ type: 'literal', value: id }] },
    options: [
      { id: 'a', content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] } },
      { id: 'b', content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] } }
    ],
    outputName: `${id}-answer`
  }
}
