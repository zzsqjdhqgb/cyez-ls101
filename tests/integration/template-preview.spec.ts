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
        choiceCollector: {
          pages: [{ questionCount: 1 }, { questionCount: 1 }, { questionCount: 1 }]
        },
        children: [
          choiceQuestion('choice-1', '第一题：请选择 A'),
          choiceQuestion('choice-2', '第二题：请选择 B'),
          choiceQuestion('choice-3', '第三题：聚焦题'),
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
            id: 'choice-page',
            name: '多页选择题',
            type: 'page',
            content: {
              blocks: [
                {
                  id: 'choice-view',
                  type: 'choice-view',
                  x: 8,
                  y: 8,
                  width: 84,
                  height: 84,
                  defaultViewport: { mode: 'free', initialPage: 0 }
                }
              ]
            },
            timeline: [
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 5 }
              },
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 4 },
                choiceViewOverrides: {
                  'choice-view': { mode: 'range', startPage: 1, endPage: 2, initialPage: 1 }
                }
              },
              {
                type: 'countdown',
                seconds: { type: 'number', source: 'literal', value: 3 },
                choiceViewOverrides: {
                  'choice-view': {
                    mode: 'focus',
                    questionRef: {
                      scope: 'absolute',
                      callPath: [],
                      questionId: 'choice-3'
                    }
                  }
                }
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

  await page.getByRole('link', { name: '试卷模板' }).click()
  await page.getByRole('button', { name: '纵向胶片预览', exact: true }).click()

  await expect(page.getByLabel('节点 choice-1 输出名称')).toHaveValue('choice-1-answer')
  await expect(page.getByLabel('节点 choice-1 题干')).toHaveValue('第一题：请选择 A')
  await expect(page.getByLabel('节点 choice-1 选项 A 内容')).toHaveValue('选项 A')
  await expect(page.getByLabel('节点 choice-1 选项 B 内容')).toHaveValue('选项 B')
  await page.screenshot({ path: testInfo.outputPath('template-choice-node.png') })

  await page.getByRole('tab', { name: '预览' }).click()

  const filmstrip = page.getByRole('complementary', { name: '预览序列' })
  const canvas = page.getByRole('region', { name: '模板预览画面' })
  const inspector = page.getByRole('complementary', { name: '预览配置' })
  await expect(filmstrip).toBeVisible()
  await expect(canvas).toBeVisible()
  await expect(inspector).toBeVisible()
  const snapshotButtons = filmstrip.getByRole('button', { name: /预览画面/ })
  await expect(snapshotButtons).toHaveCount(6)
  await expect(page.getByLabel('最终画面 1')).toContainText('英语听说考试')

  await snapshotButtons.first().focus()
  await page.keyboard.press('Tab')
  await expect(snapshotButtons.nth(1)).toBeFocused()
  expect(
    await snapshotButtons.evaluateAll((buttons) =>
      buttons.every((button) => !button.querySelector('button, input, select, textarea'))
    )
  ).toBe(true)

  await snapshotButtons.nth(2).click()
  const freeChoicePage = page.getByLabel('最终画面 3')
  await expect(freeChoicePage).toContainText('第一题：请选择 A')
  await expect(freeChoicePage.getByText('1 / 3')).toBeVisible()
  expect(
    await freeChoicePage.evaluate((host) => {
      const styleText = host.shadowRoot?.querySelector('style')?.textContent ?? ''
      return {
        isolation: host.getAttribute('data-style-isolation'),
        lightDomInputs: host.querySelectorAll('input').length,
        shadowInputs: host.shadowRoot?.querySelectorAll('input').length ?? 0,
        shadowRoot: Boolean(host.shadowRoot),
        privateReset: styleText.includes(':host') && styleText.includes('all: initial')
      }
    })
  ).toEqual({
    isolation: 'shadow',
    lightDomInputs: 0,
    shadowInputs: 2,
    shadowRoot: true,
    privateReset: true
  })
  await freeChoicePage.getByRole('button', { name: '下一页' }).click()
  await expect(freeChoicePage).toContainText('第二题：请选择 B')
  await freeChoicePage.getByRole('radio', { name: /选项 B/ }).check()
  await expect(freeChoicePage.getByRole('radio', { name: /选项 B/ })).toBeChecked()

  await page.getByRole('button', { name: '查看 ChoiceView 配置' }).click()
  let choiceInfo = page.getByRole('region', { name: 'ChoiceView 配置' })
  await expect(choiceInfo).toContainText('全部分页')
  await expect(choiceInfo).toContainText('第 1–3 页')

  const [previewPageBox, previewFrameBox] = await Promise.all([
    freeChoicePage.boundingBox(),
    freeChoicePage.locator('..').locator('..').boundingBox()
  ])
  expect(previewPageBox).not.toBeNull()
  expect(previewFrameBox).not.toBeNull()
  expect(Math.abs((previewPageBox?.y ?? 0) - (previewFrameBox?.y ?? 0))).toBeLessThan(1)
  expect(Math.abs((previewPageBox?.height ?? 0) - (previewFrameBox?.height ?? 0))).toBeLessThan(1)

  await page.getByRole('tab', { name: '结构' }).click()
  await page.getByRole('tab', { name: '预览' }).click()
  await snapshotButtons.nth(2).click()
  const resetChoicePage = page.getByLabel('最终画面 3')
  await expect(resetChoicePage).toContainText('第一题：请选择 A')
  await expect(resetChoicePage.getByRole('radio', { name: /选项 A/ })).not.toBeChecked()

  await snapshotButtons.nth(3).click()
  const rangeChoicePage = page.getByLabel('最终画面 4')
  await expect(rangeChoicePage).toContainText('第二题：请选择 B')
  await expect(rangeChoicePage.getByText('1 / 2')).toBeVisible()
  await page.getByRole('button', { name: '查看 ChoiceView 配置' }).click()
  choiceInfo = page.getByRole('region', { name: 'ChoiceView 配置' })
  await expect(choiceInfo).toContainText('限制范围')
  await expect(choiceInfo).toContainText('第 2–3 页')

  await snapshotButtons.nth(4).click()
  const focusedChoicePage = page.getByLabel('最终画面 5')
  await expect(focusedChoicePage).toContainText('第三题：聚焦题')
  await expect(focusedChoicePage.getByRole('navigation', { name: '选择题分页' })).toHaveCount(0)
  await page.getByRole('button', { name: '查看 ChoiceView 配置' }).click()
  choiceInfo = page.getByRole('region', { name: 'ChoiceView 配置' })
  await expect(choiceInfo).toContainText('聚焦题目')
  await expect(choiceInfo).toContainText('第 3 题')
  await expect(choiceInfo).toContainText('第 3 页')

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

function choiceQuestion(id: string, stem: string): Record<string, unknown> {
  return {
    id,
    name: stem,
    type: 'choice-question',
    stem: { type: 'string', parts: [{ type: 'literal', value: stem }] },
    options: [
      {
        id: `${id}-a`,
        content: { type: 'string', parts: [{ type: 'literal', value: '选项 A' }] }
      },
      {
        id: `${id}-b`,
        content: { type: 'string', parts: [{ type: 'literal', value: '选项 B' }] }
      }
    ],
    outputName: `${id}-answer`
  }
}

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
