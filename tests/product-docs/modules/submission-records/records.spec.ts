import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { strFromU8, unzipSync } from 'fflate'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchProductDocsApp } from '../../support/product-app'
import {
  mixedSubmission,
  objectiveSubmission,
  readingSubmission
} from '../../support/submission-fixtures'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

const EXAM_TITLE = '八年级英语听说练习'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let objectivePath: string
let readingPath: string
let mixedPath: string
let exportPath: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-records-'))
  objectivePath = path.join(userDataDir, 'objective.lssubmission')
  readingPath = path.join(userDataDir, 'reading.lssubmission')
  mixedPath = path.join(userDataDir, 'mixed.lssubmission')
  exportPath = path.join(userDataDir, 'exported.lssubmission')
  await writeFile(objectivePath, await encodeSubmissionPackage(objectiveSubmission(), {}))
  await writeFile(
    readingPath,
    await encodeSubmissionPackage(readingSubmission(), {
      'answer-audio-0': new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
    })
  )
  await writeFile(
    mixedPath,
    await encodeSubmissionPackage(mixedSubmission(), {
      'answer-audio-0': new Uint8Array([82, 73, 70, 70, 5, 6, 7, 8])
    })
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
      id: 'SR-02',
      owner: { kind: 'module', slug: 'submission-records', title: '作答记录', order: 30 },
      section: '单条评分',
      title: '用行内入口开始、继续评分并进入结算',
      purpose:
        '列表中的每条作答都可以单独开始评分；评分进度保留后行内按钮从“开始评分”变为“继续评分”，全部评分完成后变为“进入结算”。',
      preconditions: ['本地有一份同时包含客观题和需要人工评分的朗读题的作答包。'],
      outcomes: [
        '单条作答可以从行内“开始评分”进入评分会话，不需要先勾选。',
        '暂停后评分进度保留，行内按钮变为“继续评分”。',
        '全部评分单元完成后行内按钮变为“进入结算”，据此确认结算批次。'
      ],
      manual: [{ chapter: 'grade-settle', order: 10 }],
      steps: [
        {
          key: 'import-submission',
          action: '进入“作答记录”，导入一份同时包含客观题和朗读题的作答包。',
          expected: '作答出现在“未结算”列表中，进度为“未评分”，行内按钮为“开始评分”。'
        },
        {
          key: 'start-single-grading',
          action:
            '选择该行的“开始评分”，在评分方式中选择“人工评分”，进入朗读题后选择“暂停并返回”。',
          expected: '该作答显示为“评分中”，行内按钮变为“继续评分”。'
        },
        {
          key: 'resume-single-grading',
          action:
            '选择“继续评分”，在评分方式中再次选择“人工评分”，填写分数和评语并选择“提交本题”。',
          expected: '全部评分单元完成后应用进入“评分结算”页面。'
        },
        {
          key: 'defer-settlement',
          action: '在评分结算页面选择“下次结算”。',
          expected: '应用返回未结算列表，该作答显示为“可结算”，行内按钮变为“进入结算”。'
        },
        {
          key: 'enter-settlement',
          action: '选择“进入结算”，并在评分结算页面选择“本次结算”。',
          expected: '应用切换到“已结算”视图，该作答归入本批次。'
        }
      ]
    },
    async (testInfo, productStep) => {
      test.setTimeout(60_000)

      await productStep('import-submission', async () => {
        await openSubmissionRecords()
        await importSubmission(mixedPath, '李华')
        const row = rowFor('李华')
        await expect(row.getByText('未评分', { exact: true })).toBeVisible()
        await expect(row.getByRole('button', { name: '开始评分', exact: true })).toBeVisible()
      })

      await productStep('start-single-grading', async () => {
        await rowFor('李华').getByRole('button', { name: '开始评分', exact: true }).click()
        await expect(page.getByRole('heading', { name: '选择评分方式' })).toBeVisible()
        await page.getByRole('button', { name: '人工评分' }).click()
        await expect(page.getByText('请朗读句子。')).toBeVisible()
        await page.getByRole('button', { name: '暂停并返回' }).click()

        const row = rowFor('李华')
        await expect(row.getByText('评分中', { exact: true })).toBeVisible()
        await expect(row.getByRole('button', { name: '继续评分', exact: true })).toBeVisible()
      })

      await productStep('resume-single-grading', async () => {
        await rowFor('李华').getByRole('button', { name: '继续评分', exact: true }).click()
        await expect(page.getByRole('heading', { name: '选择评分方式' })).toBeVisible()
        await page.getByRole('button', { name: '人工评分' }).click()
        await expect(page.getByText('请朗读句子。')).toBeVisible()
        await page.getByLabel('分数').fill('4.5')
        await page.getByLabel('评语').fill('发音清晰，节奏自然。')
        await page.getByRole('button', { name: '提交本题' }).click()
        await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
      })

      await productStep('defer-settlement', async () => {
        await page.getByRole('button', { name: '下次结算' }).click()
        const row = rowFor('李华')
        await expect(row.getByText('可结算', { exact: true })).toBeVisible()
        await expect(row.getByRole('button', { name: '进入结算', exact: true })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'single-row-ready',
          kind: 'result',
          step: 'defer-settlement',
          caption: '单条作答全部评分完成后行内按钮变为“进入结算”'
        })
      })

      await productStep('enter-settlement', async () => {
        await rowFor('李华').getByRole('button', { name: '进入结算', exact: true }).click()
        await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
        await page.getByRole('button', { name: '本次结算（1）' }).click()
        await expect(page.getByRole('tab', { name: /已结算/ })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(page.getByText('李华', { exact: true })).toBeVisible()
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'SR-03',
      owner: { kind: 'module', slug: 'submission-records', title: '作答记录', order: 30 },
      section: '评分报告',
      title: '查看已结算作答的评分报告',
      purpose:
        '只有已结算的作答可以生成评分报告；报告在对话框内展示总分、逐题分数、评语和答题详情，不产生文件。',
      preconditions: ['作答记录中有一条已结算的作答。'],
      outcomes: [
        '“查看报告”为已结算作答生成并展示评分报告。',
        '报告包含作答人与试卷、总分以及逐题分数和答题详情。',
        '关闭报告后回到已结算列表，列表不变。'
      ],
      manual: [{ chapter: 'grade-settle', order: 30 }],
      steps: [
        {
          key: 'view-report',
          action: '在“已结算”视图中选择该作答的“查看报告”。',
          expected: '应用打开“评分报告”对话框，并显示作答人、试卷与逐题结果。'
        },
        {
          key: 'close-report',
          action: '选择“关闭报告”。',
          expected: '对话框关闭，回到已结算列表。'
        }
      ]
    },
    async (testInfo, productStep) => {
      test.setTimeout(60_000)

      await openSubmissionRecords()
      await importSubmission(objectivePath, '赵宁')
      await settleObjectiveRecord()

      await productStep('view-report', async () => {
        await rowFor('赵宁').getByRole('button', { name: '查看报告' }).click()
        const dialog = page.getByRole('dialog', { name: '评分报告' })
        await expect(dialog).toContainText(`赵宁 · ${EXAM_TITLE}`)
        await expect(dialog.getByRole('heading', { name: /第 1 题/ })).toBeVisible()
        await expect(dialog).toContainText('正确答案：A')
        await evidence(testInfo, page, {
          key: 'settled-report',
          kind: 'result',
          step: 'view-report',
          caption: '已结算作答的评分报告在对话框内展示逐题结果'
        })
      })

      await productStep('close-report', async () => {
        await page.getByRole('button', { name: '关闭报告' }).click()
        await expect(page.getByRole('dialog', { name: '评分报告' })).toBeHidden()
        await expect(rowFor('赵宁')).toBeVisible()
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'SR-04',
      owner: { kind: 'module', slug: 'submission-records', title: '作答记录', order: 30 },
      section: '作答包导出',
      title: '把作答记录导出为作答包文件',
      purpose:
        '导出让用户把已导入的原始作答包另存为文件；取消保存对话框不会改动列表，也不会提示错误。',
      preconditions: ['作答记录中有一条未结算作答。'],
      outcomes: [
        '选择“导出作答包”打开系统保存对话框。',
        '取消保存不提示、不报错，记录仍在列表中。',
        '确认保存后提示“作答包已导出”，并写出包含原始作答的作答包文件。'
      ],
      manual: [{ chapter: 'grade-settle', order: 40 }],
      steps: [
        {
          key: 'cancel-export',
          action: '选择该行的“导出作答包”，在保存对话框中取消。',
          expected: '列表保持不变，也不显示错误提示。'
        },
        {
          key: 'export-submission',
          action: '再次选择“导出作答包”，并确认保存位置。',
          expected: '页面提示“作答包已导出”，并在所选位置写出一份作答包文件。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await openSubmissionRecords()
      await importSubmission(objectivePath, '赵宁')

      await productStep('cancel-export', async () => {
        await installCanceledSaveDialog()
        await rowFor('赵宁').getByRole('button', { name: '导出作答包' }).click()
        await expect(page.getByText('作答包已导出')).toHaveCount(0)
        await expect(page.getByRole('alert')).toHaveCount(0)
        await expect(rowFor('赵宁')).toBeVisible()
      })

      await productStep('export-submission', async () => {
        await installSaveDialog(exportPath)
        await rowFor('赵宁').getByRole('button', { name: '导出作答包' }).click()
        await expect(page.getByText('作答包已导出')).toBeVisible()
        const archive = unzipSync(await readFile(exportPath))
        expect(JSON.parse(strFromU8(archive['manifest.json']))).toMatchObject({
          format: 'ls101-submission',
          meta: { candidate: { displayName: '赵宁' } }
        })
        await evidence(testInfo, page, {
          key: 'submission-exported',
          kind: 'result',
          step: 'export-submission',
          caption: '确认保存后提示作答包已导出'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'SR-05',
      owner: { kind: 'module', slug: 'submission-records', title: '作答记录', order: 30 },
      section: '作答记录删除',
      title: '删除未结算与已结算的作答记录',
      purpose: '删除作答记录不可逆，未结算和已结算的确认文案分别说明后果；取消后记录保持不变。',
      preconditions: ['作答记录中有一条未结算作答和一条已结算作答。'],
      outcomes: [
        '删除未结算记录前的确认文案说明会移除原始作答包与已有评分进度。',
        '删除已结算记录前的确认文案说明还会移除评分结果和报告。',
        '取消删除不改动列表，确认删除后记录从对应视图消失。'
      ],
      manual: [{ chapter: 'grade-settle', order: 50 }],
      steps: [
        {
          key: 'open-unsettled-delete',
          action: '切换到“未结算”，选择未结算作答的“删除作答记录”。',
          expected: '确认对话框说明删除会移除原始作答包和已有评分进度。'
        },
        {
          key: 'cancel-delete-unsettled',
          action: '选择“取消”。',
          expected: '对话框关闭，该作答仍在未结算列表中。'
        },
        {
          key: 'confirm-delete-unsettled',
          action: '再次选择“删除作答记录”，并选择“删除”。',
          expected: '提示删除成功，未结算列表不再显示该作答。'
        },
        {
          key: 'open-settled-delete',
          action: '切换到“已结算”，选择已结算作答的“删除作答记录”。',
          expected: '确认对话框说明删除还会移除评分结果和报告。'
        },
        {
          key: 'cancel-delete-settled',
          action: '选择“取消”。',
          expected: '对话框关闭，该作答仍在已结算批次中。'
        },
        {
          key: 'confirm-delete-settled',
          action: '再次选择“删除作答记录”，并选择“删除”。',
          expected: '提示删除成功，已结算视图显示空状态。'
        }
      ]
    },
    async (testInfo, productStep) => {
      test.setTimeout(60_000)

      await openSubmissionRecords()
      await importSubmission(objectivePath, '赵宁')
      await importSubmission(readingPath, '张明')
      await settleObjectiveRecord()

      await productStep('open-unsettled-delete', async () => {
        await page.getByRole('tab', { name: /未结算/ }).click()
        await rowFor('张明').getByRole('button', { name: '删除作答记录' }).click()
        const dialog = page.getByRole('alertdialog', { name: '删除 张明 的作答记录？' })
        await expect(dialog).toContainText(
          '删除后，原始作答包和已有评分进度都会被移除。此操作无法撤销。'
        )
      })

      await productStep('cancel-delete-unsettled', async () => {
        const dialog = page.getByRole('alertdialog', { name: '删除 张明 的作答记录？' })
        await dialog.getByRole('button', { name: '取消' }).click()
        await expect(dialog).toBeHidden()
        await expect(rowFor('张明')).toBeVisible()
      })

      await productStep('confirm-delete-unsettled', async () => {
        await rowFor('张明').getByRole('button', { name: '删除作答记录' }).click()
        const dialog = page.getByRole('alertdialog', { name: '删除 张明 的作答记录？' })
        await dialog.getByRole('button', { name: '删除', exact: true }).click()
        await expect(page.getByText('已删除 张明 的作答记录')).toBeVisible()
        await expect(page.getByText('没有未结算作答')).toBeVisible()
      })

      await productStep('open-settled-delete', async () => {
        await page.getByRole('tab', { name: /已结算/ }).click()
        await rowFor('赵宁').getByRole('button', { name: '删除作答记录' }).click()
        const dialog = page.getByRole('alertdialog', { name: '删除 赵宁 的作答记录？' })
        await expect(dialog).toContainText(
          '删除后，原始作答包、评分结果和报告都会被移除。此操作无法撤销。'
        )
      })

      await productStep('cancel-delete-settled', async () => {
        const dialog = page.getByRole('alertdialog', { name: '删除 赵宁 的作答记录？' })
        await dialog.getByRole('button', { name: '取消' }).click()
        await expect(dialog).toBeHidden()
        await expect(rowFor('赵宁')).toBeVisible()
      })

      await productStep('confirm-delete-settled', async () => {
        await rowFor('赵宁').getByRole('button', { name: '删除作答记录' }).click()
        const dialog = page.getByRole('alertdialog', { name: '删除 赵宁 的作答记录？' })
        await dialog.getByRole('button', { name: '删除', exact: true }).click()
        await expect(page.getByText('已删除 赵宁 的作答记录')).toBeVisible()
        await expect(page.getByText('还没有已结算作答')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'settled-deleted',
          kind: 'result',
          step: 'confirm-delete-settled',
          caption: '删除已结算作答后已结算视图回到空状态'
        })
      })
    }
  )
)

function rowFor(candidateName: string): Locator {
  return page.getByRole('row').filter({ hasText: candidateName })
}

async function openSubmissionRecords(): Promise<void> {
  await page.getByRole('link', { name: '作答记录', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '作答记录' })).toBeVisible()
}

async function importSubmission(filePath: string, candidateName: string): Promise<void> {
  await installOpenDialog(filePath)
  await page.getByRole('button', { name: '导入作答包' }).click()
  await expect(page.getByText(candidateName, { exact: true })).toBeVisible()
}

async function settleObjectiveRecord(): Promise<void> {
  await rowFor('赵宁').getByRole('button', { name: '开始评分', exact: true }).click()
  await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
  await page.getByRole('button', { name: '本次结算（1）' }).click()
  await expect(page.getByRole('tab', { name: /已结算/ })).toHaveAttribute('aria-selected', 'true')
}

async function installOpenDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] })
    })
  }, filePath)
}

async function installSaveDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    })
  }, filePath)
}

async function installCanceledSaveDialog(): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: true, filePath: undefined })
    })
  })
}
