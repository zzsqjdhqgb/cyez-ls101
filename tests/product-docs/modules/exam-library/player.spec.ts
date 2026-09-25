import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { encodeExamPackage } from '@ls101/exam-package'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { productExam } from '../../support/exam-fixtures'
import { launchProductDocsApp } from '../../support/product-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

const EXAM_TITLE = '长时间听说练习卷'
const EXAM_PACKAGE_ID = '71000000-0000-4000-8000-000000000002'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let examPath: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-exam-player-'))
  examPath = path.join(userDataDir, 'long.lsexam')
  await writeFile(
    examPath,
    await encodeExamPackage(
      productExam({
        packageId: EXAM_PACKAGE_ID,
        title: EXAM_TITLE,
        countdownSeconds: 300
      }),
      {}
    )
  )
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
      id: 'EL-05',
      owner: { kind: 'module', slug: 'exam-library', title: '试卷库', order: 20 },
      section: '考试运行',
      title: '退出考试前确认并放弃本次进度',
      purpose:
        '考试运行中退出不会生成作答包，因此必须先经过退出确认；选择继续考试会保持当前进度，确认退出才返回试卷库。',
      preconditions: ['试卷库中有一份需要较长时间作答的可运行试卷。'],
      outcomes: [
        '任何阶段的“退出”都会先打开退出确认对话框。',
        '选择“继续考试”关闭对话框并保留当前进度。',
        '选择“确认退出”放弃本次进度并返回试卷库，试卷仍可再次使用。'
      ],
      manual: [{ chapter: 'run-exam', order: 30 }],
      steps: [
        {
          key: 'import-exam',
          action: '进入“试卷库”，选择“导入试卷包”，选中一份需要较长时间作答的试卷文件。',
          expected: '试卷出现在试卷库列表中。'
        },
        {
          key: 'start-exam',
          action: '选择“开始考试”，填写作答人姓名和考生号，再选择“继续”。',
          expected: '播放器进入作答页并显示页码与“退出”按钮。'
        },
        {
          key: 'continue-exam',
          action: '选择“退出”，在确认对话框中选择“继续考试”。',
          expected: '确认对话框关闭，页面停留在当前作答进度。'
        },
        {
          key: 'confirm-exit',
          action: '再次选择“退出”，并选择“确认退出”。',
          expected: '应用放弃当前进度并返回试卷库，原试卷仍在列表中。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('import-exam', async () => {
        await installOpenDialog(examPath)
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
      })

      await productStep('start-exam', async () => {
        await page.getByRole('button', { name: '开始考试' }).click()
        await expect(page.getByRole('heading', { name: EXAM_TITLE })).toBeVisible()
        await page.getByLabel('姓名').fill('林晓')
        await page.getByLabel('考生号').fill('practice-exit')
        await page.getByRole('button', { name: '继续' }).click()
        await expect(page.getByText('第 1 / 1 页')).toBeVisible()
        await expect(page.getByRole('button', { name: '退出', exact: true })).toBeVisible()
      })

      await productStep('continue-exam', async () => {
        await page.getByRole('button', { name: '退出', exact: true }).click()
        const confirmation = page.getByRole('dialog', { name: '退出考试？' })
        await expect(confirmation).toContainText('当前考试进度不会生成作答包。')
        await confirmation.getByRole('button', { name: '继续考试' }).click()
        await expect(confirmation).toBeHidden()
        await expect(page.getByText('第 1 / 1 页')).toBeVisible()
      })

      await productStep('confirm-exit', async () => {
        await page.getByRole('button', { name: '退出', exact: true }).click()
        const confirmation = page.getByRole('dialog', { name: '退出考试？' })
        await evidence(testInfo, page, {
          key: 'exit-confirmation',
          kind: 'decision',
          step: 'confirm-exit',
          caption: '退出考试前必须确认放弃本次进度'
        })
        await confirmation.getByRole('button', { name: '确认退出' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
      })
    }
  )
)

async function installOpenDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] })
    })
  }, filePath)
}
