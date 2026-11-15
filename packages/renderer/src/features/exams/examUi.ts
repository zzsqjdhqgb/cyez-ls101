import type { FileDialog } from '@ls101/file-dialog/renderer'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { ExamLibraryError } from '@ls101/exam-library'

export const EXAM_ARCHIVE_FILTER = {
  name: 'LS101 试卷包',
  extensions: ['lsexam', 'zip']
} as const

export function examErrorMessage(reason: unknown): string {
  if (reason instanceof ExamLibraryError) {
    switch (reason.code) {
      case 'INVALID_ARCHIVE':
        return `无法导入试卷包：${reason.message}`
      case 'EXAM_ID_CONFLICT':
        return '考试库中已有相同 ID、但内容不同的试卷包。'
      case 'NOT_FOUND':
        return '试卷包不存在或已经被删除。'
      case 'INVALID_STORAGE':
        return `考试库数据损坏：${reason.message}`
    }
  }
  return reason instanceof Error ? reason.message : '操作失败，请重试。'
}

export async function exportExamArchive(
  archive: Uint8Array,
  examTitle: string,
  dialog: Pick<FileDialog, 'writeBinary'> = fileDialog
): Promise<boolean> {
  return dialog.writeBinary(archive, {
    title: '导出试卷',
    defaultName: `${safeFilename(examTitle)}.lsexam`,
    filters: [EXAM_ARCHIVE_FILTER]
  })
}

function safeFilename(value: string): string {
  const withoutControls = [...value.trim()]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
  const safe = withoutControls.replace(/[\\/:*?"<>|]+/g, '-').replace(/[. ]+$/g, '')
  return safe || '未命名试卷'
}
