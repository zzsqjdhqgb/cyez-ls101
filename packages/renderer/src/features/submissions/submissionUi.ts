import { SubmissionLibraryError } from '@ls101/submission-library'

export function submissionErrorMessage(reason: unknown): string {
  if (reason instanceof SubmissionLibraryError) {
    switch (reason.code) {
      case 'INVALID_ARCHIVE':
        return `无法导入作答包：${reason.message}`
      case 'SUBMISSION_ID_CONFLICT':
        return '作答库中已有相同 ID、但内容不同的作答包。'
      case 'NOT_FOUND':
        return '作答包不存在或已经被删除。'
      case 'INVALID_STORAGE':
        return `作答库数据损坏：${reason.message}`
    }
  }
  return reason instanceof Error ? reason.message : '操作失败，请重试。'
}

export function submissionExportName(candidateId: string, submittedAt: string): string {
  const safeCandidateId = candidateId.replace(/[\\/:*?"<>|]/g, '_').trim() || 'submission'
  const timestamp = submittedAt.replace(/[:]/g, '-').replace(/\.\d+/, '')
  return `${safeCandidateId}-${timestamp}.lssubmission`
}
