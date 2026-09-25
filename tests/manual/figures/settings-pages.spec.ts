import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureFigure,
  launchFigureApp,
  normalizeEnvironmentArtifacts,
  prepareManualUserDataDir
} from '../support/manual-app'

async function openSettingsPage(
  page: import('@playwright/test').Page,
  row: RegExp,
  heading: string
): Promise<void> {
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByRole('button', { name: row }).click()
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

test('FIG-ST-STORAGE 设置 → 存储 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await openSettingsPage(page, /^存储/, '存储')
    await expect(page.getByText('数据位置', { exact: true })).toBeVisible()
    await expect(page.getByText('正在加载存储设置...')).toBeHidden()
    await normalizeEnvironmentArtifacts(page)

    const file = await captureFigure(page, 'FIG-ST-STORAGE')
    expect(file).toContain(path.join('FIG-ST-STORAGE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-APPEARANCE 设置 → 外观 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await openSettingsPage(page, /^外观/, '外观')
    await expect(page.getByText('界面主题')).toBeVisible()

    const file = await captureFigure(page, 'FIG-ST-APPEARANCE')
    expect(file).toContain(path.join('FIG-ST-APPEARANCE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-LICENSE 设置 → 许可 · 已激活', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await openSettingsPage(page, /^许可/, '许可')
    await expect(page.getByText('当前软件已激活。')).toBeVisible()

    const file = await captureFigure(page, 'FIG-ST-LICENSE')
    expect(file).toContain(path.join('FIG-ST-LICENSE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-ABOUT 设置 → 关于 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await openSettingsPage(page, /^关于/, '关于')
    await expect(page.getByText('英语听说考试系统')).toBeVisible()
    await expect(page.getByText(/^版本 \S+/)).toBeVisible()
    await normalizeEnvironmentArtifacts(page)

    const file = await captureFigure(page, 'FIG-ST-ABOUT')
    expect(file).toContain(path.join('FIG-ST-ABOUT', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
