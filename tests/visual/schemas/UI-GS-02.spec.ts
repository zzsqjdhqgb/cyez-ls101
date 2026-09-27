import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-GS-02 评分单元定义 · 默认态（内置评分单元）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '评分单元')
    const builtinSchema = page.getByRole('button', { name: '上海高考 - 朗读句子' })
    await expect(builtinSchema).toBeVisible()
    await builtinSchema.click()

    await expect(page.getByRole('heading', { level: 1, name: '上海高考 - 朗读句子' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '评分单元内容' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '冻结结构' })).toBeVisible()

    const file = await captureState(page, 'UI-GS-02', 'default')
    expect(file).toContain(path.join('UI-GS-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
