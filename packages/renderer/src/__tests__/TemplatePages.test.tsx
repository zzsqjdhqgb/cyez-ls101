// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import { TemplateBrowserPage } from '../features/templates/TemplateBrowserPage'
import { TemplateDocumentPage } from '../features/templates/TemplateDocumentPage'

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'
const FUNCTION_ID = '20000000-0000-4000-8000-000000000002'

afterEach(cleanup)

function template(revision = 1): TemplateDocument {
  return {
    templateId: TEMPLATE_ID,
    revision,
    content: {
      name: '听力模板',
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
})
