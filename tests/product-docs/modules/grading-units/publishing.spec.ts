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
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-grading-units-'))
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
      id: 'GS-01',
      owner: { kind: 'module', slug: 'grading-units', title: '评分单元', order: 60 },
      section: '评分单元保存',
      title: '直接创建并保存评分单元',
      purpose:
        '评分单元结构和评分资料在同一个编辑页面完成，保存时校验并立即生效，不需要单独的草稿或发布步骤。',
      preconditions: ['评分单元库为空，用户需要创建第一个评分单元。'],
      outcomes: [
        '新建会直接产生一个可编辑的评分单元。',
        '保存时同时校验结构、名称、分值和评分说明。'
      ],
      manual: [{ chapter: 'prepare-content', order: 10 }],
      steps: [
        {
          key: 'create-unit',
          action: '进入“评分单元”，选择“新建评分单元”。',
          expected: '应用打开一个可直接编辑的评分单元。'
        },
        {
          key: 'save-unit',
          action:
            '选择题型、答案槽位和 Template 输入，填写名称、描述、满分和评分标准，然后选择“保存”。',
          expected: '页面提示评分单元已经保存，可以立即在模板中引用。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('create-unit', async () => {
        await page.getByRole('link', { name: '评分单元' }).click()
        await page.getByRole('tab', { name: '我的评分单元' }).click()
        await page.getByRole('button', { name: '新建评分单元' }).click()
        await expect(page.getByRole('heading', { name: '未命名评分单元' })).toBeVisible()
      })

      await productStep('save-unit', async () => {
        await page.getByLabel('名称').fill('客观题评分规则')
        await page.getByLabel('描述').fill('用于选择题自动判定')
        await page.getByLabel('answer', { exact: true }).fill('学生选择的答案')
        await expect(page.getByRole('button', { name: '客观题' })).toHaveAttribute(
          'data-active',
          'true'
        )
        await page.getByRole('button', { name: '添加到我的评分单元' }).click()
        await expect(page.getByText('已添加到我的评分单元')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'saved-unit',
          kind: 'result',
          step: 'save-unit',
          caption: '评分单元保存后可立即使用'
        })
        await page.getByRole('button', { name: '返回 Schema 列表' }).click()
        await page.getByRole('tab', { name: '我的评分单元' }).click()
        await expect(page.getByRole('button', { name: '客观题评分规则' })).toBeVisible()
      })
    }
  )
)
