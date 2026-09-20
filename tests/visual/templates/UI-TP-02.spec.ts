import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-TP-02 模板编辑器 · 新建模板默认态', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '试卷模板')
    await page.getByRole('button', { name: '新建模板' }).click()

    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible({
      timeout: 15_000
    })
    await expect(page.getByRole('button', { name: '返回模板' })).toBeVisible()

    const file = await captureState(page, 'UI-TP-02', 'default')
    expect(file).toContain(path.join('UI-TP-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
