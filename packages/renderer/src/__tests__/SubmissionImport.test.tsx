// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  SubmissionLibraryError,
  type SubmissionImportResult,
  type SubmissionLibraryEntry,
  type SubmissionLibraryRecord,
  type SubmissionLibraryRepository
} from '@ls101/submission-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'

const dialogMocks = vi.hoisted(() => ({
  readBinary: vi.fn(),
  writeBinary: vi.fn()
}))

vi.mock('@ls101/file-dialog/renderer', () => ({ fileDialog: dialogMocks }))

afterEach(cleanup)

beforeEach(() => {
  dialogMocks.readBinary.mockReset()
  dialogMocks.writeBinary.mockReset()
})

describe('作答库导入', () => {
  it('导入批量压缩包后刷新列表', async () => {
    const second = record('submission-2', 'Second student')
    const listEntries = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([entry(second)])
    const importArchive = vi.fn().mockResolvedValue({
      kind: 'bundle',
      items: [
        {
          bundleEntry: 'first.lssubmission',
          status: 'created',
          record: record('submission-1', 'First student')
        },
        { bundleEntry: 'second.lssubmission', status: 'created', record: second }
      ]
    } satisfies SubmissionImportResult)
    const repository = mockRepository({ listEntries, importArchive })
    dialogMocks.readBinary.mockResolvedValue({
      name: 'submissions.zip',
      data: new Uint8Array([1, 2, 3])
    })

    renderPage(repository)
    expect(await screen.findByText('没有未结算作答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入作答包' }))

    await waitFor(() => expect(importArchive).toHaveBeenCalledWith(new Uint8Array([1, 2, 3])))
    expect(await screen.findByText('Second student')).toBeInTheDocument()
    expect(listEntries).toHaveBeenCalledTimes(2)
  })

  it('批量压缩包被拒绝时显示原因并刷新列表', async () => {
    const listEntries = vi.fn().mockResolvedValue([])
    const importArchive = vi
      .fn()
      .mockRejectedValue(
        new SubmissionLibraryError('INVALID_ARCHIVE', 'Archive contains a directory')
      )
    const repository = mockRepository({ listEntries, importArchive })
    dialogMocks.readBinary.mockResolvedValue({
      name: 'submissions.zip',
      data: new Uint8Array([4, 5, 6])
    })

    renderPage(repository)
    expect(await screen.findByText('没有未结算作答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入作答包' }))

    expect(
      await screen.findByText('无法导入作答包：Archive contains a directory')
    ).toBeInTheDocument()
    await waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2))
  })

  it('重复导入单个作答包时提示已存在', async () => {
    const existing = record('submission-1', 'First student')
    const importArchive = vi.fn().mockResolvedValue({
      kind: 'package',
      items: [{ bundleEntry: null, status: 'duplicate', record: existing }]
    } satisfies SubmissionImportResult)
    const repository = mockRepository({ importArchive })
    dialogMocks.readBinary.mockResolvedValue({
      name: 'first.lssubmission',
      data: new Uint8Array([7, 8, 9])
    })

    renderPage(repository)
    expect(await screen.findByText('没有未结算作答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入作答包' }))

    await waitFor(() => expect(importArchive).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

function renderPage(repository: SubmissionLibraryRepository) {
  return render(
    <SubmissionLibraryProvider repository={repository}>
      <MemoryRouter initialEntries={['/submissions']}>
        <Routes>
          <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
        </Routes>
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
    saveAIGradingRun: vi.fn(),
    getGradingRecord: vi.fn().mockResolvedValue(null),
    getReport: vi.fn(),
    ...overrides
  }
}

function record(submissionId: string, candidateName: string): SubmissionLibraryRecord {
  return {
    formatVersion: 1,
    submissionId,
    examPackageId: 'exam-1',
    examTitle: 'Test',
    candidateId: submissionId,
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
  return { record: value, grading: null, settlement: null }
}
