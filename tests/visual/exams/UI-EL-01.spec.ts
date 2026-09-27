import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-EL-01 试卷库列表 · 默认态（空试卷库）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '试卷库')
    await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()

    const file = await captureState(page, 'UI-EL-01', 'default')
    expect(file).toContain(path.join('UI-EL-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
