import { encodeExamPackage } from '@ls101/exam-package'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { practiceExam } from '../../visual/support/fixtures'

/** 说明书里使用的试卷名称：避免出现视觉回归夹具的名字。 */
export const MANUAL_EXAM_TITLE = '上海高考英语听说模拟卷'

/**
 * 借用视觉套件的最小可运行试卷夹具，改成一个用户手册里读得通的卷名后写入文件。
 * 夹具本身由视觉基线共用，不能改动，因此这里只改副本。
 */
export async function writeManualExamFixture(directory: string): Promise<string> {
  const exam = practiceExam()
  exam.examData.title = MANUAL_EXAM_TITLE
  exam.submissionTemplate.meta.examTitle = MANUAL_EXAM_TITLE
  const file = path.join(directory, 'manual-practice.lsexam')
  await writeFile(file, await encodeExamPackage(exam, {}))
  return file
}

/** 注入一个文本生成服务商，让 AI 引擎设置页显示已配置的服务商与模型。 */
export async function seedTextProvider(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.airouter.saveProviderConfig({
      name: '示例服务商',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'example-chat', enabled: true }],
      apiKey: 'example-key'
    })
  })
}
