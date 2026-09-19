import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-IF-05 题型导出 · 默认态', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '题型库')
    await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
    await page.getByRole('button', { name: '导出题型' }).click()

    await expect(page.getByRole('heading', { name: '选择要交付的题组' })).toBeVisible({
      timeout: 15_000
    })

    const file = await captureState(page, 'UI-IF-05', 'default')
    expect(file).toContain(path.join('UI-IF-05', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
