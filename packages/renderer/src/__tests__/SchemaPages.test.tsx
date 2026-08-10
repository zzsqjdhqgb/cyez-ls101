// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SchemaDefinition,
  SchemaDraftLibraryDocument,
  SchemaRepository
} from '@ls101/schema-editor'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppToaster } from '../components/ui/ToastViewport'
import { toast } from '../components/ui/toast'
import { SchemaApplicationProvider } from '../features/schemas/SchemaApplicationProvider'
import { SchemaBrowserPage } from '../features/schemas/SchemaBrowserPage'
import { SchemaDefinitionPage } from '../features/schemas/SchemaDefinitionPage'
import { SchemaDraftEditorPage } from '../features/schemas/SchemaDraftEditorPage'
import { SchemaDraftLibraryPage } from '../features/schemas/SchemaDraftLibraryPage'

const LIBRARY_ID = '10000000-0000-4000-8000-000000000001'
const DRAFT_ID = '20000000-0000-4000-8000-000000000001'
const SCHEMA_ID = '30000000-0000-4000-8000-000000000001'

const library: SchemaDraftLibraryDocument = {
  libraryId: LIBRARY_ID,
  revision: 2,
  name: '口语评分结构',
  drafts: [
    {
      draftId: DRAFT_ID,
      revision: 1,
      name: '单句朗读',
      structure: {
        questionType: 'fixed-reading',
        answerFormat: [{ answerId: 'recording', type: 'fixed-speech' }],
        templateInputs: [
          { inputId: 'question-description', type: 'text', required: true },
          { inputId: 'reference-text', type: 'text', required: true }
        ]
      }
    }
  ]
}

const definition: SchemaDefinition = {
  formatVersion: 2,
  schemaId: SCHEMA_ID,
  sourceDraftId: DRAFT_ID,
  structureHash: `sha256:${'a'.repeat(64)}`,
  revision: 3,
  structure: library.drafts[0].structure,
  data: {
    name: '单句朗读评分',
    description: '用于单句朗读练习',
    maxScore: 10,
    answerDescriptions: { recording: '学生朗读录音' },
    inputDescriptions: { 'reference-text': '朗读原文' },
    rubricMarkdown: '按准确度和流利度评分。',
    extraPromptMarkdown: ''
  }
}

