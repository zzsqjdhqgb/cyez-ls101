import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchProductDocsApp } from '../../support/product-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-'))
  pageErrors = []
  electronApp = await launchProductDocsApp(userDataDir)
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
      id: 'WB-01',
      owner: { kind: 'module', slug: 'workbench', title: '工作台与导航', order: 10 },
      section: '工作台概览',
      title: '从工作台了解当前状态并进入下一项工作',
      purpose:
        '工作台是应用首页和产品封面，汇总当前工作状态并提供快捷入口，但不承载其他模块的独占业务能力。',
      preconditions: ['使用全新的应用数据目录启动 LS101。'],
      outcomes: [
        '启动应用后首先进入工作台。',
        '工作台同时呈现产品状态、快捷入口、最近工作和待处理区域。'
      ],
      manual: [{ chapter: 'understand-ls101', order: 10 }],
      steps: [
        {
          key: 'open-workbench',
          action: '启动 LS101。',
          expected: '应用首先打开工作台，并显示英语摘句。'
        },
        {
          key: 'view-status',
          action: '查看“当前状态”。',
          expected: '工作台汇总试卷、待评分、题型、试卷模板和评分单元的当前数量。'
        },
        {
          key: 'view-shortcuts',
          action: '查看工作台上的快捷入口。',
          expected: '可以直接选择制作试卷、进入试卷库或处理作答记录。'
        },
        {
          key: 'view-follow-up',
          action: '继续查看工作台下方的信息。',
          expected: '页面提供“最近工作”和“待处理”区域，便于继续后续任务。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('open-workbench', async () => {
        await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
        await expect(
          page.getByRole('heading', {
            level: 2,
            name: 'Knowledge of languages is the doorway to wisdom.'
          })
        ).toBeVisible()
      })

      await productStep('view-status', async () => {
        const status = page.getByRole('region', { name: '当前状态' })
        await expect(status).toBeVisible()
        for (const label of ['试卷', '待评分', '题型', '试卷模板', '评分单元']) {
          await expect(status.getByText(label, { exact: true })).toBeVisible()
        }
      })

      await productStep('view-shortcuts', async () => {
        for (const label of ['制作试卷', '进入试卷库', '处理作答记录']) {
          await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible()
        }
      })

      await productStep('view-follow-up', async () => {
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
      section: '一级导航',
      title: '从一级导航进入各项功能',
      purpose:
        '工作台只提供汇总和快捷访问；试卷库、作答记录、题型库、试卷模板、评分单元和设置均拥有独立入口。',
      preconditions: ['应用位于工作台，侧边栏保持展开。'],
      outcomes: ['每个一级模块都有独立导航入口，不依赖工作台快捷卡片。'],
      manual: [{ chapter: 'understand-ls101', order: 20 }],
      steps: [
        ['exam-library', '试卷库'],
        ['submission-records', '作答记录'],
        ['interface-library', '题型库'],
        ['templates', '试卷模板'],
        ['grading-units', '评分单元'],
        ['settings', '设置']
      ].map(([key, label]) => ({
        key: `open-${key}`,
        action: `从一级导航选择“${label}”。`,
        expected: `应用打开“${label}”页面，可以独立开始该阶段的工作。`
      }))
    },
    async (_testInfo, productStep) => {
      const destinations = [
        ['试卷库', '试卷库'],
        ['作答记录', '作答记录'],
        ['题型库', '题型库'],
        ['试卷模板', '试卷模板'],
        ['评分单元', '评分单元'],
        ['设置', '设置']
      ] as const

      for (const [linkName, headingName] of destinations) {
        await productStep(`open-${linkNameToKey(linkName)}`, async () => {
          await page.getByRole('link', { name: linkName, exact: true }).click()
          await expect(page.getByRole('heading', { level: 1, name: headingName })).toBeVisible()
        })
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
