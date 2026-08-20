import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { launchProductDocsApp } from '../../support/product-app'
import { evidence, prepareProductPage, productJourney } from '../../support/product-test'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let examPath: string
let submissionPath: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-take-exam-'))
  examPath = path.join(userDataDir, 'practice.lsexam')
  submissionPath = path.join(userDataDir, 'practice.lssubmission')
  await writeFile(examPath, await encodeExamPackage(practiceExam(), {}))

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
  ...productJourney(
    {
      id: 'EX-01',
      owner: {
        kind: 'journey',
        slug: 'exam-delivery',
        title: '运行考试并移交作答',
        order: 90
      },
      section: '考试运行与作答移交',
      title: '运行一份试卷并把作答交给评分环节',
      purpose:
        '已有可运行试卷时，从试卷库启动考试、登记作答人并保存作答包，再把本次产生的作答导入作答记录。',
      preconditions: ['本地有一份无需录音检查的可运行试卷包。'],
      outcomes: [
        '开始考试前必须填写姓名和考生号。',
        '作答完成后必须成功保存作答包才能结束考试。',
        '本次考试产生的作答包可以立即导入作答记录，并保留试卷和作答人信息。'
      ],
      manual: [{ chapter: 'run-exam', order: 20 }],
      steps: [
        {
          key: 'import-exam',
          action: '进入“试卷库”，选择“导入试卷包”，再选择要运行的试卷文件。',
          expected: '导入的试卷出现在试卷库中。'
        },
        {
          key: 'identify-candidate',
          action: '选择“开始考试”，填写作答人姓名和考生号。',
          expected: '开始作答前，页面显示本次试卷并保留作答人身份信息。'
        },
        {
          key: 'finish-exam',
          action: '选择“继续”进入播放器，并完成试卷。',
          expected: '完成页确认作答包已经保存，并提供结束考试的“完成”按钮。'
        },
        {
          key: 'return-to-library',
          action: '在完成页选择“完成”。',
          expected: '播放器关闭并返回试卷库，原试卷仍可再次使用。'
        },
        {
          key: 'handoff-submission',
          action: '进入“作答记录”，选择“导入作答包”，再选择本次考试刚刚保存的文件。',
          expected: '作答出现在“未结算”列表中，并显示刚才登记的姓名和试卷名称。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('import-exam', async () => {
        await installOpenDialog(examPath)
        await page.getByRole('link', { name: '试卷库' }).click()
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: /产品路径练习卷/ })).toBeVisible()
      })

      await productStep('identify-candidate', async () => {
        await page.getByRole('button', { name: '开始考试' }).click()
        await expect(page.getByRole('heading', { name: '产品路径练习卷' })).toBeVisible()
        await page.getByLabel('姓名').fill('林晓')
        await page.getByLabel('考生号').fill('practice-001')
        await evidence(testInfo, page, {
          key: 'candidate-identity',
          kind: 'decision',
          step: 'identify-candidate',
          caption: '开始作答前登记姓名和考生号'
        })
      })

      await productStep('finish-exam', async () => {
        await configureSaveDialog(submissionPath)
        await page.getByRole('button', { name: '继续' }).click()
        await expect(page.getByRole('heading', { name: '考试完成' })).toBeVisible()
        await expect(page.getByText('作答包已成功保存。')).toBeVisible()
        await expect(page.getByRole('button', { name: '完成' })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'submission-saved',
          kind: 'result',
          step: 'finish-exam',
          caption: '完成页确认作答包已经保存'
        })
        const submission = unzipSync(await readFile(submissionPath))
        expect(JSON.parse(strFromU8(submission['manifest.json']))).toMatchObject({
          format: 'ls101-submission',
          meta: { candidate: { displayName: '林晓' } }
        })
      })

      await productStep('return-to-library', async () => {
        await page.getByRole('button', { name: '完成' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()
        await expect(page.getByRole('cell', { name: /产品路径练习卷/ })).toBeVisible()
      })

      await productStep('handoff-submission', async () => {
        await installOpenDialog(submissionPath)
        await page.getByRole('link', { name: '作答记录' }).click()
        await page.getByRole('button', { name: '导入作答包' }).click()
        await expect(page.getByRole('tab', { name: /未结算/ })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(page.getByText('林晓', { exact: true })).toBeVisible()
        await expect(page.getByText('产品路径练习卷', { exact: true })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'submission-handoff',
          kind: 'result',
          step: 'handoff-submission',
          caption: '本次考试保存的作答已经进入作答记录'
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

async function configureSaveDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    })
  }, filePath)
}

function practiceExam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: '70000000-0000-4000-8000-000000000001',
    examData: {
      title: '产品路径练习卷',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'text-1', type: 'text', x: 10, y: 10, text: '请准备完成练习。' }],
            timeline: [{ type: 'countdown', seconds: 0 }]
          }
        ],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        examPackageId: '70000000-0000-4000-8000-000000000001',
        examTitle: '产品路径练习卷'
      },
      schemaUses: [],
      resources: {}
    }
  }
}
