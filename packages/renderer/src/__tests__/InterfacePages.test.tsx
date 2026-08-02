// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceApplication, InterfaceDraft } from '@ls101/interface-editor'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppToaster } from '../components/ui/ToastViewport'
import { toast } from '../components/ui/toast'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
import { InterfaceDetailsPage } from '../features/interfaces/InterfaceDetailsPage'
import { InterfaceDraftEditorPage } from '../features/interfaces/InterfaceDraftEditorPage'
import { InterfaceDraftListPage } from '../features/interfaces/InterfaceDraftListPage'
import { InterfaceListPage } from '../features/interfaces/InterfaceListPage'

afterEach(() => {
  toast.dismiss()
  cleanup()
})

const draft: InterfaceDraft = {
  draftId: '10000000-0000-4000-8000-000000000001',
  name: '听说测试',
  description: '用于课堂练习',
  promptTemplate: '生成一套听说练习',
  fields: {
    order: ['question'],
    nodes: {
      question: {
        type: 'text',
        varName: 'questionText',
        description: '题干',
        example: 'What did the speaker say?'
      }
    }
  }
}

function application(overrides: Record<string, unknown> = {}): InterfaceApplication {
  return {
    browser: {
      listDrafts: vi.fn().mockResolvedValue([]),
      listPublished: vi.fn().mockResolvedValue([])
    },
    drafts: {
      create: vi.fn().mockResolvedValue(draft),
      get: vi.fn().mockResolvedValue(draft),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn()
    },
    published: {},
    instances: {},
    transfer: {},
    ...overrides
  } as unknown as InterfaceApplication
}

describe('Interface pages', () => {
  it('shows published interfaces and the draft entry', async () => {
    const app = application({
      browser: {
        listDrafts: vi.fn().mockResolvedValue([]),
        listPublished: vi.fn().mockResolvedValue([
          {
            interfaceId: `sha256:${'a'.repeat(64)}`,
            name: '上海高考听说',
            description: '高考听说模拟题型',
            source: { type: 'published' },
            instanceCount: 3
          }
        ])
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces']}>
          <InterfaceListPage />
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(screen.getByRole('heading', { name: '题型' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '草稿' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    expect(screen.getByText('3 个题组')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '进入' })).toBeInTheDocument()
    expect(screen.queryByText('正式')).not.toBeInTheDocument()
  })

  it('creates a real draft and enters the focus editor route', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces/drafts']}>
          <Routes>
            <Route path="/interfaces/drafts" element={<InterfaceDraftListPage />} />
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    await waitFor(() => expect(screen.queryByText('正在加载草稿...')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    expect(app.drafts.create).toHaveBeenCalledOnce()
    expect(app.drafts.get).toHaveBeenCalledWith(draft.draftId)
    expect(screen.getByRole('region', { name: '字段结构' })).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('uses a toast for draft save completion', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/drafts/${draft.draftId}`]}>
          <Routes>
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '听说测试更新' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(app.drafts.save).toHaveBeenCalledOnce())
    expect(await screen.findByText('草稿已保存')).toBeInTheDocument()
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
  })

  it('copies each prompt artifact from interface details', async () => {
    const interfaceId = `sha256:${'a'.repeat(64)}`
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        }),
        listInstances: vi.fn().mockResolvedValue([]),
        getPrompts: vi.fn().mockResolvedValue({
          prompt: '单独提示词',
          formatInstructions: '格式说明',
          fullPrompt: '完整提示词',
          jsonSchema: '{"type":"object"}',
          jsonExample: '{"question":"example"}'
        })
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}`]}>
          <Routes>
            <Route path="/interfaces/:interfaceId" element={<InterfaceDetailsPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByText('题型定义')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制完整提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制单独提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Schema' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Example' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制 JSON Schema' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"type":"object"}'))
    expect(await screen.findByText('已复制JSON Schema')).toBeInTheDocument()
  })
})
