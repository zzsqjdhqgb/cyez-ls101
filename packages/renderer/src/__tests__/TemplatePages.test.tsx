// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function template(
  revision = 1,
  templateId = TEMPLATE_ID,
  name = '听力模板'
): TemplateDocument {
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

function application(): TemplateApplication {
  const document = template()
  return {
    browser: {
      listTemplates: vi.fn().mockResolvedValue([
        {
          templateId: TEMPLATE_ID,
          name: document.content.name,
          description: document.content.description
        }
      ]),
      listFunctions: vi.fn().mockResolvedValue([{ functionId: FUNCTION_ID, name: '单题函数' }])
    },
    templates: {
      create: vi.fn().mockResolvedValue(document),
      get: vi.fn().mockResolvedValue(document),
      save: vi.fn().mockImplementation(async (value: TemplateDocument) => ({
        ...value,
        revision: value.revision + 1
      })),
      delete: vi.fn(),
      embedFunction: vi.fn(),
      insertFunctionCall: vi.fn(),
      pruneFunctionResources: vi.fn(),
      validate: vi.fn(),
      compile: vi.fn()
    },
    functions: {
      create: vi.fn(),
      get: vi.fn(),
      save: vi.fn(),
      delete: vi.fn()
    }
  } as unknown as TemplateApplication
}

describe('Template pages', () => {
  it('lists templates and functions and opens a template', async () => {
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
    expect(screen.getByText('单题函数')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '听力模板' }))

    expect(await screen.findByRole('heading', { name: '结构' })).toBeInTheDocument()
    expect(screen.getByText('page-1')).toBeInTheDocument()
    expect(app.templates.get).toHaveBeenCalledWith(TEMPLATE_ID)
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
    expect(await screen.findByRole('heading', { name: '属性' })).toBeInTheDocument()
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
    expect(screen.getByText('Revision 2')).toBeInTheDocument()
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
})
