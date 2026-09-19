import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stubOpenDialog, writeExamFixture } from '../support/fixtures'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-EL-02 考试运行 · 考生信息默认态', async () => {
  test.setTimeout(90_000)
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const examPath = await writeExamFixture(userDataDir)
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await stubOpenDialog(app, examPath)
    await navigateTo(page, '试卷库')
    await page.getByRole('button', { name: '导入试卷包' }).click()
    await expect(page.getByRole('button', { name: '开始考试' }).first()).toBeVisible({
      timeout: 30_000
    })
    await page.getByRole('button', { name: '开始考试' }).first().click()

    await expect(page.getByLabel('姓名')).toBeVisible({ timeout: 15_000 })

    const file = await captureState(page, 'UI-EL-02', 'default')
    expect(file).toContain(path.join('UI-EL-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
