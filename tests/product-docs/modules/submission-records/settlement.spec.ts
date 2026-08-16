import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productStep, productTest } from '../../support/product-test'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let objectivePath: string
let readingPath: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-settlement-'))
  objectivePath = path.join(userDataDir, 'objective.lssubmission')
  readingPath = path.join(userDataDir, 'reading.lssubmission')
  await writeFile(objectivePath, await encodeSubmissionPackage(objectiveSubmission(), {}))
  await writeFile(
    readingPath,
    await encodeSubmissionPackage(readingSubmission(), {
      'answer-audio-0': new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4])
    })
  )

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
      id: 'SR-01',
      owner: { kind: 'module', slug: 'submission-records', title: '作答记录', order: 30 },
      capability: '评分结算',
      title: '批量评分作答并在确认后结算为一个批次',
      intent:
        '作答记录分为未结算和已结算。用户可以批量评分、暂缓结算并保留进度，也可以将全部评分完成的作答原子结算为一个批次。',
      preconditions: ['本地有一份客观题作答包和一份需要人工评分的朗读作答包。'],
      guarantees: [
        '批量评分按照一次会话推进，并在结束后进入独立结算页。',
        '下次结算会保留评分进度，本次结算会原子创建一个批次。',
        '重新评分只重置目标作答，不改写原始作答内容。'
      ],
      guide: [{ chapter: 'grade-settle', order: 20 }]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
    async ({}, testInfo) => {
      await productStep('import-submissions', '从作答记录独立入口导入两份作答包', async () => {
        await page.getByRole('link', { name: '作答记录' }).click()
        await installOpenDialog([objectivePath, readingPath])
        await page.getByRole('button', { name: '导入作答包' }).click()
        await expect(page.getByText('赵宁', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: '导入作答包' }).click()
        await expect(page.getByText('张明', { exact: true })).toBeVisible()

        await expect(page.getByRole('tab', { name: /未结算/ })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await evidence(testInfo, page, {
          key: 'unsettled-list',
          kind: 'result',
          step: 'import-submissions',
          caption: '导入后的作答统一进入未结算列表'
        })
      })

      await productStep('grade-selection', '勾选多条记录后按顺序进入一次评分会话', async () => {
        await page.getByRole('checkbox', { name: '全选' }).check()
        await page.getByRole('button', { name: '开始评分（2）' }).click()

        await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
        await page.getByRole('button', { name: '人工评分' }).click()
        await expect(page.getByText('请朗读句子。')).toBeVisible()
        await page.getByLabel('分数').fill('4.5')
        await page.getByLabel('评语').fill('发音清晰，节奏自然。')
        await page.getByRole('button', { name: '提交本题' }).click()
      })

      await productStep('review-settlement', '评分会话结束后进入沉浸式结算页', async () => {
        await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
        await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: '本次结算（2）' })).toBeEnabled()
        await expect(
          page.getByRole('row').filter({ hasText: '张明' }).getByText('可结算', { exact: true })
        ).toBeVisible()
        await expect(
          page.getByRole('row').filter({ hasText: '赵宁' }).getByText('可结算', { exact: true })
        ).toBeVisible()

        await evidence(testInfo, page, {
          key: 'settlement-review',
          kind: 'decision',
          step: 'review-settlement',
          caption: '结算页列出本次会话中可以结算的全部作答'
        })
      })

      await productStep('defer-settlement', '选择下次结算会保留评分并返回未结算列表', async () => {
        await page.getByRole('button', { name: '下次结算' }).click()
        await expect(page.getByRole('tab', { name: /未结算/ })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(page.getByText('可结算', { exact: true })).toHaveCount(2)
      })

      await productStep('settle-batch', '再次进入结算并将两份作答原子结算为一个批次', async () => {
        await page.getByRole('checkbox', { name: '全选' }).check()
        await page.getByRole('button', { name: '开始评分（2）' }).click()
        await page.getByRole('button', { name: '人工评分' }).click()
        await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible()
        await page.getByRole('button', { name: '本次结算（2）' }).click()

        await expect(page.getByRole('tab', { name: /已结算/ })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(page.getByText('2 条作答')).toBeVisible()
        await expect(page.getByText('张明', { exact: true })).toBeVisible()
        await expect(page.getByText('赵宁', { exact: true })).toBeVisible()

        await evidence(testInfo, page, {
          key: 'settled-batch',
          kind: 'result',
          step: 'settle-batch',
          caption: '两份作答作为同一个批次进入已结算视图'
        })
      })

      await productStep(
        'restart-grading',
        '重新评分会删除原结果并把原始作答移回未评分列表',
        async () => {
          const row = page.getByRole('row').filter({ hasText: '张明' })
          await row.getByRole('button', { name: '重新评分' }).click()
          await expect(page.getByRole('heading', { name: '重新评分 张明 的作答？' })).toBeVisible()
          await page.getByRole('button', { name: '删除评分并重新开始' }).click()

          await expect(page.getByRole('tab', { name: /未结算/ })).toHaveAttribute(
            'aria-selected',
            'true'
          )
          const resetRow = page.getByRole('row').filter({ hasText: '张明' })
          await expect(resetRow.getByText('未评分', { exact: true })).toBeVisible()
        }
      )
    }
  )
)

