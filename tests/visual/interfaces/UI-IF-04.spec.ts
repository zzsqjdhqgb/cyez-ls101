import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp, navigateTo } from '../support/visual-app'

test('UI-IF-04 题组编辑器 · 新建题组默认态', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '题型库')
    await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
    await page.getByRole('button', { name: '新建题组' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox').fill('视觉测试题组')
    await dialog.getByRole('button', { name: '创建题组' }).click()

    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible({
      timeout: 15_000
    })

    const file = await captureState(page, 'UI-IF-04', 'default')
    expect(file).toContain(path.join('UI-IF-04', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
