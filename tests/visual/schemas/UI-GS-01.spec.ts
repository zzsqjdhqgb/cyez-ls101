import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-GS-01 评分单元库 · 默认态（内置评分单元）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '评分单元')
    await expect(page.getByRole('heading', { level: 1, name: '评分单元' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '内置评分单元' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    const file = await captureState(page, 'UI-GS-01', 'default')
    expect(file).toContain(path.join('UI-GS-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
