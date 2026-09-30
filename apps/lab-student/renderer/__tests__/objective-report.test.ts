import { expect, it } from 'vitest'
import { buildObjectiveReport } from '../objective-report'
import {
  mixedArchive,
  objectiveArchive,
  emptyArchive,
  unansweredArchive
} from './objective-fixture'

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

it('grades a purely objective submission into a local report', async () => {
  const report = await buildObjectiveReport(await bytes(await objectiveArchive()))
  expect(report).not.toBeNull()
  expect(report).toMatchObject({
    submissionId: 'submission-objective-1',
    examTitle: '客观题练习',
    candidateName: '学生',
    candidateId: '001',
    totalScore: 2,
    maxScore: 5
  })
  expect(report!.markdown).toContain('总分')
  expect(report!.markdown).toContain('2/5')
  expect(report!.markdown).toContain('- 正确答案：A')
  expect(report!.markdown).toContain('- 学生答案：C')
  expect(report!.markdown).toContain('- 正误：正确')
  expect(report!.markdown).toContain('- 正误：错误')
  expect(report!.markdown).toContain('### 解析')
  expect(report!.markdown).toContain('选 A 是正确的。')
  expect(Object.keys(report!.resources)).toEqual([])
})

it('treats unanswered questions as wrong', async () => {
  const report = await buildObjectiveReport(await bytes(await unansweredArchive()))
  expect(report).toMatchObject({ totalScore: 0, maxScore: 5 })
  expect(report!.markdown).toContain('- 学生答案：未作答')
  expect(report!.markdown).toContain('- 正误：错误')
})

it('refuses submissions containing any non-objective unit', async () => {
  expect(await buildObjectiveReport(await bytes(await mixedArchive()))).toBeNull()
})

it('refuses submissions without grading units', async () => {
  expect(await buildObjectiveReport(await bytes(await emptyArchive()))).toBeNull()
})

it('surfaces a broken archive as a rejected promise instead of a report', async () => {
  await expect(buildObjectiveReport(new Uint8Array([1, 2, 3]))).rejects.toThrow()
})
