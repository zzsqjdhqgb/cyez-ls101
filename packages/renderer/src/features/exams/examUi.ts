import { ExamLibraryError } from '@ls101/exam-library'
import { toUserMessage } from '../../components/ui/userMessage'

export function examErrorMessage(reason: unknown): string {
  if (reason instanceof ExamLibraryError) {
    switch (reason.code) {
      case 'INVALID_ARCHIVE':
        return `无法导入试卷包：${toUserMessage(reason, '文件内容无效')}`
      case 'EXAM_ID_CONFLICT':
        return '考试库中已有相同编号、但内容不同的试卷包。'
      case 'NOT_FOUND':
        return '试卷包不存在或已经被删除。'
      case 'INVALID_STORAGE':
        return `考试库数据损坏：${toUserMessage(reason, '数据格式无效')}`
    }
  }
  return toUserMessage(reason)
}
