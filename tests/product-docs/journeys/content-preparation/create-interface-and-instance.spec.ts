import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import {
  evidence,
  prepareProductPage,
  productJourney,
  productStep
} from '../../support/product-test'

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
      capability: '题型内容准备',
      title: '从题型草稿发布稳定题型并创建可复用题组',
      intent:
        '从全新的应用数据目录开始，通过界面定义并发布题型，再用刚发布的题型创建、保存和重新打开一套具体题组。',
      preconditions: ['没有预先创建的用户题型、题型草稿或题组。'],
      guarantees: [
        '题型草稿、稳定题型和题组都由同一条用户界面路径依次产生。',
        '后续题组使用本次旅程刚发布的题型，不以测试夹具替换中间产物。',
        '题组内容保存后可以重新进入，发布题型后原草稿仍然保留。'
      ],
      guide: [{ chapter: 'prepare-content', order: 10 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('create-draft', '从题型库草稿视图新建题型', async () => {
        await page.getByRole('link', { name: '题型库' }).click()
        await page.getByRole('tab', { name: '草稿' }).click()
        await page.getByRole('button', { name: '新建题型' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
      })

      await productStep(
        'define-contract',
        '填写题型说明、生成要求和字段契约并保存草稿',
        async () => {
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
        }
      )

      await productStep('publish-interface', '确认发布稳定题型并进入题组工作区', async () => {
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

      await productStep('create-instance', '使用刚发布的题型命名创建手工填写题组', async () => {
        await page.getByRole('button', { name: '新建题组' }).click()
        const dialog = page.getByRole('dialog', { name: '新建题组' })
        await dialog.getByLabel('题组名称').fill(INSTANCE_NAME)
        await dialog.getByLabel('手工填写').check()
        await dialog.getByRole('button', { name: '创建题组' }).click()
        await expect(page.getByRole('heading', { level: 1, name: INSTANCE_NAME })).toBeVisible()
      })

      await productStep(
        'save-and-reopen-instance',
        '填写题组内容，保存后从题型详情重新进入',
        async () => {
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
        }
      )

      await productStep(
        'verify-retained-draft',
        '返回题型库确认发布后的原草稿仍然保留',
        async () => {
          await page.getByRole('button', { name: '返回题型详情' }).click()
          await page.getByRole('button', { name: '返回题型' }).click()
          await expect(
            page.getByRole('button', { name: INTERFACE_NAME, exact: true })
          ).toBeVisible()
          await page.getByRole('tab', { name: '草稿' }).click()
          await expect(
            page.getByRole('button', { name: INTERFACE_NAME, exact: true })
          ).toBeVisible()
        }
      )
    }
  )
)
