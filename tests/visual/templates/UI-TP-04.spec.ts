import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

test('UI-TP-04 函数编辑器 · 新建函数默认态', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    // 函数编辑器只能从模板编辑器的本地函数库进入（路由需要函数库与函数上下文）。
    await navigateTo(page, '试卷模板')
    await expect(page.getByText('正在加载模板...')).toBeHidden()
    await page.getByRole('button', { name: '新建模板' }).click()

    const createLibrary = page.getByRole('button', { name: '新建本地函数库' })
    await expect(createLibrary).toBeEnabled()
    await createLibrary.click()
    await expect(page.getByRole('tab', { name: '本地函数库' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await page.getByRole('button', { name: '在“未命名函数库”中新建函数' }).click()
    await page.getByRole('button', { name: '编辑未命名函数' }).click()

    await expect(page.getByRole('heading', { level: 1, name: '未命名函数' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '函数名称' })).toHaveValue('未命名函数')
    await expect(page.getByRole('tab', { name: '结构' })).toHaveAttribute('aria-selected', 'true')

    const file = await captureState(page, 'UI-TP-04', 'default')
    expect(file).toContain(path.join('UI-TP-04', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
