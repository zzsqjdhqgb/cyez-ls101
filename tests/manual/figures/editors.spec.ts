import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'
import { fillStoredInstanceValues } from '../support/manual-fixtures'

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
    // 先建一个题组，让详情页展示真实的题组列表而不是空状态。
    await page.getByRole('button', { name: '新建题组' }).click()
    await page.getByLabel('题组名称').fill('校园生活第一套')
    await page.getByRole('button', { name: '创建题组' }).click()
    await expect(page.getByRole('dialog', { name: '新建题组' })).toBeHidden()
    await page.getByRole('button', { name: '返回题型详情' }).click()
    await expect(page.getByRole('button', { name: '校园生活第一套', exact: true })).toBeVisible()
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

test('FIG-IF-EXPORT 题型导出 · 选择题组', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    const instanceNames = ['校园生活第一套', '科技与环保第二套']
    await page.getByRole('link', { name: '题型库' }).click()
    await page
      .getByRole('button', { name: /^上海高考英语口语/ })
      .first()
      .click()
    for (const name of instanceNames) {
      await page.getByRole('button', { name: '新建题组' }).click()
      await page.getByLabel('题组名称').fill(name)
      await page.getByRole('button', { name: '创建题组' }).click()
      await expect(page.getByRole('dialog', { name: '新建题组' })).toBeHidden()
      await page.getByRole('button', { name: '返回题型详情' }).click()
    }
    // 题组先落盘再补写题目内容，导出页挂载时才会读到真正的题目。
    for (const name of instanceNames) await fillStoredInstanceValues(userDataDir, name)

    await page.getByRole('button', { name: '导出题型' }).click()
    await expect(page.getByRole('heading', { name: '选择要交付的题组' })).toBeVisible()
    await expect(page.getByText('已选择 2 个')).toBeVisible()
    // 只交付其中一套：把第二套取消勾选，选择页的用途才是看得见的。
    await page.getByRole('checkbox').nth(1).uncheck()
    await expect(page.getByText('已选择 1 个')).toBeVisible()

    const file = await captureFigure(page, 'FIG-IF-EXPORT')
    expect(file).toContain(path.join('FIG-IF-EXPORT', 'default.png'))
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
