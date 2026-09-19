import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-ST-05 关于 · 默认态', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '设置')
    await page.getByRole('button', { name: '关于' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '关于' })).toBeVisible()

    const file = await captureState(page, 'UI-ST-05', 'default')
    expect(file).toContain(path.join('UI-ST-05', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
