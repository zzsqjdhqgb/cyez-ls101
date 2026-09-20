import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureState, launchVisualApp, prepareVisualUserDataDir } from '../support/visual-app'

test('UI-WB-01 工作台 · 默认态', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '最近工作' })).toBeVisible()

    const file = await captureState(page, 'UI-WB-01', 'default')
    expect(file).toContain(path.join('UI-WB-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
