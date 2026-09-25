import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { stubOpenDialog, writeMixedSubmissionFixture } from '../support/fixtures'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-SR-02 评分工作区 · 人工评分默认态（客观题自动判定，朗读题待评）', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareVisualUserDataDir()
  const submissionPath = await writeMixedSubmissionFixture(userDataDir)
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await stubOpenDialog(app, submissionPath)
    await navigateTo(page, '作答记录')
    await expect(page.getByRole('heading', { level: 1, name: '作答记录' })).toBeVisible()

    await page.getByRole('button', { name: '导入作答包' }).click()
    const row = page.getByRole('row').filter({ hasText: '李华' })
    await expect(row.getByRole('button', { name: '开始评分', exact: true })).toBeVisible()
    await row.getByRole('button', { name: '开始评分', exact: true }).click()

    await expect(page.getByRole('heading', { name: '选择评分方式' })).toBeVisible()
    await page.getByRole('button', { name: '人工评分' }).click()

    await expect(page.getByRole('button', { name: '暂停并返回' })).toBeVisible()
    await expect(page.getByRole('region', { name: '评分材料' })).toBeVisible()
    await expect(page.getByRole('region', { name: '人工评分' })).toBeVisible()
    await expect(page.getByText('请朗读句子。')).toBeVisible()
    await expect(page.getByLabel('分数')).toBeVisible()
    // 导入成功的 toast 会自动消失（约 4 秒），等待它退场以获得稳定截图。
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })

    const file = await captureState(page, 'UI-SR-02', 'default')
    expect(file).toContain(path.join('UI-SR-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
