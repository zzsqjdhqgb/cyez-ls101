import { expect, test } from '@playwright/test'
import type { Schema } from '@ls101/lab-contracts'
import { businessFixture } from './support/business-fixture'

test('teacher imports, publishes, unpublishes and deletes an exam through the real UI', async () => {
  const f = await businessFixture()
  try {
    const { app, page } = await f.launchTeacher()
    const file = await f.examFile()
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] })
    }, file)
    await page.getByRole('button', { name: '导入试卷包' }).click()
    const row = page.getByRole('row').filter({ hasText: '独立业务练习' })
    await expect(row).toContainText('已上架')
    const exams = (): Promise<Schema<'ExamList'>> =>
      f.teacher.request<Schema<'ExamList'>>('getTeacherExams')
    expect((await exams()).items[0].published).toBe(true)
    await row.getByRole('button', { name: '下架', exact: true }).click()
    await expect(row).toContainText('已下架')
    expect((await exams()).items[0].published).toBe(false)
    await row.getByRole('button', { name: '上架', exact: true }).click()
    await expect(row).toContainText('已上架')
    expect((await exams()).items[0].published).toBe(true)
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    expect((await exams()).items).toHaveLength(1)
    await row.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
    await expect(row).toHaveCount(0)
    expect((await exams()).items).toHaveLength(0)
  } finally {
    await f.close()
  }
})
