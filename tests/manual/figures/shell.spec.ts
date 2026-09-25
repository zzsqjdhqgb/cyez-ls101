import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

test('FIG-SHELL-NAV 主界面侧边导航 · 展开与收起', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    // 用模块页而不是工作台取证：工作台另有 FIG-WORKBENCH，两图不得重复。
    await page.getByRole('link', { name: '题型库' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()

    const expanded = await captureFigure(page, 'FIG-SHELL-NAV')
    expect(expanded).toContain(path.join('FIG-SHELL-NAV', 'default.png'))

    await page.getByRole('button', { name: '收起侧边栏' }).click()
    await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible()

    const collapsed = await captureFigure(page, 'FIG-SHELL-NAV', 'collapsed')
    expect(collapsed).toContain(path.join('FIG-SHELL-NAV', 'collapsed.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
