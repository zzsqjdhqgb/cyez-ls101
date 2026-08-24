import { ExamLibraryError } from '@ls101/exam-library'

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
