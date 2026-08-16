import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productStep, productTest } from '../../support/product-test'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-grading-units-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  await prepareProductPage(page)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test(
  ...productTest(
    {
      id: 'GS-01',
      owner: { kind: 'module', slug: 'grading-units', title: '评分单元', order: 60 },
      capability: '评分单元发布',
      title: '从结构草稿填写评分资料并发布稳定评分单元',
      intent:
        '评分单元先以可保存的结构草稿存在，发布时补齐面向用户的名称、说明和答案解释，生成稳定契约并保留原草稿。',
      preconditions: ['评分单元库为空，用户需要创建第一个评分单元。'],
      guarantees: [
        '创建草稿库和结构草稿不会直接产生正式评分单元。',
        '发布对话框要求补齐正式名称、描述和答案槽位说明。',
        '发布成功后正式评分单元和结构草稿都保留，可以分别进入。'
      ],
      guide: [{ chapter: 'prepare-content', order: 10 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('create-draft-library', '进入评分单元并新建结构草稿库', async () => {
        await page.getByRole('link', { name: '评分单元' }).click()
        await page.getByRole('button', { name: '新建草稿库' }).click()
        await expect(page.getByRole('heading', { name: '未命名草稿库' })).toBeVisible()
        await page.getByLabel('草稿库名称').fill('口语评分规则')
        await page.getByRole('button', { name: '保存名称' }).click()
        await expect(page.getByText('草稿库已保存')).toBeVisible()
        await page.getByRole('button', { name: '新建结构' }).click()
        await expect(page.getByRole('heading', { name: '未命名结构' })).toBeVisible()
      })

      await productStep('define-draft', '命名结构草稿并明确评分管道', async () => {
        await page.getByRole('textbox').first().fill('客观题评分规则')
        await expect(page.getByRole('button', { name: '客观题' })).toHaveAttribute(
          'data-active',
          'true'
        )
        await page.getByRole('button', { name: '保存' }).click()
        await expect(page.getByText('结构草稿已保存')).toBeVisible()
      })

      await productStep('publish-unit', '补齐正式资料并确认发布冻结结构', async () => {
        await page.getByRole('button', { name: '发布正式版' }).click()
        const dialog = page.getByRole('dialog', { name: '发布正式 Schema' })
        await expect(dialog).toContainText('当前结构将被冻结')
        await dialog.getByLabel('名称').fill('客观题评分规则')
        await dialog.getByLabel('描述').fill('用于选择题自动判定')
        await dialog.getByLabel('answer').fill('学生选择的答案')
        await evidence(testInfo, page, {
          key: 'publish-data',
          kind: 'decision',
          step: 'publish-unit',
          caption: '发布前补齐名称、描述和答案槽位说明'
        })
        await dialog.getByRole('button', { name: '发布' }).click()
        await expect(page.getByText('正式 Schema 已发布')).toBeVisible()
      })

      await productStep('verify-lifecycle', '发布后查看正式评分单元并保留结构草稿', async () => {
        await expect(page.getByRole('heading', { level: 1, name: '客观题评分规则' })).toBeVisible()
        await page.getByRole('button', { name: '返回 Schema 列表' }).click()
        await expect(page.getByRole('button', { name: '客观题评分规则' })).toBeVisible()
        await page.getByRole('button', { name: '口语评分规则' }).click()
        await expect(page.getByRole('button', { name: '客观题评分规则' })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'published-and-draft',
          kind: 'result',
          step: 'verify-lifecycle',
          caption: '正式评分单元发布后，结构草稿仍可在草稿库中找到'
        })
      })
    }
  )
)
