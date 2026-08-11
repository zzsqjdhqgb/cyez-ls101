import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createSchemaDefinition, createSchemaDraft } from '@ls101/schema-editor'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from './support/electron-app'

const TEMPLATE_ID = '71000000-0000-4000-8000-000000000001'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-template-preview-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
test('previews a selected node tree as a vertical timeline filmstrip', async ({}, testInfo) => {
  const schema = await createSchemaDefinition(
    createSchemaDraft('预览评分结构', {
      questionType: 'freetalk',
      answerFormat: [{ answerId: 'recording', type: 'free-speech' }],
      templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
    }),
    {
      name: '预览评分',
      description: '用于预览集成测试',
      maxScore: 10,
      answerDescriptions: { recording: '口语录音' },
      inputDescriptions: {},
      rubricMarkdown: '根据表达完整度评分。'
    }
  )
  const template = {
    templateId: TEMPLATE_ID,
    revision: 0,
    content: {
      name: '纵向胶片预览',
      description: 'Electron integration fixture',
      interfaces: [],
      root: {
        id: 'root',
        name: '整份试卷',
        type: 'frame',
        children: [
          {
            id: 'intro-page',
            name: '考试说明',
            type: 'page',
            content: {
              blocks: [
                {
                  id: 'title',
                  type: 'text',
                  x: 10,
                  y: 14,
                  width: 80,
                  fontSize: 48,
                  bold: true,
                  align: 'center',
                  text: {
                    type: 'string',
                    parts: [{ type: 'literal', value: '英语听说考试' }]
                  }
                },
                {
                  id: 'instructions',
                  type: 'text',
                  x: 18,
                  y: 38,
                  width: 64,
                  fontSize: 28,
                  align: 'center',
                  text: {
                    type: 'string',
                    parts: [{ type: 'literal', value: '请佩戴耳机，等待考试开始。' }]
                  }
                }
              ]
            },
            timeline: [
              {
                type: 'play',
                text: { type: 'string', parts: [{ type: 'literal', value: '请听考试说明' }] }
              },
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 3 }
              }
            ]
          },
          {
            id: 'answer-page',
            name: '口语作答',
            type: 'page',
            content: {
              blocks: [
                {
                  id: 'prompt',
                  type: 'text',
                  x: 12,
                  y: 18,
                  width: 76,
                  fontSize: 40,
                  align: 'center',
                  text: {
                    type: 'string',
                    parts: [{ type: 'literal', value: '请介绍你的学校。' }]
                  }
                }
              ]
            },
            timeline: [
              {
                type: 'record',
                duration: { type: 'number', source: 'literal', value: 30 },
                outputName: 'answer-recording'
              }
            ]
          }
        ]
      },
      schemaUses: [
        {
          useId: 'preview-score',
          schemaId: schema.schemaId,
          inputBindings: {
            'question-description': {
              type: 'string',
              parts: [{ type: 'literal', value: '预览题目' }]
            }
          },
          answerBindings: {
            recording: {
              type: 'free-speech',
              audio: {
                type: 'audio',
                source: 'record-output',
                name: 'answer-recording'
              }
            }
          },
          attachments: []
        }
      ]
    },
    resources: { functions: [] },
    editorState: {}
  }

  await writeFileStoreText(['schema-editor', 'published', schema.schemaId], 'schema.json', schema)
  await writeFileStoreText(['template-editor', 'templates', TEMPLATE_ID], 'template.json', template)

  await page.getByRole('link', { name: '模板' }).click()
  await page.getByRole('button', { name: '纵向胶片预览' }).click()
  await page.getByRole('tab', { name: '预览' }).click()

  const filmstrip = page.getByRole('complementary', { name: '预览序列' })
  const canvas = page.getByRole('region', { name: '模板预览画面' })
  const inspector = page.getByRole('complementary', { name: '预览配置' })
  await expect(filmstrip).toBeVisible()
  await expect(canvas).toBeVisible()
  await expect(inspector).toBeVisible()
  await expect(filmstrip.getByRole('button', { name: /预览画面/ })).toHaveCount(3)
  await expect(page.getByLabel('最终画面 1')).toContainText('英语听说考试')

  const [filmstripBox, canvasBox, inspectorBox] = await Promise.all([
    filmstrip.boundingBox(),
    canvas.boundingBox(),
    inspector.boundingBox()
  ])
  expect(filmstripBox).not.toBeNull()
  expect(canvasBox).not.toBeNull()
  expect(inspectorBox).not.toBeNull()
  expect((filmstripBox?.x ?? 0) + (filmstripBox?.width ?? 0)).toBeLessThanOrEqual(canvasBox?.x ?? 0)
  expect((canvasBox?.x ?? 0) + (canvasBox?.width ?? 0)).toBeLessThanOrEqual(inspectorBox?.x ?? 0)

  await page.screenshot({ path: testInfo.outputPath('template-preview.png') })
})

async function writeFileStoreText(
  scope: string[],
  filename: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ({ scope, filename, value }) => {
      const fileStore = (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore
      await fileStore.invoke('file:write-text', { scope, filename }, JSON.stringify(value))
    },
    { scope, filename, value }
  )
}
