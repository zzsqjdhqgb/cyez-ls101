import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-TP-01 模板库列表 · 默认态（内置模板）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '试卷模板')
    await expect(page.getByRole('heading', { level: 1, name: '试卷模板' })).toBeVisible()

    const file = await captureState(page, 'UI-TP-01', 'default')
    expect(file).toContain(path.join('UI-TP-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
