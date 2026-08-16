import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productJourney } from '../../support/product-test'

const INTERFACE_NAME = '课堂讨论题型'
const INSTANCE_NAME = '校园生活第一套'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-journey-content-'))
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
  ...productJourney(
    {
      id: 'PJ-01',
      owner: {
        kind: 'journey',
        slug: 'content-preparation',
        title: '从零准备题型内容',
        order: 25
      },
      section: '题型内容准备',
      title: '从题型草稿发布稳定题型并创建可复用题组',
      purpose:
        '从全新的应用数据目录开始，通过界面定义并发布题型，再用刚发布的题型创建、保存和重新打开一套具体题组。',
      preconditions: ['没有预先创建的用户题型、题型草稿或题组。'],
      outcomes: [
        '题型草稿、稳定题型和题组都由同一条用户界面路径依次产生。',
        '刚发布的题型可以立即用于创建具体题组。',
        '题组内容保存后可以重新进入，发布题型后原草稿仍然保留。'
      ],
      manual: [{ chapter: 'prepare-content', order: 10 }],
      steps: [
        {
          key: 'create-draft',
          action: '进入“题型库”的“草稿”视图，选择“新建题型”。',
          expected: '应用打开一个未命名题型草稿。'
        },
        {
          key: 'define-contract',
          action: '填写题型名称、说明和生成要求，添加字段并保存草稿。',
          expected: '页面提示草稿已经保存，题型内容和字段契约可以继续编辑。'
        },
        {
          key: 'publish-interface',
          action: '选择“发布”，阅读发布说明后确认“发布题型”。',
          expected: '应用打开刚发布的稳定题型，并默认进入空的题组工作区。'
        },
        {
          key: 'create-instance',
          action: '选择“新建题组”，填写题组名称并选择“手工填写”。',
          expected: '应用创建题组并打开内容编辑页面。'
        },
        {
          key: 'save-and-reopen-instance',
          action: '填写题组内容并保存，然后返回题型详情并重新打开该题组。',
          expected: '重新打开后仍能看到已保存的内容，保存按钮保持不可用。'
        },
        {
          key: 'verify-retained-draft',
          action: '返回题型库，再切换到“草稿”视图。',
          expected: '已经发布的稳定题型和原题型草稿都可以分别找到。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('create-draft', async () => {
        await page.getByRole('link', { name: '题型库' }).click()
        await page.getByRole('tab', { name: '草稿' }).click()
        await page.getByRole('button', { name: '新建题型' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
      })

      await productStep('define-contract', async () => {
        const content = page.getByLabel('题型内容')
        await content.getByLabel('名称').fill(INTERFACE_NAME)
        await content.getByLabel('描述').fill('用于课堂英语讨论的可复用题型')
        await content.getByLabel('生成要求').fill('生成一个适合学生讨论校园生活的英语问题。')

        await page.getByRole('button', { name: '添加字段', exact: true }).click()
        const structure = page.getByLabel('字段结构')
        await structure.getByLabel('变量名').fill('questionText')
        await structure.getByLabel('描述').fill('需要学生回答的英语问题')
        await structure.getByLabel('示例').fill('What do you enjoy most about school?')
        await structure.getByLabel('字段标识').fill('question')
        await structure.getByLabel('字段标识').press('Tab')

        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('草稿已保存')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'saved-contract',
          kind: 'result',
          step: 'define-contract',
          caption: '题型说明、生成要求和字段契约已经保存为草稿'
        })
      })

      await productStep('publish-interface', async () => {
        await page.getByRole('button', { name: '发布', exact: true }).click()
        const confirmation = page.getByRole('alertdialog', { name: '发布当前题型草稿？' })
        await expect(confirmation).toContainText('不可直接修改的稳定题型')
        await expect(confirmation).toContainText('当前草稿仍会保留')
        await evidence(testInfo, page, {
          key: 'publish-confirmation',
          kind: 'decision',
          step: 'publish-interface',
          caption: '发布前确认稳定题型与原草稿的关系'
        })
        await confirmation.getByRole('button', { name: '发布题型' }).click()

        await expect(page.getByRole('heading', { level: 1, name: INTERFACE_NAME })).toBeVisible()
        await expect(page.getByRole('tab', { name: '题组', selected: true })).toBeVisible()
        await expect(page.getByText('暂无题组')).toBeVisible()
      })

      await productStep('create-instance', async () => {
        await page.getByRole('button', { name: '新建题组' }).click()
        const dialog = page.getByRole('dialog', { name: '新建题组' })
        await dialog.getByLabel('题组名称').fill(INSTANCE_NAME)
        await dialog.getByLabel('手工填写').check()
        await dialog.getByRole('button', { name: '创建题组' }).click()
        await expect(page.getByRole('heading', { level: 1, name: INSTANCE_NAME })).toBeVisible()
      })

      await productStep('save-and-reopen-instance', async () => {
        await page.getByLabel('question 内容').fill('What do you enjoy most about school?')
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('题组已保存')).toBeVisible()

        await page.getByRole('button', { name: '返回题型详情' }).click()
        await expect(page.getByRole('button', { name: INSTANCE_NAME, exact: true })).toBeVisible()
        await page.getByRole('button', { name: INSTANCE_NAME, exact: true }).click()
        await expect(page.getByLabel('question 内容')).toHaveValue(
          'What do you enjoy most about school?'
        )
        await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'reopened-instance',
          kind: 'result',
          step: 'save-and-reopen-instance',
          caption: '刚发布的题型保存了一套可重新打开的具体题组'
        })
      })

      await productStep('verify-retained-draft', async () => {
        await page.getByRole('button', { name: '返回题型详情' }).click()
        await page.getByRole('button', { name: '返回题型' }).click()
        await expect(page.getByRole('button', { name: INTERFACE_NAME, exact: true })).toBeVisible()
        await page.getByRole('tab', { name: '草稿' }).click()
        await expect(page.getByRole('button', { name: INTERFACE_NAME, exact: true })).toBeVisible()
      })
    }
  )
)
