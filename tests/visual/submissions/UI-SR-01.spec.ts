import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-SR-01 作答记录列表 · 默认态（空作答记录）', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '作答记录')
    await expect(page.getByRole('heading', { level: 1, name: '作答记录' })).toBeVisible()

    const file = await captureState(page, 'UI-SR-01', 'default')
    expect(file).toContain(path.join('UI-SR-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
