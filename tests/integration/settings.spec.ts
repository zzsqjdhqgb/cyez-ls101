import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { closeStartupReleaseNotes, launchIntegrationApp } from './support/electron-app'

// 与 packages/renderer/src/app/register-settings.ts 的注册结果一致：分组按 group.order 升序，
// 组内按 order 升序（外观 0、存储 10、许可 20、关于 100；AI 组 AI 引擎 0）。
const registeredSettingsPages = [
  { group: '通用', title: '外观', description: '调整应用主题和动态效果' },
  { group: '通用', title: '存储', description: '查看和更改软件数据的保存位置' },
  { group: '通用', title: '许可', description: '管理软件激活状态' },
  { group: '通用', title: '关于', description: '查看应用版本、项目团队和软件许可' },
  { group: 'AI', title: 'AI 引擎', description: '配置 AI 服务商和各类可用模型' }
] as const

const groupTitles = ['通用', 'AI'] as const

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-settings-integration-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await closeStartupReleaseNotes(page)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test('navigates every registered settings page from the settings overview', async () => {
  await page.getByRole('link', { name: '设置' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()

  await expect(page.getByRole('heading', { level: 2 })).toHaveText([...groupTitles])
  const groups = page.locator('section').filter({ has: page.getByRole('heading', { level: 2 }) })
  await expect(groups).toHaveCount(groupTitles.length)

  for (const [groupIndex, groupTitle] of groupTitles.entries()) {
    const rows = groups.nth(groupIndex).getByRole('button')
    const expectedRows = registeredSettingsPages.filter((entry) => entry.group === groupTitle)
    await expect(rows).toHaveCount(expectedRows.length)
    for (const [rowIndex, entry] of expectedRows.entries()) {
      await expect(rows.nth(rowIndex)).toContainText(entry.title)
      await expect(rows.nth(rowIndex)).toContainText(entry.description)
    }
  }

  for (const entry of registeredSettingsPages) {
    await page.getByRole('button', { name: new RegExp(`^${entry.title}`) }).click()
    await expect(page.getByRole('heading', { level: 1, name: entry.title })).toBeVisible()
    await expect(page.getByText(entry.description, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回设置' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible()
  }
})

test('shows about details and closes the release notes dialog only explicitly', async () => {
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByRole('button', { name: /^关于/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '关于' })).toBeVisible()

  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    '曹二听说101',
    '项目发起人',
    '开发者',
    '版权与许可'
  ])
  await expect(page.getByText('英语听说考试系统')).toBeVisible()
  await expect(page.getByText(/^版本 \d+\.\d+\.\d+/)).toBeVisible()
  await expect(page.getByText('查看 0.4.1 发布预览与本次更新亮点')).toBeVisible()

  await expect(page.getByText('周飞')).toBeVisible()
  await expect(page.getByText('项目发起人 · 上海市曹杨第二中学校长')).toBeVisible()
  await expect(page.getByRole('link', { name: '应昊廷的 GitHub 主页' })).toHaveAttribute(
    'href',
    'https://github.com/zzsqjdhqgb'
  )
  await expect(page.getByRole('link', { name: '邹娟的 GitHub 主页' })).toHaveAttribute(
    'href',
    'https://github.com/zoujuan19900130'
  )
  await expect(page.getByRole('link', { name: '项目主页' })).toHaveAttribute(
    'href',
    'https://github.com/zzsqjdhqgb/cyez-ls101'
  )
  await expect(
    page.getByText('Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.')
  ).toBeVisible()
  await expect(page.getByText('本软件为专有软件，使用须遵守项目许可证。')).toBeVisible()

  await page.getByRole('button', { name: /^版本说明/ }).click()
  const releaseNotes = page.getByRole('dialog', { name: '曹二听说101 v0.4.1' })
  await expect(releaseNotes).toBeVisible()
  await expect(page.getByText(/^已安装 \S+/)).toBeVisible()

  // 规格：对话框只能通过「关闭版本说明」关闭；Esc 与点击对话框外部都不关闭。
  await page.keyboard.press('Escape')
  await expect(releaseNotes).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(releaseNotes).toBeVisible()

  await page.getByRole('button', { name: '关闭版本说明' }).click()
  await expect(releaseNotes).toBeHidden()
  await expect(page.getByRole('heading', { level: 1, name: '关于' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^版本说明/ })).toBeVisible()
})
