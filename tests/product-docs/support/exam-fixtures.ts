import type { ExamPackage } from '@ls101/core-types'

/** 一份最小可运行试卷：单页、单条倒计时时间线、不含录音作答。 */
export function productExam(options: {
  packageId: string
  title: string
  countdownSeconds?: number
}): ExamPackage {
  const { packageId, title, countdownSeconds = 0 } = options
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId,
    examData: {
      title,
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'text-1', type: 'text', x: 10, y: 10, text: '请准备完成练习。' }],
            timeline: [{ type: 'countdown', seconds: countdownSeconds }]
          }
        ],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: packageId, examTitle: title },
      schemaUses: [],
      resources: {}
    }
  }
}
