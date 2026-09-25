import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-ST-01 设置总览 · 默认态', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '设置')
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '外观' })).toBeVisible()

    const file = await captureState(page, 'UI-ST-01', 'default')
    expect(file).toContain(path.join('UI-ST-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
