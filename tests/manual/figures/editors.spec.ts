import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

test('FIG-GS-EDITOR 新建评分单元 · 结构与数据', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '评分单元' }).click()
    await page.getByRole('button', { name: '新建评分单元' }).click()
    await expect(page.getByText('评分结构', { exact: true })).toBeVisible()
    await expect(page.getByText('评分单元内容')).toBeVisible()

    const file = await captureFigure(page, 'FIG-GS-EDITOR')
    expect(file).toContain(path.join('FIG-GS-EDITOR', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-IF-DETAILS 题型详情 · 题组视图', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '题型库' }).click()
    await page
      .getByRole('button', { name: /^上海高考英语口语/ })
      .first()
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('tab', { name: '题组' })).toHaveAttribute('aria-selected', 'true')

    const file = await captureFigure(page, 'FIG-IF-DETAILS')
    expect(file).toContain(path.join('FIG-IF-DETAILS', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-IF-DRAFT 题型草稿编辑器 · 定义视图', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '题型库' }).click()
    await page
      .getByRole('button', { name: /^上海高考英语口语/ })
      .first()
      .click()
    await page.getByRole('tab', { name: '题型定义' }).click()
    await page.getByRole('button', { name: '复制为草稿' }).click()
    await expect(page.getByText('字段结构', { exact: true })).toBeVisible()
    await expect(page.getByText('生成要求', { exact: true })).toBeVisible()

    const file = await captureFigure(page, 'FIG-IF-DRAFT')
    expect(file).toContain(path.join('FIG-IF-DRAFT', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-IF-INSTANCE 题组编辑器 · 新建题组', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '题型库' }).click()
    await page
      .getByRole('button', { name: /^上海高考英语口语/ })
      .first()
      .click()
    await page.getByRole('button', { name: '新建题组' }).click()
    await page.getByLabel('题组名称').fill('校园生活第一套')
    await page.getByRole('button', { name: '创建题组' }).click()
    await expect(page.getByRole('dialog', { name: '新建题组' })).toBeHidden()

    const file = await captureFigure(page, 'FIG-IF-INSTANCE')
    expect(file).toContain(path.join('FIG-IF-INSTANCE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-EDITOR 内置模板查看 · 结构视图', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '试卷模板' }).click()
    await page.getByRole('button', { name: '查看' }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const file = await captureFigure(page, 'FIG-TP-EDITOR')
    expect(file).toContain(path.join('FIG-TP-EDITOR', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
