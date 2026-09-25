import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { seedSpeechProvider } from '../../visual/support/seeding'
import { composeSplitTheme } from '../support/compose'
import { seedTextProvider } from '../support/manual-fixtures'
import {
  captureComposedFigure,
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

test('FIG-ST-THEME 工作台 · 左半浅色、右半深色', async () => {
  test.setTimeout(90_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await page.waitForTimeout(1000)
    const light = await page.screenshot({ animations: 'disabled' })

    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /^外观/ }).click()
    await page.getByLabel('界面主题').selectOption({ label: '深色' })
    await page.getByRole('link', { name: '工作台' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await page.waitForTimeout(1000)
    const dark = await page.screenshot({ animations: 'disabled' })

    const file = await captureComposedFigure(composeSplitTheme(light, dark), 'FIG-ST-THEME')
    expect(file).toContain(path.join('FIG-ST-THEME', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-AIROUTER-EDITOR 服务商编辑器 · 基础配置与连接测试', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await seedTextProvider(page)
    await openSettingsPage(page, /^AI 引擎/, 'AI 引擎')
    await page.getByRole('button', { name: /示例服务商/ }).click()
    await expect(page.getByText('基础配置', { exact: true })).toBeVisible()
    await expect(page.getByText('模型编号', { exact: true })).toBeVisible()
    await expect(page.getByText('连接测试', { exact: true })).toBeVisible()

    const file = await captureFigure(page, 'FIG-ST-AIROUTER-EDITOR')
    expect(file).toContain(path.join('FIG-ST-AIROUTER-EDITOR', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-AIROUTER-SPEECH 语音合成区域 · 在线与本地', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await seedSpeechProvider(page)
    await openSettingsPage(page, /^AI 引擎/, 'AI 引擎')
    await page.getByRole('tab', { name: '语音合成' }).click()
    await expect(page.getByText('TTS 模型包', { exact: true })).toBeVisible()
    await expect(page.getByText('视觉语音')).toBeVisible()

    const file = await captureFigure(page, 'FIG-ST-AIROUTER-SPEECH')
    expect(file).toContain(path.join('FIG-ST-AIROUTER-SPEECH', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
