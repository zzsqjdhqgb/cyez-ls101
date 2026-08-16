import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, productStep, productTest } from '../../support/product-test'

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
  ...productTest(
    {
      id: 'WB-01',
      owner: { kind: 'module', slug: 'workbench', title: '工作台与导航', order: 10 },
      capability: '工作台概览',
      title: '工作台呈现产品封面、当前状态和快捷入口',
      intent:
        '工作台是应用首页和产品封面，汇总当前工作状态并提供快捷入口，但不承载其他模块的独占业务能力。',
      preconditions: ['使用全新的应用数据目录启动 LS101。'],
      guarantees: [
        '启动应用后首先进入工作台。',
        '工作台同时呈现产品状态、快捷入口、最近工作和待处理区域。'
      ],
      guide: [{ chapter: 'understand-ls101', order: 10 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('open-workbench', '启动应用后首先看到曹二听说 101 工作台封面', async () => {
        await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
        await expect(
          page.getByRole('heading', { name: '欢迎回来，开始今天的工作。' })
        ).toBeVisible()
      })

      await productStep(
        'view-status',
        '工作台展示试卷、待评分、题型、模板和评分单元状态',
        async () => {
          const status = page.getByRole('region', { name: '当前状态' })
          await expect(status).toBeVisible()
          for (const label of ['试卷', '待评分', '题型', '试卷模板', '评分单元']) {
            await expect(status.getByText(label, { exact: true })).toBeVisible()
          }
        }
      )

      await productStep(
        'view-shortcuts',
        '工作台提供制卷、运行和处理作答记录的快捷入口',
        async () => {
          for (const label of ['制作试卷', '进入试卷库', '处理作答记录']) {
            await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
          }
        }
      )

      await productStep('view-follow-up', '工作台预留最近工作和待处理状态区域', async () => {
        await expect(page.getByRole('heading', { name: '最近工作' })).toBeVisible()
        await expect(page.getByRole('heading', { name: '待处理' })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'workbench-home',
          kind: 'result',
          step: 'view-follow-up',
          caption: '工作台首页同时呈现状态、快捷入口和后续工作区域'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'WB-02',
      owner: { kind: 'module', slug: 'workbench', title: '工作台与导航', order: 10 },
      capability: '一级导航',
      title: '每个一级模块都能脱离工作台独立进入',
      intent:
        '工作台只提供汇总和快捷访问；试卷库、作答记录、题型库、试卷模板、评分单元和设置均拥有独立入口。',
      preconditions: ['应用位于工作台，侧边栏保持展开。'],
      guarantees: ['每个一级模块都有独立导航入口，不依赖工作台快捷卡片。'],
      guide: [{ chapter: 'understand-ls101', order: 20 }]
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
        await productStep(
          `open-${linkNameToKey(linkName)}`,
          `从一级导航独立进入${linkName}`,
          async () => {
            await page.getByRole('link', { name: linkName, exact: true }).click()
            await expect(page.getByRole('heading', { level: 1, name: headingName })).toBeVisible()
          }
        )
      }
    }
  )
)

function linkNameToKey(name: string): string {
  switch (name) {
    case '试卷库':
      return 'exam-library'
    case '作答记录':
      return 'submission-records'
    case '题型库':
      return 'interface-library'
    case '试卷模板':
      return 'templates'
    case '评分单元':
      return 'grading-units'
    default:
      return 'settings'
  }
}
