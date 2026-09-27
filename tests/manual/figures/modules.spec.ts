import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { seedTextProvider } from '../support/manual-fixtures'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

test('FIG-GS-LIBRARY 评分单元库 · 内置评分单元', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '评分单元' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '评分单元' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '内置评分单元' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByText('正在加载评分单元...')).toBeHidden()

    const file = await captureFigure(page, 'FIG-GS-LIBRARY')
    expect(file).toContain(path.join('FIG-GS-LIBRARY', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-IF-LIBRARY 题型库 · 题型视图', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '题型库' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
    await expect(page.getByText('正在加载题型...')).toBeHidden()

    const file = await captureFigure(page, 'FIG-IF-LIBRARY')
    expect(file).toContain(path.join('FIG-IF-LIBRARY', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-LIBRARY 试卷模板库 · 内置模板', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '试卷模板' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '试卷模板' })).toBeVisible()
    await expect(page.getByText('正在加载模板库...')).toBeHidden()

    const file = await captureFigure(page, 'FIG-TP-LIBRARY')
    expect(file).toContain(path.join('FIG-TP-LIBRARY', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-ST-AIROUTER 设置 → AI 引擎 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    // 先播种一个文本生成服务商，让页面展示已配置状态而不是空状态。
    await seedTextProvider(page)
    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /^AI 引擎/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'AI 引擎' })).toBeVisible()
    await expect(page.getByText('示例服务商')).toBeVisible()

    const file = await captureFigure(page, 'FIG-ST-AIROUTER')
    expect(file).toContain(path.join('FIG-ST-AIROUTER', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
