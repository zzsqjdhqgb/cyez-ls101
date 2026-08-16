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
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-template-library-'))
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
      id: 'TP-01',
      owner: { kind: 'module', slug: 'template-library', title: '试卷模板', order: 50 },
      capability: '模板创建',
      title: '创建、编辑并保存可复用的试卷模板',
      intent:
        '试卷模板先保存为可继续维护的制卷规则，用户明确填写名称和说明后保存，之后才能进入生成试卷流程。',
      preconditions: ['试卷模板库中没有需要继续编辑的本地模板。'],
      guarantees: [
        '新模板从默认名称开始，但只有明确保存后才成为可复用版本。',
        '模板名称和说明保存后从模板列表重新加载仍然存在。',
        '模板编辑器同时提供保存和生成入口，生成依据最后一次成功保存的内容。'
      ],
      guide: [{ chapter: 'build-generate-exam', order: 10 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('create-template', '从模板库新建模板并填写基本信息', async () => {
        await page.getByRole('link', { name: '试卷模板' }).click()
        await page.getByRole('button', { name: '新建模板' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名模板' })).toBeVisible()
        await page.getByRole('textbox', { name: '名称', exact: true }).fill('课堂口语练习模板')
        await page.getByRole('textbox', { name: '描述' }).fill('用于课堂口语练习的基础模板')
      })

      await productStep('save-template', '明确保存模板并确认版本状态', async () => {
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('Revision 1')).toBeVisible()
        await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'saved-template',
          kind: 'result',
          step: 'save-template',
          caption: '模板保存后显示稳定版本并关闭保存按钮'
        })
      })

      await productStep('reload-template', '返回模板库并重新进入时保留名称和说明', async () => {
        await page.getByRole('button', { name: '返回模板' }).click()
        await expect(
          page.getByRole('button', { name: '课堂口语练习模板', exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: '课堂口语练习模板', exact: true }).click()
        await expect(page.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(
          '课堂口语练习模板'
        )
        await expect(page.getByRole('textbox', { name: '描述' })).toHaveValue(
          '用于课堂口语练习的基础模板'
        )
      })
    }
  )
)
