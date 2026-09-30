// 学生端本地客观题报告：只使用 @ls101/submission-library 的客观题评分引擎，
// 不引入任何主观题评分（human/AI）依赖，也不接触 AIRouter。
import { decodeSubmissionPackage } from '@ls101/exam-package'
import {
  buildGradingInput,
  buildSubmissionReportMarkdown,
  objectiveGradingEngine,
  type GradingResourceInput,
  type SubmissionGradingItem,
  type SubmissionGradingRecord
} from '@ls101/submission-library'

/**
 * 一次性的本地作答报告。只存在于学生端内存中：关闭对话框即丢弃，
 * 不落盘、不进入任何可以重新打开的入口。
 */
export interface ObjectiveReport {
  submissionId: string
  examTitle: string
  candidateName: string
  candidateId: string
  submittedAt: string
  totalScore: number
  maxScore: number
  markdown: string
  resources: Record<string, GradingResourceInput>
}

/**
 * 把一份已上传完成的作答包在本地批改成报告。
 *
 * 只有整卷都是客观题（且至少有一个评分单元）才生成报告；任何主观题单元都返回
 * `null`，主观题批改属于任课老师端，学生端不做也不引用相关代码。批改在调用方
 * 确认上传完成后才执行，避免干扰既有上传流程。
 */
export async function buildObjectiveReport(
  archiveBytes: Uint8Array,
  now: () => Date = () => new Date()
): Promise<ObjectiveReport | null> {
  const archive = await decodeSubmissionPackage(archiveBytes)
  const { submission } = archive
  if (submission.schemaUses.length === 0) return null
  if (submission.schemaUses.some((use) => use.schema.structure.questionType !== 'objective'))
    return null

  const inputs = submission.schemaUses.map((use) => buildGradingInput(archive, use))
  const items: SubmissionGradingItem[] = []
  for (const input of inputs) {
    items.push({
      instanceId: input.instanceId,
      engine: 'objective',
      result: await objectiveGradingEngine.grade(input),
      gradedAt: now().toISOString()
    })
  }
  const grading: SubmissionGradingRecord = {
    formatVersion: 1,
    submissionId: submission.meta.submissionId,
    status: 'ready',
    items,
    aiRuns: [],
    totalScore: items.reduce((total, item) => total + item.result.score, 0),
    maxScore: inputs.reduce((total, input) => total + input.schema.data.maxScore, 0),
    readyAt: now().toISOString()
  }

  return {
    submissionId: submission.meta.submissionId,
    examTitle: submission.meta.examTitle,
    candidateName: submission.meta.candidate.displayName,
    candidateId: submission.meta.candidate.candidateId,
    submittedAt: submission.meta.submittedAt,
    totalScore: grading.totalScore,
    maxScore: grading.maxScore,
    markdown: buildSubmissionReportMarkdown(submission, grading, inputs),
    resources: Object.fromEntries(
      inputs.flatMap((input) =>
        Object.entries(input.resources).filter(([, resource]) => resource.kind === 'static')
      )
    )
  }
}
