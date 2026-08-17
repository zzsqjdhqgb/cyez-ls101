// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  FunctionContent,
  LocalFunctionLibraryDocument,
  TemplateApplication,
  TemplateDocument
} from '@ls101/template-editor'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import { TemplateDocumentPage } from '../features/templates/TemplateDocumentPage'
import { TemplateFunctionDocumentPage } from '../features/templates/TemplateFunctionDocumentPage'

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'
const LIBRARY_ID = '20000000-0000-4000-8000-000000000002'
const FUNCTION_ID = '30000000-0000-4000-8000-000000000003'
const IMPORTED_LIBRARY_ID = '40000000-0000-4000-8000-000000000004'
const IMPORTED_FUNCTION_ID = '50000000-0000-4000-8000-000000000005'

afterEach(cleanup)

describe('Template function pages', () => {
  it('opens an editor only from a local function card', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}`]}>
          <Routes>
            <Route path="/templates/:templateId" element={<TemplateDocumentPage />} />
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('tab', { name: '本地函数库' }))
    expect(screen.getByRole('button', { name: '编辑本地函数' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '导入函数库' }))
    expect(screen.queryByRole('button', { name: '编辑导入函数' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    fireEvent.change(screen.getByRole('textbox', { name: '名称', exact: true }), {
      target: { value: '进入函数前保存' }
    })
    fireEvent.click(screen.getByRole('button', { name: '编辑本地函数' }))

    expect(await screen.findByRole('heading', { name: '本地函数' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回模板编辑' })).toBeInTheDocument()
    expect(app.templates.save).toHaveBeenCalledOnce()
    expect(app.functionLibraries.local.get).toHaveBeenCalledWith(LIBRARY_ID)
  })

  it('edits function metadata, signature and body with undo, redo and save', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const properties = await screen.findByRole('complementary', { name: '函数' })
    fireEvent.change(within(properties).getByLabelText('函数名称'), {
      target: { value: '更新后的函数' }
    })
    fireEvent.click(within(properties).getByRole('button', { name: '添加输入' }))
    const inputName = within(properties).getByLabelText('输入 1 名称')
    expect(inputName).toHaveValue('input')
    inputName.focus()
    fireEvent.change(inputName, { target: { value: 'input-name' } })
    expect(within(properties).getByLabelText('输入 1 名称')).toBe(inputName)
    expect(inputName).toHaveFocus()

    fireEvent.click(within(properties).getByRole('button', { name: '添加输出' }))
    const outputName = within(properties).getByLabelText('输出 1 名称')
    outputName.focus()
    fireEvent.change(outputName, { target: { value: 'output-name' } })
    expect(within(properties).getByLabelText('输出 1 名称')).toBe(outputName)
    expect(outputName).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '添加页面' }))
    expect(await screen.findByRole('button', { name: '选择节点 page' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.queryByRole('button', { name: '选择节点 page' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    expect(screen.getByRole('button', { name: '选择节点 page' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.functionLibraries.local.saveFunction).toHaveBeenCalledOnce())
    const [librarySnapshot, functionDocument] = vi.mocked(app.functionLibraries.local.saveFunction)
      .mock.calls[0]
    expect(librarySnapshot.revision).toBe(4)
    expect(functionDocument.content.name).toBe('更新后的函数')
    expect(functionDocument.content.inputs).toEqual([{ name: 'input-name', type: 'string' }])
    expect(functionDocument.content.outputs).toEqual([
      {
        name: 'output-name',
        type: 'string',
        expression: { type: 'string', parts: [{ type: 'literal', value: '' }] }
      }
    ])
    expect(functionDocument.content.body.children[0]).toMatchObject({ id: 'page', type: 'page' })
    expect(screen.getByText(/Revision 4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('edits choice-group page counts as a constant number list', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    const properties = await screen.findByRole('complementary', { name: '函数' })
    fireEvent.click(within(properties).getByRole('button', { name: '添加输入' }))
    fireEvent.change(within(properties).getByLabelText('输入 1 类型'), {
      target: { value: 'choice-group' }
    })
    fireEvent.change(within(properties).getByLabelText('输入 1 题组形状'), {
      target: { value: 'range' }
    })

    const firstPage = within(properties).getByLabelText('输入 1 第 1 页题数')
    expect(firstPage).toHaveAttribute('type', 'number')
    expect(firstPage).toHaveValue(1)
    expect(within(properties).getByRole('button', { name: '输入 1 删除第 1 页' })).toBeDisabled()
    fireEvent.change(firstPage, { target: { value: '2' } })

    fireEvent.click(within(properties).getByRole('button', { name: '输入 1 添加页面' }))
    fireEvent.change(within(properties).getByLabelText('输入 1 第 2 页题数'), {
      target: { value: '3' }
    })
    fireEvent.click(within(properties).getByRole('button', { name: '输入 1 添加页面' }))
    fireEvent.change(within(properties).getByLabelText('输入 1 第 3 页题数'), {
      target: { value: '4' }
    })
    fireEvent.click(within(properties).getByRole('button', { name: '输入 1 删除第 2 页' }))

    expect(within(properties).getByLabelText('输入 1 第 1 页题数')).toHaveValue(2)
    expect(within(properties).getByLabelText('输入 1 第 2 页题数')).toHaveValue(4)
    expect(within(properties).queryByLabelText('输入 1 第 3 页题数')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.functionLibraries.local.saveFunction).toHaveBeenCalledOnce())
    const functionDocument = vi.mocked(app.functionLibraries.local.saveFunction).mock.calls[0][1]
    expect(functionDocument.content.inputs).toEqual([
      {
        name: 'input',
        type: 'choice-group',
        shape: { kind: 'range', pageCounts: [2, 4] }
      }
    ])
  })

  it('uses the template editor function library layout and filters the current function', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '函数库' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '调整函数库宽度' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '内置函数库' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '基础组件库' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加页面' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '基础组件库' }))
    expect(screen.queryByRole('button', { name: '添加页面' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    expect(screen.getByRole('button', { name: '本地函数库' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '调用本地函数' })).not.toBeInTheDocument()
    expect(screen.getByText('暂无可用函数')).toBeInTheDocument()
  })

  it('previews the selected function subtree with temporary input values', async () => {
    const app = application()
    vi.mocked(app.functionLibraries.local.get).mockResolvedValueOnce(previewLibrary())
    vi.mocked(app.functionLibraries.local.preview).mockResolvedValue({
      success: true,
      preview: {
        title: '预览函数',
        pages: [
          {
            id: 'page:function-preview-call:preview-page',
            sourceNodeId: 'preview-page',
            sourceNodeName: '预览页',
            callPath: ['function-preview-call'],
            content: [],
            timeline: [{ type: 'countdown', seconds: 3 }]
          }
        ],
        recordingIndices: [],
        resources: {}
      },
      resourceSources: []
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('tab', { name: '预览' }))
    expect(await screen.findByRole('complementary', { name: '预览序列' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '函数库' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '函数预览配置' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '预览画面 1，倒计时' })).toBeInTheDocument()
    expect(app.functionLibraries.local.preview).toHaveBeenCalledWith(
      LIBRARY_ID,
      expect.objectContaining({ functionId: FUNCTION_ID }),
      { title: { type: 'string', source: 'literal', value: '' } }
    )

    fireEvent.change(screen.getByLabelText('预览输入 title'), {
      target: { value: '临时标题' }
    })
    await waitFor(() =>
      expect(app.functionLibraries.local.preview).toHaveBeenLastCalledWith(
        LIBRARY_ID,
        expect.objectContaining({ functionId: FUNCTION_ID }),
        { title: { type: 'string', source: 'literal', value: '临时标题' } }
      )
    )
  })

  it('shows a non-editable error state for a missing local function', async () => {
    const app = application()
    vi.mocked(app.functionLibraries.local.get).mockResolvedValueOnce({
      ...localLibrary(),
      content: { name: '本地函数库', functions: [] }
    })
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('本地函数不存在。')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('copies and calls a function selected from an imported library', async () => {
    const app = application()
    render(
      <TemplateApplicationProvider application={app}>
        <MemoryRouter
          initialEntries={[`/templates/libraries/${LIBRARY_ID}/functions/${FUNCTION_ID}`]}
        >
          <Routes>
            <Route
              path="/templates/libraries/:libraryId/functions/:functionId"
              element={<TemplateFunctionDocumentPage />}
            />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    )

    fireEvent.click(await screen.findByRole('tab', { name: '导入函数库' }))
    fireEvent.click(screen.getByRole('button', { name: '调用导入函数' }))
    await waitFor(() =>
      expect(app.functionLibraries.local.insertFunctionCall).toHaveBeenCalledWith(
        LIBRARY_ID,
        FUNCTION_ID,
        {
          library: { source: 'imported', libraryId: IMPORTED_LIBRARY_ID, version: 1 },
          functionId: IMPORTED_FUNCTION_ID
        },
        'root',
        undefined
      )
    )
    expect(
      await screen.findByRole('button', { name: '选择节点 function-call' })
    ).toBeInTheDocument()
  })
})

function application(): TemplateApplication {
  let storedLibrary = localLibrary()
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    browser: {
      listTemplates: vi.fn().mockResolvedValue([]),
      listFunctionLibraries: vi.fn().mockResolvedValue([
        {
          source: 'builtin',
          libraryId: 'builtin:basic',
          name: '基础组件库',
          functions: [
            {
              functionId: 'builtin:page',
              name: '页面',
              component: { id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }
            }
          ]
        },
        {
          source: 'imported',
          libraryId: IMPORTED_LIBRARY_ID,
          version: 1,
          name: '导入函数库',
          functions: [{ functionId: IMPORTED_FUNCTION_ID, name: '导入函数' }]
        },
        {
          source: 'local',
          libraryId: LIBRARY_ID,
          name: '本地函数库',
          functions: [{ functionId: FUNCTION_ID, name: '本地函数' }]
        }
      ]),
      listInterfaces: vi.fn().mockResolvedValue([]),
      listInterfaceInstances: vi.fn().mockResolvedValue([])
    },
    templates: {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(template()),
      save: vi.fn().mockImplementation(async (document) => ({
        ...document,
        revision: document.revision + 1
      })),
      delete: vi.fn(),
      embedFunction: vi.fn(),
      insertFunctionCall: vi.fn(),
      pruneFunctionResources: vi.fn(),
      validate: vi.fn(),
      compile: vi.fn(),
      preview: vi.fn()
    },
    functionLibraries: {
      imported: { register: vi.fn(), delete: vi.fn() },
      local: {
        create: vi.fn(),
        get: vi.fn().mockImplementation(async () => structuredClone(storedLibrary)),
        save: vi.fn(),
        delete: vi.fn(),
        createFunction: vi.fn(),
        getFunction: vi.fn(),
        saveFunction: vi.fn().mockImplementation(async (library, document) => {
          storedLibrary = {
            ...library,
            storageRevision: library.storageRevision + 1,
            content: {
              ...library.content,
              functions: library.content.functions.map((entry) =>
                entry.functionId === document.functionId
                  ? { functionId: entry.functionId, content: structuredClone(document.content) }
                  : entry
              )
            },
            editorState: {
              ...library.editorState,
              functions: {
                ...library.editorState.functions,
                [document.functionId]: structuredClone(document.editorState)
              }
            }
          }
          return structuredClone(storedLibrary)
        }),
        preview: vi.fn(),
        insertFunctionCall: vi.fn().mockImplementation(async () => {
          const source = storedLibrary.content.functions.find(
            (entry) => entry.functionId === FUNCTION_ID
          )
          if (!source) throw new Error('Function missing')
          const copiedFunctionId = '60000000-0000-4000-8000-000000000006'
          const content: FunctionContent = {
            name: '导入函数',
            inputs: [],
            body: { id: 'root', type: 'frame', children: [] },
            outputs: [],
            schemaUses: []
          }
          const functionContent: FunctionContent = {
            ...source.content,
            body: {
              ...source.content.body,
              children: [
                ...source.content.body.children,
                {
                  id: 'function-call',
                  type: 'function',
                  functionRef: copiedFunctionId,
                  inputs: {},
                  outputNames: {}
                }
              ]
            }
          }
          storedLibrary = {
            ...storedLibrary,
            revision: storedLibrary.revision + 1,
            content: {
              ...storedLibrary.content,
              functions: [
                { ...source, content: functionContent },
                { functionId: copiedFunctionId, content, exposed: false }
              ]
            },
            editorState: {
              ...storedLibrary.editorState,
              functions: {
                ...storedLibrary.editorState.functions,
                [copiedFunctionId]: {}
              }
            }
          }
          return {
            library: structuredClone(storedLibrary),
            function: { functionId: FUNCTION_ID, content: functionContent, editorState: {} },
            callNodeId: 'function-call'
          }
        }),
        deleteFunction: vi.fn()
      }
    }
  }
}

function template(): TemplateDocument {
  return {
    templateId: TEMPLATE_ID,
    revision: 1,
    content: {
      name: '模板',
      description: '',
      interfaces: [],
      root: { id: 'root', type: 'frame', children: [] },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function localLibrary(): LocalFunctionLibraryDocument {
  const content: FunctionContent = {
    name: '本地函数',
    inputs: [],
    body: { id: 'root', type: 'frame', children: [] },
    outputs: [],
    schemaUses: []
  }
  return {
    libraryId: LIBRARY_ID,
    revision: 4,
    storageRevision: 4,
    content: { name: '本地函数库', functions: [{ functionId: FUNCTION_ID, content }] },
    editorState: { library: {}, functions: { [FUNCTION_ID]: {} } }
  }
}

function previewLibrary(): LocalFunctionLibraryDocument {
  const library = localLibrary()
  const entry = library.content.functions[0]
  return {
    ...library,
    content: {
      ...library.content,
      functions: [
        {
          ...entry,
          content: {
            ...entry.content,
            name: '预览函数',
            inputs: [{ name: 'title', type: 'string' }],
            body: {
              id: 'root',
              type: 'frame',
              children: [
                {
                  id: 'preview-page',
                  name: '预览页',
                  type: 'page',
                  content: { blocks: [] },
                  timeline: [
                    {
                      type: 'countdown',
                      seconds: { type: 'number', source: 'literal', value: 3 }
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  }
}
