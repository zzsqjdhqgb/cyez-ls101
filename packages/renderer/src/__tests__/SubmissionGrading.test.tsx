// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  GradingInput,
  SubmissionGradingWorkspace,
  SubmissionLibraryEntry,
  SubmissionLibraryRepository,
  SubmissionReport
} from '@ls101/submission-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubmissionGradingPage } from '../features/submissions/SubmissionGradingPage'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'
import { SubmissionSettlementPage } from '../features/submissions/SubmissionSettlementPage'

afterEach(cleanup)

beforeEach(() => {
  let nextUrl = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:grading-audio-${++nextUrl}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

describe('submission grading UI', () => {
  it('keeps the current recording URL alive across StrictMode effect checks', async () => {
    const repository = mockRepository({
      startGrading: vi.fn().mockResolvedValue(gradingWorkspace())
    })

    const rendered = render(
      <StrictMode>
        <SubmissionLibraryProvider repository={repository}>
          <MemoryRouter initialEntries={['/submissions/submission-1/grade']}>
            <Routes>
              <Route element={<SubmissionGradingPage />} path="/submissions/:submissionId/grade" />
            </Routes>
          </MemoryRouter>
        </SubmissionLibraryProvider>
      </StrictMode>
    )

    const player = await waitFor(() => {
      const element = rendered.container.querySelector('audio')
      expect(element).not.toBeNull()
      return element as HTMLAudioElement
    })
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2))
    const currentUrl = player.getAttribute('src')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:grading-audio-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(currentUrl)
    expect(currentUrl).toBe('blob:grading-audio-2')

    fireEvent.error(player)
    expect(screen.getByRole('alert')).toHaveTextContent('录音无法播放')
  })

  it('submits a decimal human score with an empty comment and enters settlement', async () => {
    const workspace = gradingWorkspace()
    const submitGradingResult = vi.fn().mockResolvedValue({
      ...workspace,
      grading: {
        ...workspace.grading,
        status: 'ready',
        totalScore: 3.75,
        items: [
          {
            instanceId: 'reading-1',
            engine: 'human',
            result: { score: 3.75, comment: '' },
            gradedAt: '2026-08-10T03:00:00Z'
          }
        ],
        readyAt: '2026-08-10T03:00:00Z'
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
      <Route element={<h1>结算页</h1>} key="settlement" path="/submissions/settlement" />
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
    expect(await screen.findByRole('heading', { name: '结算页' })).toBeInTheDocument()
  })

  it('separates unsettled submissions and settled batches and opens their report', async () => {
    const pending = libraryEntry('pending', null)
    const completed = libraryEntry('completed', completedSummary(), true)
    const repository = mockRepository({
      listEntries: vi.fn().mockResolvedValue([pending, completed]),
      listSettlementBatches: vi.fn().mockResolvedValue([settlementBatch(['completed'])]),
      getReport: vi.fn().mockResolvedValue({
        markdown: '# Student completed - Test\n\n| 总分 |\n| --- |\n| 5/5 |',
        resources: {}
      })
    })

    renderWithRepository(repository, '/submissions?view=settled&batchId=batch-1', [
      <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
    ])

    expect(await screen.findByRole('tab', { name: /已结算/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('button', { name: '重新评分' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除作答记录' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看报告' }))
    expect(await screen.findByRole('heading', { name: '评分报告' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Student completed - Test' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '5/5' })).toBeInTheDocument()
  })

  it('ignores a stale report response after switching submissions', async () => {
    const first = deferred<SubmissionReport>()
    const second = deferred<SubmissionReport>()
    const repository = mockRepository({
      listEntries: vi
        .fn()
        .mockResolvedValue([
          libraryEntry('first', completedSummary(), true),
          libraryEntry('second', completedSummary(), true)
        ]),
      listSettlementBatches: vi.fn().mockResolvedValue([settlementBatch(['first', 'second'])]),
      getReport: vi.fn((submissionId: string) =>
        submissionId === 'first' ? first.promise : second.promise
      )
    })

    renderWithRepository(repository, '/submissions?view=settled&batchId=batch-1', [
      <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
    ])

    const buttons = await screen.findAllByRole('button', { name: '查看报告' })
    fireEvent.click(buttons[0])
    fireEvent.click(screen.getByRole('button', { name: '关闭报告' }))
    fireEvent.click(buttons[1])

    await act(async () => {
      second.resolve({ markdown: '# Second report', resources: {} })
      await second.promise
    })
    expect(await screen.findByRole('heading', { name: 'Second report' })).toBeInTheDocument()

    await act(async () => {
      first.resolve({ markdown: '# First report', resources: {} })
      await first.promise
    })
    expect(screen.getByRole('heading', { name: 'Second report' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'First report' })).not.toBeInTheDocument()
  })

  it('settles only ready submissions and returns to the expanded batch', async () => {
    const ready = libraryEntry('ready', completedSummary())
    const pending = libraryEntry('pending', null)
    const settleSubmissions = vi.fn().mockResolvedValue(settlementBatch(['ready']))
    const repository = mockRepository({
      listEntries: vi.fn().mockResolvedValue([ready, pending]),
      settleSubmissions
    })

    renderWithRepository(
      repository,
      '/submissions/settlement?submissionId=ready&submissionId=pending',
      [
        <Route
          element={<SubmissionSettlementPage />}
          key="settlement"
          path="/submissions/settlement"
        />,
        <Route element={<h1>已结算列表</h1>} key="list" path="/submissions" />
      ]
    )

    expect(await screen.findByRole('heading', { name: '评分结算' })).toBeInTheDocument()
    expect(screen.getAllByText('可结算', { exact: true })).toHaveLength(2)
    expect(screen.getByText('未评分', { exact: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本次结算（1）' }))

    await waitFor(() => expect(settleSubmissions).toHaveBeenCalledWith(['ready']))
    expect(await screen.findByRole('heading', { name: '已结算列表' })).toBeInTheDocument()
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
    resetGrading: vi.fn(),
    listSettlementBatches: vi.fn().mockResolvedValue([]),
    settleSubmissions: vi.fn(),
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
  grading: SubmissionLibraryEntry['grading'],
  settled = false
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
    grading,
    settlement: settled ? { batchId: 'batch-1', settledAt: '2026-08-10T04:00:00Z' } : null
  }
}

function completedSummary(): NonNullable<SubmissionLibraryEntry['grading']> {
  return {
    status: 'ready',
    gradedCount: 1,
    totalCount: 1,
    totalScore: 5,
    maxScore: 5,
    readyAt: '2026-08-10T03:00:00Z'
  }
}

function settlementBatch(submissionIds: string[]) {
  return {
    formatVersion: 1 as const,
    batchId: 'batch-1',
    settledAt: '2026-08-10T04:00:00Z',
    records: submissionIds.map((submissionId) => ({ submissionId, totalScore: 5, maxScore: 5 }))
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}
