import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../integration/support/electron-app'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
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
  'WB-01 工作台呈现产品封面、当前状态和快捷入口',
  {
    annotation: [
      { type: 'product-area', description: '工作台' },
      {
        type: 'summary',
        description:
          '工作台是应用首页和产品封面，汇总当前工作状态并提供快捷入口，但不承载其他模块的独占业务能力。'
      },
      { type: 'precondition', description: '使用全新的应用数据目录启动 LS101。' }
    ]
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
  async ({}, testInfo) => {
    await test.step('启动应用后首先看到曹二听说 101 工作台封面', async () => {
      await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '欢迎回来，开始今天的工作。' })).toBeVisible()
    })

    await test.step('工作台展示试卷、待评分、题型、模板和评分单元状态', async () => {
      const status = page.getByRole('region', { name: '当前状态' })
      await expect(status).toBeVisible()
      for (const label of ['试卷', '待评分', '题型', '试卷模板', '评分单元']) {
        await expect(status.getByText(label, { exact: true })).toBeVisible()
      }
    })

    await test.step('工作台提供制卷、运行和处理作答记录的快捷入口', async () => {
      for (const label of ['制作试卷', '进入试卷库', '处理作答记录']) {
        await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
      }
    })

    await test.step('工作台预留最近工作和待处理状态区域', async () => {
      await expect(page.getByRole('heading', { name: '最近工作' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '待处理' })).toBeVisible()
    })

    await testInfo.attach('工作台首页', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    })
  }
)

test(
  'WB-02 每个一级模块都能脱离工作台独立进入',
  {
    annotation: [
      { type: 'product-area', description: '应用导航' },
      {
        type: 'summary',
        description:
          '工作台只提供汇总和快捷访问；试卷库、作答记录、题型库、试卷模板、评分单元和设置均拥有独立入口。'
      },
      { type: 'precondition', description: '应用位于工作台，侧边栏保持展开。' }
    ]
  },
  async () => {
    const destinations = [
      ['试卷库', '试卷库'],
      ['作答记录', '作答记录'],
      ['题型库', '题型库'],
      ['试卷模板', '试卷模板'],
      ['评分单元', '评分单元'],
      ['设置', '设置']
    ] as const

    for (const [linkName, headingName] of destinations) {
      await test.step(`从一级导航独立进入${linkName}`, async () => {
        await page.getByRole('link', { name: linkName, exact: true }).click()
        await expect(page.getByRole('heading', { level: 1, name: headingName })).toBeVisible()
      })
    }
  }
)
