// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import type { ExamLibraryRepository } from '@ls101/exam-library'
import type { ExamPackage, TaskProgressHandle, TaskProgressSnapshot } from '@ls101/core-types'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ExamLibraryProvider } from '../features/exams/ExamLibraryProvider'
import { TemplateApplicationProvider } from '../features/templates/TemplateApplicationProvider'
import type { ExamGenerationResult } from '../features/templates/TemplateExamGeneration'
import {
  createExamGenerationSession,
  exportGeneratedExam,
  listSpeechGenerationSelections
} from '../features/templates/TemplateExamGeneration'
import {
  BuiltinTemplateExamGenerationPage,
  TemplateExamGenerationPage
} from '../features/templates/TemplateExamGenerationPage'

vi.mock('../features/templates/TemplateExamGeneration', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../features/templates/TemplateExamGeneration')>()
  return {
    ...original,
    createExamGenerationSession: vi.fn(),
    exportGeneratedExam: vi.fn(),
    listSpeechGenerationSelections: vi.fn()
  }
})

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.mocked(listSpeechGenerationSelections).mockResolvedValue([
    {
      providerConfigId: 'provider-a',
      providerName: '语音服务 A',
      modelId: 'model-a',
      voiceId: 'voice-a'
    },
    {
      providerConfigId: 'provider-b',
      providerName: '语音服务 B',
      modelId: 'model-b',
      voiceId: 'voice-b'
    }
  ])
  vi.mocked(exportGeneratedExam).mockResolvedValue(true)
  vi.mocked(createExamGenerationSession).mockReturnValue({
    start: () => completedHandle(),
    dispose: vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TemplateExamGenerationPage', () => {
  it('为三种音色分别选择提供商、模型和音色', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: '语音设置' })).toBeInTheDocument()
    for (const role of ['默认音色', '男声音色', '女声音色']) {
      expect(screen.getByLabelText(`${role}提供商`)).toHaveValue('provider-a')
      expect(screen.getByLabelText(`${role}模型`)).toHaveValue('model-a')
      expect(screen.getByLabelText(`${role}音色`)).toHaveValue('voice-a')
    }
    expect(screen.queryByText(/Interface/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('男声音色提供商'), {
      target: { value: 'provider-b' }
    })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() =>
      expect(createExamGenerationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          speech: {
            default: {
              providerConfigId: 'provider-a',
              modelId: 'model-a',
              voiceId: 'voice-a'
            },
            man: {
              providerConfigId: 'provider-b',
              modelId: 'model-b',
              voiceId: 'voice-b'
            },
            woman: {
              providerConfigId: 'provider-a',
              modelId: 'model-a',
              voiceId: 'voice-a'
            }
          }
        })
      )
    )
  })

  it('生成完成后停留在结果页，加入试卷库后防止重复操作', async () => {
    const repository = examRepository()
    renderPage(repository)

    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    expect(await screen.findByText('试卷生成完成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入试卷库' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导出文件' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '加入试卷库' }))
    await waitFor(() => expect(repository.importArchive).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '已加入试卷库' })).toBeDisabled()
    expect(screen.getByText('试卷生成完成')).toBeInTheDocument()
  })

  it('尚未保存生成结果时关闭需要确认', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    await screen.findByText('试卷生成完成')

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(await screen.findByRole('heading', { name: '放弃尚未保存的试卷？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃结果并离开' })).toBeInTheDocument()
  })

  it('从内置路由加载 release 并创建 builtin 生成会话', async () => {
    const app = {
      ...application(),
      builtinTemplates: {
        get: vi.fn().mockResolvedValue({
          templateId: TEMPLATE_ID,
          version: 1,
          releaseHash: `sha256:${'a'.repeat(64)}`,
          document: {
            content: template().content,
            resources: template().resources,
            editorState: template().editorState
          }
        })
      }
    } as TemplateApplication
    render(
      <ExamLibraryProvider repository={examRepository()}>
        <TemplateApplicationProvider application={app}>
          <MemoryRouter initialEntries={[`/templates/builtin/${TEMPLATE_ID}/generate`]}>
            <Routes>
              <Route
                path="/templates/builtin/:templateId/generate"
                element={<BuiltinTemplateExamGenerationPage />}
              />
              <Route path="/templates" element={<h1>试卷模板</h1>} />
            </Routes>
          </MemoryRouter>
        </TemplateApplicationProvider>
      </ExamLibraryProvider>
    )

    fireEvent.click(await screen.findByRole('button', { name: '开始生成' }))
    await waitFor(() =>
      expect(createExamGenerationSession).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'builtin',
          document: expect.objectContaining({ revision: 0 })
        })
      )
    )
  })
})

function renderPage(repository = examRepository()): void {
  render(
    <ExamLibraryProvider repository={repository}>
      <TemplateApplicationProvider application={application()}>
        <MemoryRouter initialEntries={[`/templates/${TEMPLATE_ID}/generate`]}>
          <Routes>
            <Route
              path="/templates/:templateId/generate"
              element={<TemplateExamGenerationPage />}
            />
            <Route path="/templates/:templateId" element={<h1>模板编辑器</h1>} />
          </Routes>
        </MemoryRouter>
      </TemplateApplicationProvider>
    </ExamLibraryProvider>
  )
}

function application(): TemplateApplication {
  return {
    browser: {
      listInterfaces: vi.fn().mockResolvedValue([]),
      listInterfaceInstances: vi.fn().mockResolvedValue([])
    },
    templates: {
      get: vi.fn().mockResolvedValue(template())
    }
  } as unknown as TemplateApplication
}

function examRepository(): ExamLibraryRepository {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    getRecord: vi.fn().mockResolvedValue(null),
    importArchive: vi.fn().mockResolvedValue({
      status: 'created',
      record: {
        formatVersion: 1,
        packageId: 'exam-1',
        title: '生成试卷',
        importedAt: '2026-08-14T00:00:00.000Z',
        archiveSha256: 'a'.repeat(64),
        archiveBytes: 3,
        pageCount: 1,
        timelineStepCount: 1,
        resourceCount: 0
      }
    }),
    exportArchive: vi.fn(),
    deleteExam: vi.fn()
  }
}

function completedHandle(): TaskProgressHandle<ExamGenerationResult> {
  const snapshot: TaskProgressSnapshot = {
    items: [
      { id: 'prepare', label: '准备试卷内容', status: 'completed' },
      { id: 'speech', label: '合成语音 1：请听题', status: 'completed' },
      { id: 'resources', label: '整理试卷资源', status: 'completed' },
      { id: 'package', label: '打包试卷', status: 'completed' }
    ]
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    cancel: vi.fn(),
    completion: Promise.resolve({
      status: 'completed',
      archive: new Uint8Array([1, 2, 3]),
      examPackage: exam()
    })
  }
}

function template(): TemplateDocument {
  return {
    templateId: TEMPLATE_ID,
    revision: 2,
    content: {
      name: '听力模板',
      description: '',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [
          {
            id: 'page',
            type: 'page',
            content: { blocks: [] },
            timeline: [
              {
                type: 'play',
                text: { type: 'string', parts: [{ type: 'literal', value: '请听题' }] }
              }
            ]
          }
        ]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function exam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-1',
    examData: {
      title: '听力模板',
      player: {
        pages: [{ id: 'page', content: [], timeline: [{ type: 'countdown', seconds: 1 }] }],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-1', examTitle: '听力模板' },
      schemaUses: [],
      resources: {}
    }
  }
}
