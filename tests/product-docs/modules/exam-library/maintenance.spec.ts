import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { encodeExamPackage } from '@ls101/exam-package'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { productExam } from '../../support/exam-fixtures'
import { launchProductDocsApp } from '../../support/product-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

const EXAM_TITLE = '产品文档示例卷'
const EXAM_PACKAGE_ID = '71000000-0000-4000-8000-000000000001'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let examPath: string
let brokenPath: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-exam-library-'))
  examPath = path.join(userDataDir, 'sample.lsexam')
  brokenPath = path.join(userDataDir, 'broken.lsexam')
  await writeFile(
    examPath,
    await encodeExamPackage(productExam({ packageId: EXAM_PACKAGE_ID, title: EXAM_TITLE }), {})
  )
  await writeFile(brokenPath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
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
      id: 'EL-01',
      owner: { kind: 'module', slug: 'exam-library', title: '试卷库', order: 20 },
      section: '试卷导入',
      title: '重复导入同一份试卷并取消导入',
      purpose: '试卷库用试卷包编号和内容判断重复导入；用户取消文件选择时，列表和提示都不发生变化。',
      preconditions: ['本地有一份已经导入试卷库的试卷和同一份试卷包文件。'],
      outcomes: [
        '重复导入同一份试卷包不会新增列表记录，并提示该试卷包已经在考试库中。',
        '取消文件选择不会改动列表，也不会显示错误提示。'
      ],
      manual: [{ chapter: 'run-exam', order: 10 }],
      steps: [
        {
          key: 'import-exam',
          action: '进入“试卷库”，选择“导入试卷包”，选中一份可运行的试卷文件。',
          expected: '试卷出现在试卷库列表中。'
        },
        {
          key: 'duplicate-import',
          action: '再次选择“导入试卷包”，选中同一个试卷文件。',
          expected: '页面提示“该试卷包已经在考试库中”，列表不新增试卷。'
        },
        {
          key: 'cancel-import',
          action: '再次选择“导入试卷包”，在文件选择框中取消。',
          expected: '列表保持不变，也不显示错误提示。'
        }
      ]
    },
    async (_testInfo, productStep) => {
      await productStep('import-exam', async () => {
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await installOpenDialog(examPath)
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
        await expect(page.getByRole('button', { name: '导入试卷包' })).toBeEnabled()
      })

      await productStep('duplicate-import', async () => {
        await installOpenDialog(examPath)
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByText('该试卷包已经在考试库中')).toBeVisible()
        await expect(page.getByRole('row')).toHaveCount(2)
      })

      await productStep('cancel-import', async () => {
        await installCanceledOpenDialog()
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('button', { name: '导入试卷包' })).toBeEnabled()
        await expect(page.getByRole('row')).toHaveCount(2)
        await expect(page.getByRole('alert')).toHaveCount(0)
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'EL-02',
      owner: { kind: 'module', slug: 'exam-library', title: '试卷库', order: 20 },
      section: '试卷导入',
      title: '导入损坏的试卷包并在提示后重试',
      purpose:
        '导入失败只显示原因并保留列表中已有内容，用户可以修正文件后重新导入，不需要重新进入页面。',
      preconditions: ['本地试卷库为空，另有一份损坏的试卷包文件和一份正常试卷包文件。'],
      outcomes: [
        '空试卷库显示“暂无试卷”，不提供页内快捷导入入口。',
        '导入损坏文件时页头下方显示带告警图标的错误条，列表保持为空。',
        '重新导入正常文件后试卷进入列表。'
      ],
      manual: [{ chapter: 'run-exam', order: 11 }],
      steps: [
        {
          key: 'open-library',
          action: '在没有任何试卷时进入“试卷库”。',
          expected: '内容区显示“暂无试卷”。'
        },
        {
          key: 'import-broken',
          action: '选择“导入试卷包”，选中一个损坏的试卷文件。',
          expected: '页头下方显示“无法导入试卷包”的错误条，列表仍为空。'
        },
        {
          key: 'retry-import',
          action: '再次选择“导入试卷包”，选中一份正常的试卷文件。',
          expected: '试卷成功导入并出现在列表中。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('open-library', async () => {
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await expect(page.getByText('暂无试卷')).toBeVisible()
      })

      await productStep('import-broken', async () => {
        await installOpenDialog(brokenPath)
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('alert')).toContainText('无法导入试卷包')
        await expect(page.getByText('暂无试卷')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'broken-import-error',
          kind: 'exception',
          step: 'import-broken',
          caption: '导入损坏的试卷包后提示区显示失败原因，列表保持为空'
        })
      })

      await productStep('retry-import', async () => {
        await installOpenDialog(examPath)
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'EL-03',
      owner: { kind: 'module', slug: 'exam-library', title: '试卷库', order: 20 },
      section: '试卷库状态',
      title: '查看空试卷库并识别查询失败提示',
      purpose:
        '没有试卷时展示空状态；本地数据损坏导致查询失败时，页头下方显示错误条且不渲染试卷表格，重新进入页面会再次查询。',
      preconditions: ['本地试卷库为空，之后本地保存的试卷库数据会被破坏。'],
      outcomes: [
        '空试卷库显示“暂无试卷”。',
        '数据损坏时页头下方显示“考试库数据损坏”的错误条，试卷表格不渲染。'
      ],
      manual: [{ chapter: 'run-exam', order: 12 }],
      steps: [
        {
          key: 'open-empty-library',
          action: '在没有任何试卷时进入“试卷库”。',
          expected: '内容区显示“暂无试卷”。'
        },
        {
          key: 'reopen-corrupted-library',
          action: '在本地试卷库数据损坏后重新进入“试卷库”。',
          expected: '页头下方显示带告警图标的“考试库数据损坏”错误条，试卷表格不渲染。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('open-empty-library', async () => {
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await expect(page.getByText('暂无试卷')).toBeVisible()
      })

      await productStep('reopen-corrupted-library', async () => {
        await mkdir(path.join(userDataDir, 'data', 'exam-library', 'exams', 'not-a-checksum'), {
          recursive: true
        })
        await page.getByRole('link', { name: '作答记录', exact: true }).click()
        await expect(page.getByRole('heading', { level: 1, name: '作答记录' })).toBeVisible()
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await expect(page.getByRole('alert')).toContainText('考试库数据损坏')
        await expect(page.getByRole('table')).toHaveCount(0)
        await evidence(testInfo, page, {
          key: 'corrupted-library-error',
          kind: 'exception',
          step: 'reopen-corrupted-library',
          caption: '本地数据损坏时只显示错误条，试卷列表不渲染'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'EL-04',
      owner: { kind: 'module', slug: 'exam-library', title: '试卷库', order: 20 },
      section: '试卷删除',
      title: '确认后删除试卷并保留取消分支',
      purpose:
        '删除试卷会同时移除本地保存的原始试卷包，属于不可逆操作，必须经过二次确认；取消后试卷保持不变。',
      preconditions: ['试卷库中有一份可以删除的试卷。'],
      outcomes: [
        '删除前必须经过确认对话框，取消后试卷仍在列表中。',
        '确认删除后试卷从列表消失，试卷库回到空状态。'
      ],
      manual: [{ chapter: 'run-exam', order: 13 }],
      steps: [
        {
          key: 'import-exam',
          action: '进入“试卷库”，选择“导入试卷包”，选中一份可运行的试卷文件。',
          expected: '试卷出现在试卷库列表中。'
        },
        {
          key: 'cancel-delete',
          action: '选择这份试卷的“删除试卷”，阅读确认说明后选择“取消”。',
          expected: '确认对话框关闭，试卷仍在列表中。'
        },
        {
          key: 'confirm-delete',
          action: '再次选择“删除试卷”，并选择“删除”。',
          expected: '提示删除成功，列表刷新为空状态。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('import-exam', async () => {
        await page.getByRole('link', { name: '试卷库', exact: true }).click()
        await installOpenDialog(examPath)
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
      })

      await productStep('cancel-delete', async () => {
        await page.getByRole('button', { name: '删除试卷' }).click()
        const confirmation = page.getByRole('alertdialog', {
          name: `删除试卷“${EXAM_TITLE}”？`
        })
        await expect(confirmation).toContainText(
          '删除后，本地保存的原始试卷包也会一并移除。此操作无法撤销。'
        )
        await confirmation.getByRole('button', { name: '取消' }).click()
        await expect(confirmation).toBeHidden()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_TITLE) })).toBeVisible()
      })

      await productStep('confirm-delete', async () => {
        await page.getByRole('button', { name: '删除试卷' }).click()
        const confirmation = page.getByRole('alertdialog', {
          name: `删除试卷“${EXAM_TITLE}”？`
        })
        await confirmation.getByRole('button', { name: '删除', exact: true }).click()
        await expect(page.getByText(`已删除试卷“${EXAM_TITLE}”`)).toBeVisible()
        await expect(page.getByText('暂无试卷')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'exam-deleted',
          kind: 'result',
          step: 'confirm-delete',
          caption: '确认删除后试卷从列表消失，试卷库回到空状态'
        })
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

async function installCanceledOpenDialog(): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: true, filePaths: [] })
    })
  })
}
