import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  stubOpenDialog,
  writeExamFixture,
  writeMixedSubmissionFixture,
  writeObjectiveSubmissionFixture
} from '../../visual/support/fixtures'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

/** 导入成功的提示会自动消失，等待退场后再截图，避免把临时提示当成页面内容。 */
async function waitForToastsToSettle(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 })
}

test('FIG-EL-PLAYER 考试运行 · 考生登录', async () => {
  test.setTimeout(120_000)
  const userDataDir = await prepareManualUserDataDir()
  const examPath = await writeExamFixture(userDataDir)
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await stubOpenDialog(app, examPath)
    await page.getByRole('link', { name: '试卷库' }).click()
    await page.getByRole('button', { name: '导入试卷包' }).click()
    await expect(page.getByRole('button', { name: '开始考试' }).first()).toBeVisible({
      timeout: 30_000
    })
    await page.getByRole('button', { name: '开始考试' }).first().click()
    await expect(page.getByLabel('姓名')).toBeVisible({ timeout: 15_000 })

    const file = await captureFigure(page, 'FIG-EL-PLAYER')
    expect(file).toContain(path.join('FIG-EL-PLAYER', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-SR-GRADING 评分工作区 · 人工评分', async () => {
  test.setTimeout(120_000)
  const userDataDir = await prepareManualUserDataDir()
  const submissionPath = await writeMixedSubmissionFixture(userDataDir)
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await stubOpenDialog(app, submissionPath)
    await page.getByRole('link', { name: '作答记录' }).click()
    await page.getByRole('button', { name: '导入作答包' }).click()
    const row = page.getByRole('row').filter({ hasText: '李华' })
    await expect(row.getByRole('button', { name: '开始评分', exact: true })).toBeVisible({
      timeout: 30_000
    })
    await row.getByRole('button', { name: '开始评分', exact: true }).click()
    await page.getByRole('button', { name: '人工评分' }).click()
    await expect(page.getByRole('region', { name: '评分材料' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('region', { name: '人工评分' })).toBeVisible()
    await expect(page.getByLabel('分数')).toBeVisible()
    await waitForToastsToSettle(page)

    const file = await captureFigure(page, 'FIG-SR-GRADING')
    expect(file).toContain(path.join('FIG-SR-GRADING', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-SR-SETTLEMENT 评分结算 · 一条可结算作答', async () => {
  test.setTimeout(120_000)
  const userDataDir = await prepareManualUserDataDir()
  const submissionPath = await writeObjectiveSubmissionFixture(userDataDir)
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await stubOpenDialog(app, submissionPath)
    await page.getByRole('link', { name: '作答记录' }).click()
    await page.getByRole('button', { name: '导入作答包' }).click()
    const row = page.getByRole('row').filter({ hasText: '赵宁' })
    await expect(row.getByRole('button', { name: '开始评分', exact: true })).toBeVisible({
      timeout: 30_000
    })
    await row.getByRole('button', { name: '开始评分', exact: true }).click()
    await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: '本次结算（1）' })).toBeVisible()
    await waitForToastsToSettle(page)

    const file = await captureFigure(page, 'FIG-SR-SETTLEMENT')
    expect(file).toContain(path.join('FIG-SR-SETTLEMENT', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
