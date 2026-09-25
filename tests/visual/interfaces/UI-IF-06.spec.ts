import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { stubOpenDialog, writeInterfaceFixture } from '../support/fixtures'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-IF-06 题型导入 · 默认态（可导入的用户题型文件）', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareVisualUserDataDir()
  const interfacePath = await writeInterfaceFixture(userDataDir)
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    await stubOpenDialog(app, interfacePath)
    await navigateTo(page, '题型库')
    await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()

    await page.getByRole('button', { name: '题型库操作' }).click()
    await page.getByRole('menuitem', { name: '导入题型' }).click()

    await expect(page.getByRole('heading', { name: '审查题型文件' })).toBeVisible()
    await expect(page.getByText('视觉导入题型', { exact: true })).toBeVisible()
    await expect(page.getByText('可以导入')).toBeVisible()
    await expect(page.getByText('已选择 1 个')).toBeVisible()

    const file = await captureState(page, 'UI-IF-06', 'default')
    expect(file).toContain(path.join('UI-IF-06', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
