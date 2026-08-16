import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productStep, productTest } from '../../support/product-test'

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
      id: 'EX-01',
      owner: { kind: 'flow', slug: 'take-exam', title: '运行试卷并保存作答包', order: 90 },
      capability: '考试运行',
      title: '从试卷库登记作答人并保存完成后的作答包',
      intent:
        '试卷库中的试卷通过沉浸式播放器运行；完成后将自包含作答包保存到本地，之后才能在作答记录中导入并评分。',
      preconditions: ['试卷库中已有一份无需录音检查的可运行试卷。'],
      guarantees: [
        '开始考试前必须填写姓名和考生号。',
        '作答完成后必须成功保存作答包才能结束考试。',
        '关闭播放器后返回试卷库，作答包文件可以独立导入作答记录。'
      ],
      guide: [{ chapter: 'run-exam', order: 20 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('import-exam', '把可运行试卷导入试卷库', async () => {
        await installOpenDialog(examPath)
        await page.getByRole('link', { name: '试卷库' }).click()
        await page.getByRole('button', { name: '导入试卷包' }).click()
        await expect(page.getByRole('cell', { name: /产品路径练习卷/ })).toBeVisible()
      })

      await productStep('identify-candidate', '从试卷库开始考试并填写作答人姓名', async () => {
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

      await productStep('finish-exam', '继续进入播放器并完成无录音试卷', async () => {
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

      await productStep('return-to-library', '关闭完成页后回到试卷库', async () => {
        await page.getByRole('button', { name: '完成' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '试卷库' })).toBeVisible()
        await expect(page.getByRole('cell', { name: /产品路径练习卷/ })).toBeVisible()
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