function repository(overrides: Partial<SchemaRepository> = {}): SchemaRepository {
  return {
    listDraftLibraryIds: vi.fn().mockResolvedValue([]),
    getDraftLibrary: vi.fn().mockResolvedValue(null),
    saveDraftLibrary: vi.fn(async (item: SchemaDraftLibraryDocument) => ({
      ...item,
      revision: item.revision + 1
    })),
    deleteDraftLibrary: vi.fn().mockResolvedValue(undefined),
    listSchemaIds: vi.fn().mockResolvedValue([]),
    getSchema: vi.fn().mockResolvedValue(null),
    publishDraft: vi.fn().mockResolvedValue(definition),
    updateSchemaData: vi.fn().mockResolvedValue(definition),
    deleteSchema: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

afterEach(() => {
  toast.dismiss()
  cleanup()
})

describe('Schema pages', () => {
  it('lists formal schemas and draft libraries and creates a library', async () => {
    const saveDraftLibrary = vi.fn(async (item: SchemaDraftLibraryDocument) => item)
    const app = repository({
      listSchemaIds: vi.fn().mockResolvedValue([SCHEMA_ID]),
      getSchema: vi.fn().mockResolvedValue(definition),
      listDraftLibraryIds: vi.fn().mockResolvedValue([LIBRARY_ID]),
      getDraftLibrary: vi.fn().mockResolvedValue(library),
      saveDraftLibrary
    })

    render(
      <SchemaApplicationProvider repository={app}>
        <MemoryRouter initialEntries={['/schemas']}>
          <Routes>
            <Route path="/schemas" element={<SchemaBrowserPage />} />
            <Route path="/schemas/drafts/:libraryId" element={<SchemaDraftLibraryPage />} />
          </Routes>
        </MemoryRouter>
      </SchemaApplicationProvider>
    )

    expect(await screen.findByRole('button', { name: '单句朗读评分' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '口语评分结构' })).toBeInTheDocument()
    expect(screen.getByText(/固定朗读 · 满分 10/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '新建草稿库' }))
    await waitFor(() => expect(saveDraftLibrary).toHaveBeenCalledOnce())
    expect(saveDraftLibrary.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: '未命名草稿库', drafts: [] })
    )
  })

  it('edits and saves a structure draft with stable slots', async () => {
    const saveDraftLibrary = vi.fn(async (item: SchemaDraftLibraryDocument) => ({
      ...item,
      revision: item.revision + 1
    }))
    const app = repository({
      getDraftLibrary: vi.fn().mockResolvedValue(library),
      saveDraftLibrary
    })

    render(
      <SchemaApplicationProvider repository={app}>
        <MemoryRouter initialEntries={[`/schemas/drafts/${LIBRARY_ID}/${DRAFT_ID}`]}>
          <Routes>
            <Route path="/schemas/drafts/:libraryId/:draftId" element={<SchemaDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </SchemaApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '单句朗读' })).toBeInTheDocument()
    expect(screen.getByLabelText('recording 子槽位')).toHaveTextContent('文本录音')
    fireEvent.change(screen.getByLabelText('答案槽位 1 ID'), { target: { value: 'speech' } })
    fireEvent.change(screen.getByLabelText('输入 reference-text ID'), {
      target: { value: 'analysis' }
    })
    fireEvent.click(screen.getByRole('button', { name: '添加输入' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(saveDraftLibrary).toHaveBeenCalledOnce())
    const saved = saveDraftLibrary.mock.calls[0][0]
    expect(saved.drafts[0].structure.answerFormat[0].answerId).toBe('speech')
    expect(saved.drafts[0].structure.templateInputs[1].inputId).toBe('analysis')
    expect(saved.drafts[0].structure.templateInputs.at(-1)?.inputId).toBe('input1')
    expect(await screen.findByText('结构草稿已保存')).toBeInTheDocument()
  })

  it('publishes a saved structure with complete formal data', async () => {
    const publishDraft = vi.fn().mockResolvedValue(definition)
    const app = repository({ getDraftLibrary: vi.fn().mockResolvedValue(library), publishDraft })

    render(
      <SchemaApplicationProvider repository={app}>
        <MemoryRouter initialEntries={[`/schemas/drafts/${LIBRARY_ID}/${DRAFT_ID}`]}>
          <Routes>
            <Route path="/schemas/drafts/:libraryId/:draftId" element={<SchemaDraftEditorPage />} />
            <Route path="/schemas/:schemaId" element={<SchemaDefinitionPage />} />
          </Routes>
        </MemoryRouter>
      </SchemaApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '单句朗读' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '发布正式版' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('描述'), { target: { value: '单句朗读评分' } })
    fireEvent.change(screen.getByLabelText('recording'), { target: { value: '学生录音' } })
    expect(screen.getByText('题目描述')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('reference-text · 必填'), {
      target: { value: '朗读原文' }
    })
    fireEvent.change(screen.getByLabelText('评分标准（Markdown）'), {
      target: { value: '按准确度评分。' }
    })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))

    await waitFor(() => expect(publishDraft).toHaveBeenCalledOnce())
    expect(publishDraft).toHaveBeenCalledWith(
      LIBRARY_ID,
      DRAFT_ID,
      expect.objectContaining({ description: '单句朗读评分', maxScore: 10 })
    )
  })

  it('keeps formal structure read-only and updates only formal data', async () => {
    const updateSchemaData = vi
      .fn()
      .mockImplementation(
        async (_schemaId: string, _revision: number, data: SchemaDefinition['data']) => ({
          ...definition,
          revision: 4,
          data
        })
      )
    const app = repository({ getSchema: vi.fn().mockResolvedValue(definition), updateSchemaData })

    render(
      <SchemaApplicationProvider repository={app}>
        <MemoryRouter initialEntries={[`/schemas/${SCHEMA_ID}`]}>
          <Routes>
            <Route path="/schemas/:schemaId" element={<SchemaDefinitionPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </SchemaApplicationProvider>
    )

    expect(await screen.findByRole('complementary', { name: '冻结结构' })).toBeInTheDocument()
    expect(screen.getByText(SCHEMA_ID)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('满分'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(updateSchemaData).toHaveBeenCalledOnce())
    expect(updateSchemaData).toHaveBeenCalledWith(
      SCHEMA_ID,
      3,
      expect.objectContaining({ maxScore: 15 })
    )
    expect(await screen.findByText('正式 Schema 已保存')).toBeInTheDocument()
  })
})
