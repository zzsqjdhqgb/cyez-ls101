import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-IF-02 题型详情 · 默认态（内置题型）', async () => {
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await navigateTo(page, '题型库')
    const builtinInterface = page.getByRole('button', { name: '上海高考英语口语', exact: true })
    await expect(builtinInterface).toBeVisible()
    await builtinInterface.click()

    await expect(page.getByRole('heading', { level: 1, name: '上海高考英语口语' })).toBeVisible()
    await expect(page.getByText('内置题型', { exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '题组' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: '新建题组' })).toBeVisible()

    const file = await captureState(page, 'UI-IF-02', 'default')
    expect(file).toContain(path.join('UI-IF-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