async function installOpenDialog(paths: string[]): Promise<void> {
  await electronApp.evaluate(({ dialog }, filePaths) => {
    let index = 0
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({
        canceled: false,
        filePaths: [filePaths[Math.min(index++, filePaths.length - 1)]]
      })
    })
  }, paths)
}

const objectiveSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000001',
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'1'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'objective',
    answerFormat: [{ answerId: 'answer', type: 'text' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'analysis', type: 'text', required: true }
    ]
  },
  data: {
    name: '选择题',
    description: '客观题评分',
    maxScore: 2,
    answerDescriptions: { answer: '选择答案' },
    inputDescriptions: {},
    rubricMarkdown: ''
  }
}

const readingSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000002',
  sourceDraftId: '20000000-0000-4000-8000-000000000002',
  structureHash: `sha256:${'2'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'reading', type: 'fixed-speech' }],
    templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
  },
  data: {
    name: '朗读题',
    description: '人工朗读评分',
    maxScore: 5,
    answerDescriptions: { reading: '朗读录音' },
    inputDescriptions: {},
    rubricMarkdown: '根据发音准确度和表达流畅度评分。'
  }
}

function objectiveSubmission(): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-objective-docs',
      examPackageId: 'exam-docs',
      examTitle: '八年级英语听说练习',
      candidate: { candidateId: '2026002', displayName: '赵宁' },
      startedAt: '2026-08-14T08:00:00Z',
      submittedAt: '2026-08-14T08:20:00Z'
    },
    answers: { strings: ['A'], audios: [] },
    schemaUses: [
      {
        instanceId: 'objective-use',
        schema: objectiveSchema,
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请选择正确答案。' },
          { inputId: 'analysis', type: 'text', value: 'A' }
        ],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
      }
    ],
    resources: {}
  }
}

function readingSubmission(): SubmissionPackage {
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId: 'submission-reading-docs',
      examPackageId: 'exam-docs',
      examTitle: '八年级英语听说练习',
      candidate: { candidateId: '2026001', displayName: '张明' },
      startedAt: '2026-08-14T09:00:00Z',
      submittedAt: '2026-08-14T09:20:00Z'
    },
    answers: {
      strings: [],
      audios: [{ resourceKey: 'answer-audio-0', durationMs: 3200 }]
    },
    schemaUses: [
      {
        instanceId: 'reading-use',
        schema: readingSchema,
        inputs: [{ inputId: 'question-description', type: 'text', value: '请朗读句子。' }],
        answers: [
          {
            answerId: 'reading',
            type: 'fixed-speech',
            text: 'The weather is beautiful today.',
            audioAnswerIndex: 0
          }
        ]
      }
    ],
    resources: {
      'answer-audio-0': {
        filename: 'reading.wav',
        packagePath: 'recordings/answer-audio-0/reading.wav',
        mediaType: 'audio/wav'
      }
    }
  }
}
