// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ReportExportBridge,
  ReportExportProgress,
  ReportExportResult,
  ReportExportSingleResult
} from '@ls101/core-types'
import type {
  SubmissionLibraryEntry,
  SubmissionLibraryRecord,
  SubmissionLibraryRepository,
  SubmissionSettlementBatch
} from '@ls101/submission-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'

afterEach(cleanup)

beforeEach(() => {
  delete window.reportExport
})

describe('批次报告导出', () => {
  it('把批次内每份作答渲染成 PDF 文档并交给主进程', async () => {
    const exportBatch = vi.fn().mockResolvedValue({
      status: 'exported',
      exportedCount: 2,
      failures: []
    } satisfies ReportExportResult)
    window.reportExport = bridgeWith(exportBatch)
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click(await screen.findByRole('button', { name: '导出批次报告' }))

    await waitFor(() => expect(exportBatch).toHaveBeenCalledOnce())
    const request = exportBatch.mock.calls[0][0] as {
      items: Array<{ filename: string; html: string }>
    }
    expect(request.items.map((entry) => entry.filename)).toEqual([
      '张三-candidate-1-报告.pdf',
      '李四-candidate-2-报告.pdf'
    ])
    expect(request.items[0].html).toContain('张三')
    expect(request.items[0].html).toContain('data:image/png;base64,iVBORw==')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '导出批次报告' })).toBeEnabled()
  })

  it('导出过程中显示进度', async () => {
    let emitProgress: ((progress: ReportExportProgress) => void) | null = null
    let finish: ((result: ReportExportResult) => void) | null = null
    const exportBatch = vi.fn(
      () =>
        new Promise<ReportExportResult>((resolve) => {
          finish = resolve
        })
    )
    window.reportExport = bridgeWith(exportBatch, undefined, (listener) => {
      emitProgress = listener
      return () => {
        emitProgress = null
      }
    })
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click(await screen.findByRole('button', { name: '导出批次报告' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '正在生成报告' })).toBeDisabled())
    act(() => {
      emitProgress?.({
        phase: 'printing',
        completed: 1,
        total: 2,
        current: '李四-candidate-2-报告.pdf'
      })
    })
    expect(screen.getByText('1/2 · 李四-candidate-2-报告.pdf')).toBeInTheDocument()

    await act(async () => {
      finish?.({ status: 'exported', exportedCount: 2, failures: [] })
    })
    expect(await screen.findByRole('button', { name: '导出批次报告' })).toBeEnabled()
  })

  it('单份失败时列出失败原因', async () => {
    window.reportExport = bridgeWith(
      vi.fn().mockResolvedValue({
        status: 'exported',
        exportedCount: 1,
        failures: [{ filename: '李四-candidate-2-报告.pdf', reason: '报告打印超时' }]
      } satisfies ReportExportResult)
    )
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click(await screen.findByRole('button', { name: '导出批次报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '李四-candidate-2-报告.pdf（报告打印超时）'
    )
  })

  it('桥不可用时给出明确提示', async () => {
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click(await screen.findByRole('button', { name: '导出批次报告' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('报告导出不可用')
  })
})

describe('单份报告导出', () => {
  it('把单份作答渲染成 PDF 文档并直接交给主进程', async () => {
    const exportSingle = vi
      .fn()
      .mockResolvedValue({ status: 'exported' } satisfies ReportExportSingleResult)
    window.reportExport = bridgeWith(vi.fn(), exportSingle)
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: '导出报告' }))[0])

    await waitFor(() => expect(exportSingle).toHaveBeenCalledOnce())
    expect(exportSingle).toHaveBeenCalledWith({
      filename: '张三-candidate-1-报告.pdf',
      html: expect.stringContaining('张三')
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('导出失败时显示原因', async () => {
    window.reportExport = bridgeWith(
      vi.fn(),
      vi.fn().mockResolvedValue({
        status: 'failed',
        reason: '报告打印超时'
      } satisfies ReportExportSingleResult)
    )
    const repository = mockRepository()

    renderPage(repository)
    fireEvent.click(await screen.findByRole('button', { name: /结算于/ }))
    fireEvent.click((await screen.findAllByRole('button', { name: '导出报告' }))[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('报告导出失败：报告打印超时')
  })
})

function bridgeWith(
  exportBatch: ReportExportBridge['exportBatch'],
  exportSingle: ReportExportBridge['exportSingle'] = vi.fn(),
  onProgress: ReportExportBridge['onProgress'] = () => () => undefined
): ReportExportBridge {
  return { exportBatch, exportSingle, onProgress }
}

function renderPage(repository: SubmissionLibraryRepository) {
  return render(
    <SubmissionLibraryProvider repository={repository}>
      <MemoryRouter initialEntries={['/submissions?view=settled']}>
        <Routes>
          <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
        </Routes>
      </MemoryRouter>
    </SubmissionLibraryProvider>
  )
}

const BATCH: SubmissionSettlementBatch = {
  formatVersion: 1,
  batchId: 'batch-1',
  settledAt: '2026-08-11T02:00:00Z',
  records: [
    { submissionId: 'submission-1', totalScore: 8, maxScore: 10 },
    { submissionId: 'submission-2', totalScore: 9, maxScore: 10 }
  ]
}

function mockRepository(): SubmissionLibraryRepository {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    listEntries: vi
      .fn()
      .mockResolvedValue([
        entry(record('submission-1', 'candidate-1', '张三')),
        entry(record('submission-2', 'candidate-2', '李四'))
      ]),
    getRecord: vi.fn().mockResolvedValue(null),
    importArchive: vi.fn(),
    exportArchive: vi.fn(),
    deleteSubmission: vi.fn(),
    resetGrading: vi.fn(),
    listSettlementBatches: vi.fn().mockResolvedValue([BATCH]),
    settleSubmissions: vi.fn(),
    startGrading: vi.fn(),
    submitGradingResult: vi.fn(),
    saveAIGradingRun: vi.fn(),
    getGradingRecord: vi.fn().mockResolvedValue(null),
    getReport: vi.fn().mockImplementation(async (submissionId: string) => ({
      markdown: `# ${submissionId === 'submission-1' ? '张三' : '李四'} — 期末考试\n\n![题目](resource:img-1)\n`,
      resources: {
        'img-1': {
          resourceKey: 'img-1',
          filename: 'question.png',
          kind: 'static' as const,
          mediaType: 'image/png',
          data: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
        }
      }
    }))
  }
}

function record(
  submissionId: string,
  candidateId: string,
  candidateName: string
): SubmissionLibraryRecord {
  return {
    formatVersion: 1,
    submissionId,
    examPackageId: 'exam-1',
    examTitle: '期末考试',
    candidateId,
    candidateName,
    startedAt: '2026-08-10T01:00:00Z',
    submittedAt: '2026-08-10T02:00:00Z',
    importedAt: '2026-08-10T02:01:00Z',
    archiveSha256: '1'.repeat(64),
    archiveBytes: 100,
    schemaUseCount: 1
  }
}

function entry(value: SubmissionLibraryRecord): SubmissionLibraryEntry {
  return {
    record: value,
    grading: { status: 'ready', gradedCount: 1, totalCount: 1, totalScore: 8, maxScore: 10 },
    settlement: { batchId: BATCH.batchId, settledAt: BATCH.settledAt }
  }
}
