import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { stubOpenDialog, writeObjectiveSubmissionFixture } from '../support/fixtures'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-SR-03 评分结算 · 默认态（一条可结算作答）', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareVisualUserDataDir()
  const submissionPath = await writeObjectiveSubmissionFixture(userDataDir)
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await stubOpenDialog(app, submissionPath)
    await navigateTo(page, '作答记录')
    await expect(page.getByRole('heading', { level: 1, name: '作答记录' })).toBeVisible()

    await page.getByRole('button', { name: '导入作答包' }).click()
    const row = page.getByRole('row').filter({ hasText: '赵宁' })
    // 只有客观题的作答在会话开始时已自动判定完成，直接进入评分结算。
    await expect(row.getByRole('button', { name: '开始评分', exact: true })).toBeVisible()
    await row.getByRole('button', { name: '开始评分', exact: true }).click()

    await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
    await expect(page.getByRole('button', { name: '本次结算（1）' })).toBeVisible()
    await expect(page.getByText('可结算', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('赵宁', { exact: true })).toBeVisible()
    // 导入成功的 toast 会自动消失（约 4 秒），等待它退场以获得稳定截图。
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 })

    const file = await captureState(page, 'UI-SR-03', 'default')
    expect(file).toContain(path.join('UI-SR-03', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
