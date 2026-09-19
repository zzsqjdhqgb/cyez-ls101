import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-IF-03 题型草稿编辑器 · 默认态（新建草稿）', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '题型库')
    await page.getByRole('tab', { name: '草稿' }).click()
    await expect(page.getByRole('tab', { name: '草稿' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '新建题型' }).click()

    await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
    await expect(page.getByRole('region', { name: '题型内容' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '字段结构' })).toBeVisible()

    const file = await captureState(page, 'UI-IF-03', 'default')
    expect(file).toContain(path.join('UI-IF-03', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
