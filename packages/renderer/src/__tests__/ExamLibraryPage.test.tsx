import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ExamImportResult,
  ExamLibraryRecord,
  ExamLibraryRepository
} from '@ls101/exam-library'
import { ExamLibraryError } from '@ls101/exam-library'
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

  it('导出试卷包并写入系统保存对话框', async () => {
    const repository = mockRepository()
    const exportable = { ...record, title: '英语/听说测试' }
    const archive = new Uint8Array([9, 8, 7])
    vi.mocked(repository.listRecords).mockResolvedValue([exportable])
    vi.mocked(repository.exportArchive).mockResolvedValue(archive)
    dialogMocks.writeBinary.mockResolvedValue(true)
    renderPage(repository)

    fireEvent.click(await screen.findByRole('button', { name: '导出试卷' }))

    await waitFor(() => expect(repository.exportArchive).toHaveBeenCalledWith(record.packageId))
    expect(dialogMocks.writeBinary).toHaveBeenCalledTimes(1)
    expect(dialogMocks.writeBinary).toHaveBeenCalledWith(archive, {
      title: '导出试卷',
      defaultName: '英语-听说测试.lsexam',
      filters: [{ name: 'LS101 试卷包', extensions: ['lsexam', 'zip'] }]
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '导出试卷' })).toBeEnabled())
  })

  it('取消保存对话框时不提示错误并恢复导出操作', async () => {
    const repository = mockRepository()
    vi.mocked(repository.listRecords).mockResolvedValue([record])
    vi.mocked(repository.exportArchive).mockResolvedValue(new Uint8Array([1, 2, 3]))
    dialogMocks.writeBinary.mockResolvedValue(false)
    renderPage(repository)

    fireEvent.click(await screen.findByRole('button', { name: '导出试卷' }))

    await waitFor(() => expect(dialogMocks.writeBinary).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '导出试卷' })).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(record.title)).toBeInTheDocument()
  })

  it('导出失败时显示错误并恢复导出操作', async () => {
    const repository = mockRepository()
    vi.mocked(repository.listRecords).mockResolvedValue([record])
    vi.mocked(repository.exportArchive).mockRejectedValue(
      new ExamLibraryError('NOT_FOUND', 'missing exam')
    )
    renderPage(repository)

    fireEvent.click(await screen.findByRole('button', { name: '导出试卷' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('试卷包不存在或已经被删除。')
    expect(dialogMocks.writeBinary).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '导出试卷' })).toBeEnabled())
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
