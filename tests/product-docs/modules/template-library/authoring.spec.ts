import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

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
      section: '模板创建',
      title: '创建、编辑并保存可复用的试卷模板',
      purpose:
        '试卷模板先保存为可继续维护的制卷规则，用户明确填写名称和说明后保存，之后才能进入生成试卷流程。',
      preconditions: ['试卷模板库中没有需要继续编辑的本地模板。'],
      outcomes: [
        '新模板从默认名称开始，但只有明确保存后才成为可复用版本。',
        '模板名称和说明保存后从模板列表重新加载仍然存在。',
        '模板编辑器同时提供保存和生成入口，生成依据最后一次成功保存的内容。'
      ],
      manual: [{ chapter: 'build-generate-exam', order: 10 }],
      steps: [
        {
          key: 'create-template',
          action: '进入“试卷模板”，选择“新建模板”，填写模板名称和说明。',
          expected: '模板编辑器显示填写后的基本信息，并等待保存。'
        },
        {
          key: 'save-template',
          action: '选择“保存”。',
          expected: '模板显示新的修订版本，保存按钮变为不可用。'
        },
        {
          key: 'reload-template',
          action: '返回模板库，再次打开刚刚保存的模板。',
          expected: '模板名称和说明保持不变，可以继续编辑或进入生成流程。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('create-template', async () => {
        await page.getByRole('link', { name: '试卷模板' }).click()
        await page.getByRole('button', { name: '新建模板' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名模板' })).toBeVisible()
        await page.getByRole('textbox', { name: '名称', exact: true }).fill('课堂口语练习模板')
        await page.getByRole('textbox', { name: '描述' }).fill('用于课堂口语练习的基础模板')
      })

      await productStep('save-template', async () => {
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

      await productStep('reload-template', async () => {
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
