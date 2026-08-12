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
    expect(within(properties).getByLabelText('输入 1 名称')).toHaveValue('input')

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
    expect(functionDocument.content.inputs).toEqual([{ name: 'input', type: 'string' }])
    expect(functionDocument.content.body.children[0]).toMatchObject({ id: 'page', type: 'page' })
    expect(screen.getByText(/Revision 4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
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

    fireEvent.click(await screen.findByRole('button', { name: '调用导入函数' }))
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
