// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@ls101/lab-client'
import { WorkspaceContext } from '../../session/workspace'
import { TeacherSession } from '../../session/session'
import type { LabHost } from '@ls101/lab-desktop-host'
import { SubmissionsPage } from '../SubmissionsPage'
import { ExamsPage } from '../ExamsPage'

afterEach(cleanup)

function fixture(page: 'submissions' | 'exams') {
  const session = new TeacherSession({} as LabHost)
  const submission = (id: string) => ({
    id,
    candidate: { displayName: id, candidateId: id },
    packageId: 'package',
    deviceAtReceipt: { number: '0001', room: 'A101', seat: '01' },
    receipt: { receivedAt: '2026-09-25T00:00:00Z' },
    archiveBytes: 100
  })
  const exam = {
    examId: 'exam',
    title: '口语练习',
    published: false,
    revision: 3,
    importedAt: '2026-09-25T00:00:00Z',
    pageCount: 1,
    resourceCount: 0,
    archiveBytes: 100
  }
  const request = vi.spyOn(session, 'request').mockResolvedValue({
    items: page === 'submissions' ? [submission('甲'), submission('乙')] : [exam],
    nextCursor: null
  })
  const mutate = vi.spyOn(session, 'mutate').mockResolvedValue({ items: [] })
  const download = vi.spyOn(session, 'download').mockResolvedValue()
  const importExam = vi.spyOn(session, 'importExam').mockResolvedValue()
  render(
    <WorkspaceContext.Provider value={{ session, view: session.getSnapshot() }}>
      {page === 'submissions' ? <SubmissionsPage /> : <ExamsPage />}
    </WorkspaceContext.Provider>
  )
  return { request, mutate, download, importExam, exam }
}

it('cancels deletion without writing and clears selected submissions when filters change', async () => {
  const { mutate, request } = fixture('submissions')
  fireEvent.click(await screen.findByLabelText('选择作答 甲'))
  fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
  expect(mutate).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '乙' } })
  fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      'getTeacherSubmissions',
      { query: { candidateName: '乙', limit: 50, cursor: undefined } },
      expect.any(AbortSignal)
    )
  )
  expect(screen.getByRole('button', { name: '删除选中' })).toBeDisabled()
  expect(screen.getByLabelText('选择作答 甲')).not.toBeChecked()
})

it('freezes the confirmed deletion scope and keeps only failed IDs selected for retry/export', async () => {
  const { mutate, download } = fixture('submissions')
  fireEvent.click(await screen.findByLabelText('选择本页作答'))
  fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
  // A selection change while the dialog exists must not change its captured deletion scope.
  fireEvent.click(screen.getByLabelText('选择作答 甲'))
  mutate.mockResolvedValueOnce({
    items: [
      { submissionId: '甲', status: 'deleted' },
      {
        submissionId: '乙',
        status: 'failed',
        error: { code: 'STORAGE_UNAVAILABLE', message: '磁盘错误' }
      }
    ]
  })
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' }))
  await screen.findByText(/1 份已删除，1 份失败/)
  expect(mutate).toHaveBeenCalledExactlyOnceWith('postTeacherSubmissionsDelete', {
    body: { submissionIds: ['甲', '乙'] }
  })
  expect(screen.getByLabelText('选择作答 甲')).not.toBeChecked()
  expect(screen.getByLabelText('选择作答 乙')).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '导出选中' }))
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      'postTeacherSubmissionsExport',
      { body: { submissionIds: ['乙'] } },
      '作答.zip'
    )
  )
  fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' }))
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith('postTeacherSubmissionsDelete', {
      body: { submissionIds: ['乙'] }
    })
  )
})

it('preserves selection and allows an explicit retry after a deletion transport failure', async () => {
  const { mutate } = fixture('submissions')
  fireEvent.click(await screen.findByLabelText('选择作答 甲'))
  mutate.mockRejectedValueOnce(new Error('网络中断'))
  fireEvent.click(screen.getByRole('button', { name: '删除选中' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' }))
  await screen.findByText('网络中断')
  expect(screen.getByLabelText('选择作答 甲')).toBeChecked()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(mutate).toHaveBeenCalledTimes(2)
})

it('refreshes the exam revision after a publication conflict before retrying', async () => {
  const { request, mutate, exam } = fixture('exams')
  await screen.findByText('口语练习')
  mutate.mockRejectedValueOnce(new RemoteError('REVISION_CONFLICT', 409))
  request.mockResolvedValue({ items: [{ ...exam, revision: 4 }], nextCursor: null })
  fireEvent.click(screen.getByRole('button', { name: '上架' }))
  await screen.findByRole('alert')
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '上架' }))
  await waitFor(() =>
    expect(mutate).toHaveBeenLastCalledWith('patchTeacherExamsExamId', {
      path: { examId: 'exam' },
      body: { published: true, expectedRevision: 4 }
    })
  )
})

it('refreshes after importing and requires confirmation to delete an exam', async () => {
  const { request, mutate, importExam } = fixture('exams')
  await screen.findByText('口语练习')
  fireEvent.click(screen.getByRole('button', { name: '导入试卷包' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(importExam).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }))
  expect(mutate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认' }))
  await waitFor(() =>
    expect(mutate).toHaveBeenCalledExactlyOnceWith('deleteTeacherExamsExamId', {
      path: { examId: 'exam' }
    })
  )
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
})
