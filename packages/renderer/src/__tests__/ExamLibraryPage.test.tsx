import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ExamImportResult,
  ExamLibraryRecord,
  ExamLibraryRepository
} from '@ls101/exam-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ExamLibraryPage } from '../features/exams/ExamLibraryPage'
import { ExamLibraryProvider } from '../features/exams/ExamLibraryProvider'

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

describe('ExamLibraryPage', () => {
  it('导入试卷包并刷新列表', async () => {
    const repository = mockRepository()
    vi.mocked(repository.listRecords).mockResolvedValueOnce([]).mockResolvedValueOnce([record])
    vi.mocked(repository.importArchive).mockResolvedValue({
      status: 'created',
      record
    } satisfies ExamImportResult)
    dialogMocks.readBinary.mockResolvedValue({
      name: 'exam.lsexam',
      data: new Uint8Array([1, 2, 3])
    })
    renderPage(repository)

    expect(await screen.findByText('暂无试卷')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入试卷包' }))

    await waitFor(() =>
      expect(repository.importArchive).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    )
    expect(await screen.findByText(record.title)).toBeInTheDocument()
  })

  it('确认后删除试卷包', async () => {
    const repository = mockRepository()
    vi.mocked(repository.listRecords).mockResolvedValueOnce([record]).mockResolvedValueOnce([])
    renderPage(repository)

    expect(await screen.findByText(record.title)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除试卷' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: `删除试卷“${record.title}”？`
    })
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(repository.deleteExam).toHaveBeenCalledWith(record.packageId))
    expect(await screen.findByText('暂无试卷')).toBeInTheDocument()
  })

  it('从列表进入指定试卷的播放器路由', async () => {
    const repository = mockRepository()
    vi.mocked(repository.listRecords).mockResolvedValue([record])
    renderPage(repository)

    fireEvent.click(await screen.findByRole('button', { name: '开始考试' }))

    expect(screen.getByTestId('player-route')).toHaveTextContent(`packageId=${record.packageId}`)
  })
})

const record: ExamLibraryRecord = {
  formatVersion: 1,
  packageId: 'exam-package-1',
  title: '英语听说测试',
  importedAt: '2026-08-10T12:00:00Z',
  archiveSha256: '1'.repeat(64),
  archiveBytes: 4096,
  pageCount: 2,
  timelineStepCount: 4,
  resourceCount: 1
}

function mockRepository(): ExamLibraryRepository {
  return {
    listRecords: vi.fn(),
    getRecord: vi.fn(),
    importArchive: vi.fn(),
    exportArchive: vi.fn(),
    deleteExam: vi.fn()
  }
}

function renderPage(repository: ExamLibraryRepository): void {
  render(
    <ExamLibraryProvider repository={repository}>
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route path="/exams" element={<ExamLibraryPage />} />
          <Route path="/exams/player" element={<PlayerRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </ExamLibraryProvider>
  )
}

function PlayerRouteProbe() {
  const location = useLocation()
  return <div data-testid="player-route">{location.search}</div>
}
