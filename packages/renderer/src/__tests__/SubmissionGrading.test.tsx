// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  GradingInput,
  SubmissionGradingWorkspace,
  SubmissionLibraryEntry,
  SubmissionLibraryRepository
} from '@ls101/submission-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubmissionGradingPage } from '../features/submissions/SubmissionGradingPage'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'

afterEach(cleanup)

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:grading-audio')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

describe('submission grading UI', () => {
  it('submits a decimal human score with an empty comment and finishes the submission', async () => {
    const workspace = gradingWorkspace()
    const submitGradingResult = vi.fn().mockResolvedValue({
      ...workspace,
      grading: {
        ...workspace.grading,
        status: 'completed',
        totalScore: 3.75,
        items: [
          {
            instanceId: 'reading-1',
            engine: 'human',
            result: { score: 3.75, comment: '' },
            gradedAt: '2026-08-10T03:00:00Z'
          }
        ],
        completedAt: '2026-08-10T03:00:00Z'
      }
    })
    const repository = mockRepository({
      startGrading: vi.fn().mockResolvedValue(workspace),
      submitGradingResult
    })

    renderWithRepository(repository, '/submissions/submission-1/grade', [
      <Route
        element={<SubmissionGradingPage />}
        key="grade"
        path="/submissions/:submissionId/grade"
      />,
      <Route element={<h1>收卷页</h1>} key="list" path="/submissions" />
    ])

    expect(await screen.findByText('请朗读句子。')).toBeInTheDocument()
    expect(screen.getByText('按准确度评分。')).toBeInTheDocument()
    expect(screen.getByText('Read this sentence.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('分数'), { target: { value: '3.75' } })
    fireEvent.click(screen.getByRole('button', { name: '提交本题' }))

    await waitFor(() =>
      expect(submitGradingResult).toHaveBeenCalledWith('submission-1', 'reading-1', 'human', {
        score: 3.75,
        comment: ''
      })
    )
    expect(await screen.findByRole('heading', { name: '收卷页' })).toBeInTheDocument()
  })

  it('separates completed submissions and opens their Markdown report without a delete action', async () => {
    const pending = libraryEntry('pending', null)
    const completed = libraryEntry('completed', {
      status: 'completed',
      gradedCount: 1,
      totalCount: 1,
      totalScore: 5,
      maxScore: 5,
      completedAt: '2026-08-10T03:00:00Z'
    })
    const repository = mockRepository({
      listEntries: vi.fn().mockResolvedValue([pending, completed]),
      getReport: vi.fn().mockResolvedValue({
        markdown: '# Student completed - Test\n\n| 总分 |\n| --- |\n| 5/5 |',
        resources: {}
      })
    })

    renderWithRepository(repository, '/submissions', [
      <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
    ])

    expect(await screen.findByRole('heading', { name: '未批改' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已批改' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始批改' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '删除作答包' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '查看报告' }))
    expect(await screen.findByRole('heading', { name: '考试报告' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Student completed - Test' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '5/5' })).toBeInTheDocument()
  })
})

function renderWithRepository(
  repository: SubmissionLibraryRepository,
  initialEntry: string,
  routes: React.ReactElement[]
) {
  return render(
    <SubmissionLibraryProvider repository={repository}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </SubmissionLibraryProvider>
  )
}

function mockRepository(
  overrides: Partial<SubmissionLibraryRepository>
): SubmissionLibraryRepository {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    listEntries: vi.fn().mockResolvedValue([]),
    getRecord: vi.fn().mockResolvedValue(null),
    importArchive: vi.fn(),
    exportArchive: vi.fn(),
    deleteSubmission: vi.fn(),
    startGrading: vi.fn(),
    submitGradingResult: vi.fn(),
    getGradingRecord: vi.fn().mockResolvedValue(null),
    getReport: vi.fn(),
    ...overrides
  }
}

function gradingWorkspace(): SubmissionGradingWorkspace {
  const input = gradingInput()
  return {
    submission: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: input.submission,
      answers: {
        strings: [],
        audios: [{ resourceKey: 'audio-1', durationMs: 1200 }]
      },
      schemaUses: [],
      resources: {}
    },
    grading: {
      formatVersion: 1,
      submissionId: 'submission-1',
      status: 'grading',
      items: [],
      totalScore: 0,
      maxScore: 5
    },
    inputs: [input]
  }
}

function gradingInput(): GradingInput {
  return {
    submission: {
      submissionId: 'submission-1',
      examPackageId: 'exam-1',
      examTitle: 'Test',
      candidate: { candidateId: '001', displayName: 'Student' },
      startedAt: '2026-08-10T01:00:00Z',
      submittedAt: '2026-08-10T02:00:00Z'
    },
    instanceId: 'reading-1',
    schema: {
      formatVersion: 2,
      schemaId: '10000000-0000-4000-8000-000000000001',
      sourceDraftId: '20000000-0000-4000-8000-000000000001',
      structureHash: `sha256:${'1'.repeat(64)}`,
      revision: 0,
      structure: {
        questionType: 'fixed-reading',
        answerFormat: [{ answerId: 'answer', type: 'fixed-speech' }],
        templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
      },
      data: {
        name: '朗读题',
        description: '朗读评分',
        maxScore: 5,
        answerDescriptions: { answer: '学生录音' },
        inputDescriptions: {},
        rubricMarkdown: '按准确度评分。'
      }
    },
    inputs: [{ inputId: 'question-description', type: 'text', value: '请朗读句子。' }],
    answers: [
      {
        answerId: 'answer',
        description: '学生录音',
        type: 'fixed-speech',
        text: 'Read this sentence.',
        audio: {
          resourceKey: 'audio-1',
          filename: 'audio.wav',
          mediaType: 'audio/wav',
          kind: 'recording',
          durationMs: 1200,
          data: new Uint8Array([1, 2, 3])
        }
      }
    ],
    resources: {}
  }
}

function libraryEntry(
  id: string,
  grading: SubmissionLibraryEntry['grading']
): SubmissionLibraryEntry {
  return {
    record: {
      formatVersion: 1,
      submissionId: id,
      examPackageId: 'exam-1',
      examTitle: 'Test',
      candidateId: id,
      candidateName: `Student ${id}`,
      startedAt: '2026-08-10T01:00:00Z',
      submittedAt: '2026-08-10T02:00:00Z',
      importedAt: '2026-08-10T02:01:00Z',
      archiveSha256: '1'.repeat(64),
      archiveBytes: 100,
      schemaUseCount: 1
    },
    grading
  }
}
