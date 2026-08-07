// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import type { JSX } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import { TemplateBrowserPage } from '../features/templates/TemplateBrowserPage'
import { TemplateDocumentPage } from '../features/templates/TemplateDocumentPage'

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'
const FUNCTION_ID = '20000000-0000-4000-8000-000000000002'
const MISSING_TEMPLATE_ID = '30000000-0000-4000-8000-000000000003'

afterEach(cleanup)

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
            }
          ]
        },
        {
          source: 'builtin',
          libraryId: 'builtin:examples',
          version: 2,
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
      ])
    },
    templates: {
      create: vi.fn().mockResolvedValue(document),
      get: vi.fn().mockResolvedValue(document),
      save: vi.fn().mockImplementation(async (value: TemplateDocument) => {
        storedDocument = { ...value, revision: value.revision + 1 }
        return storedDocument
      }),
      delete: vi.fn(),
      embedFunction: vi.fn(),
      insertFunctionCall: vi.fn(),
      pruneFunctionResources: vi.fn(),
      validate: vi.fn(),
      compile: vi.fn()
    },
    functionLibraries: {
      local: {}
    }
  } as unknown as TemplateApplication
  return app
}

function createLibraryNode(
  functionId: string
): TemplateDocument['content']['root']['children'][number] {
  if (functionId === 'builtin:frame') return { id: 'frame', type: 'frame', children: [] }
  if (functionId === 'builtin:page') {
    return { id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }
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

    expect(await screen.findByRole('button', { name: '听力模板' })).toBeInTheDocument()
    expect(screen.getByText('听力函数库')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: '示例组件库，版本 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加标题页组合' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加选择题组合' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '导入函数库' }))
    expect(screen.getByRole('button', { name: '导入题型库，版本 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加口语题' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加框架' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '本地函数库' }))
    expect(screen.getByRole('button', { name: '听力函数库' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加单题函数' })).toBeInTheDocument()
    expect(screen.getByText('page-1')).toBeInTheDocument()
    expect(app.templates.get).toHaveBeenCalledWith(TEMPLATE_ID)
    expect(app.browser.listFunctionLibraries).toHaveBeenCalledTimes(2)
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

    expect(screen.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByLabelText('名称')).toHaveValue('尚未保存的模板')

    fireEvent.click(screen.getByRole('button', { name: '返回模板' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(await screen.findByRole('heading', { name: '模板' })).toBeInTheDocument()
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
    expect(screen.getByRole('dialog', { name: '删除节点“page-2”？' })).toBeInTheDocument()
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
    expect(within(selectedCard).queryByLabelText('输出名称')).not.toBeInTheDocument()
    const properties = screen.getByRole('complementary', { name: '属性' })
    expect(within(properties).getByRole('heading', { name: '节点属性' })).toBeInTheDocument()
    fireEvent.change(within(properties).getByLabelText('输出名称'), {
      target: { value: 'answer-1' }
    })
    fireEvent.change(screen.getByLabelText('题干文本 1'), {
      target: { value: '请回答：' }
    })
    fireEvent.click(screen.getByRole('button', { name: '题干添加变量' }))
    fireEvent.change(screen.getByLabelText('题干变量 2名称'), {
      target: { value: 'question-text' }
    })
    fireEvent.change(screen.getByLabelText('选项 A 内容文本 1'), {
      target: { value: '正确答案' }
    })
    fireEvent.change(screen.getByLabelText('选项 B 内容文本 1'), {
      target: { value: '干扰项' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加选项' }))
    fireEvent.change(screen.getByLabelText('选项 C 内容文本 1'), {
      target: { value: '第三项' }
    })
    fireEvent.click(screen.getByRole('button', { name: '上移选项 C' }))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const question = saved.content.root.children[1]
    expect(question).toMatchObject({
      type: 'choice-question',
      outputName: 'answer-1',
      stem: {
        parts: [
          { type: 'literal', value: '请回答：' },
          { type: 'variable', ref: { scope: 'local', name: 'question-text' } }
        ]
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

  it('edits page timeline values, variables and record outputs', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'TTS 播放' }))
    fireEvent.change(screen.getByLabelText('TTS 文本文本 1'), {
      target: { value: '请朗读：' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'TTS 文本添加变量' }))
    fireEvent.change(screen.getByLabelText('TTS 文本变量 2名称'), {
      target: { value: 'prompt-text' }
    })
    fireEvent.click(screen.getByRole('button', { name: '倒计时' }))
    fireEvent.change(screen.getByLabelText('倒计时（秒）'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '录音' }))
    fireEvent.change(screen.getByLabelText('录音时长（秒）'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('输出名称'), { target: { value: 'response-audio' } })
    fireEvent.click(screen.getByRole('button', { name: '复制录音 3' }))

    const timelineSummary = screen.getByRole('list', { name: '节点 page-1 时间线' })
    expect(within(timelineSummary).getAllByRole('listitem')).toHaveLength(4)
    expect(within(timelineSummary).getByText('TTS 播放')).toBeInTheDocument()
    expect(within(timelineSummary).getByText('倒计时')).toBeInTheDocument()
    expect(within(timelineSummary).getAllByText('录音')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(app.templates.save).toHaveBeenCalledOnce())
    const saved = vi.mocked(app.templates.save).mock.calls[0][0]
    const page = saved.content.root.children[0]
    if (page.type !== 'page') throw new Error('expected page')
    expect(page.timeline).toEqual([
      {
        type: 'play',
        text: {
          type: 'string',
          parts: [
            { type: 'literal', value: '请朗读：' },
            { type: 'variable', ref: { scope: 'local', name: 'prompt-text' } }
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
})
