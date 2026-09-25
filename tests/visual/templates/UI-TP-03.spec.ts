import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-TP-03 内置模板查看 · 默认态（内置模板）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '试卷模板')
    await expect(page.getByRole('tab', { name: '内置模板' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const builtinRow = page
      .getByText('上海高考口语标准题型', { exact: true })
      .locator('xpath=ancestor::article')
    await expect(builtinRow.getByRole('button', { name: '查看' })).toBeVisible()
    await builtinRow.getByRole('button', { name: '查看' }).click()

    await expect(
      page.getByRole('heading', { level: 1, name: '上海高考口语标准题型' })
    ).toBeVisible()
    await expect(page.getByText('内置模板 · 只读')).toBeVisible()
    await expect(page.getByRole('button', { name: '选择节点 root' })).toBeVisible()

    const file = await captureState(page, 'UI-TP-03', 'default')
    expect(file).toContain(path.join('UI-TP-03', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
