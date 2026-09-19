import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-IF-01 题型库列表 · 默认态（内置题型）', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '题型库')
    await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '题型' })).toHaveAttribute('aria-selected', 'true')

    const file = await captureState(page, 'UI-IF-01', 'default')
    expect(file).toContain(path.join('UI-IF-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
