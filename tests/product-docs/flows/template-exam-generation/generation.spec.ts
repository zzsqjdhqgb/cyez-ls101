import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

const TEMPLATE_ID = '82000000-0000-4000-8000-000000000001'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let server: Server
let serverOrigin: string
let requests: Map<string, number>
let pageErrors: string[]

test.beforeEach(async () => {
  requests = new Map()
  server = createSpeechServer(requests)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  serverOrigin = `http://127.0.0.1:${address.port}`

  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-generation-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  await prepareProductPage(page)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('dialog', (dialog) => void dialog.accept())
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()

  await writeFileStoreText(
    ['template-editor', 'templates', TEMPLATE_ID],
    'template.json',
    generationTemplate()
  )
  await configureSpeechProviders()
})

test.afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test(
  ...productTest(
    {
      id: 'TG-01',
      owner: {
        kind: 'flow',
        slug: 'template-exam-generation',
        title: '试卷模板生成试卷',
        order: 100
      },
      section: '试卷生成',
      title: '从试卷模板生成并保存可运行试卷',
      purpose:
        '模板内容准备完成后，通过生成设置和生成过程得到可运行试卷，再把结果加入试卷库或导出为文件。',
      preconditions: ['已有一份包含三条语音的试卷模板，并配置三个可独立选择的语音提供商。'],
      outcomes: [
        '生成设置、生成过程和生成结果在独立全屏流程中依次呈现。',
        '语音失败会在有限重试后中断，并可从中断位置继续。',
        '加入试卷库和导出文件互相独立，未保存结果受到离开保护。'
      ],
      manual: [{ chapter: 'build-generate-exam', order: 50 }],
      steps: [
        {
          key: 'open-generation',
          action: '从“试卷模板”打开要使用的模板，再选择“生成试卷”。',
          expected: '应用进入独立的生成流程，并首先显示生成设置。'
        },
        {
          key: 'configure-generation',
          action: '填写试卷名称，并为默认、男声和女声音色分别选择提供商、模型和音色。',
          expected: '页面保留全部生成设置，可以开始生成。'
        },
        {
          key: 'protect-running-task',
          action: '选择“开始生成”；生成进行中尝试关闭流程，再选择“取消”。',
          expected: '应用提示关闭会取消正在进行的任务；取消关闭后仍保留在当前生成流程。'
        },
        {
          key: 'interrupt-on-failure',
          action: '等待语音服务连续失败并达到重试上限。',
          expected: '生成流程暂停并显示失败项，同时保留每项任务的完成状态。'
        },
        {
          key: 'resume-generation',
          action: '选择“从中断位置重试”。',
          expected: '应用从失败项继续，保留已经完成的语音，并最终完成试卷生成。'
        },
        {
          key: 'protect-unsaved-result',
          action: '在尚未保存生成结果时尝试关闭结果。',
          expected: '应用提示关闭将丢失尚未保存的试卷；取消后结果仍然保留。'
        },
        {
          key: 'save-result',
          action: '分别选择“加入试卷库”和“导出文件”。',
          expected: '两种保存方式独立完成，结果页面保持打开，仍可再次导出文件。'
        },
        {
          key: 'close-generation',
          action: '关闭生成结果，返回模板列表，再进入“试卷库”。',
          expected: '试卷库中可以找到刚刚生成并加入的试卷。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('open-generation', async () => {
        await page.getByRole('link', { name: '试卷模板' }).click()
        await expect(page.getByText('正在加载模板...')).toBeHidden()
        await page.getByRole('tab', { name: '我的模板' }).click()
        await page.getByRole('button', { name: '生成流程文档模板', exact: true }).click()
        await page.getByRole('button', { name: '生成试卷' }).click()

        await expect(
          page.getByRole('heading', { level: 1, name: '生成流程文档模板' })
        ).toBeVisible()
        await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
        await expect(page.getByRole('list', { name: '试卷生成阶段' })).toContainText('生成设置')
      })

      await productStep('configure-generation', async () => {
        await page.getByLabel('试卷名称').fill('八年级英语听说练习')
        await selectSpeech('默认音色', 'docs-default', 'default-model', 'default-voice')
        await selectSpeech('男声音色', 'docs-man', 'man-model', 'man-voice')
        await selectSpeech('女声音色', 'docs-woman', 'woman-model', 'woman-voice')

        await evidence(testInfo, page, {
          key: 'generation-settings',
          kind: 'decision',
          step: 'configure-generation',
          caption: '生成前分别确认试卷名称和三种音色配置'
        })
      })

      await productStep('protect-running-task', async () => {
        await page.getByRole('button', { name: '开始生成' }).click()
        await expect(page.getByRole('heading', { name: '正在生成试卷' })).toBeVisible()
        await expect.poll(() => requests.get('Welcome to the test') ?? 0).toBe(1)

        await page.getByRole('button', { name: '关闭生成试卷' }).click()
        await expect(page.getByRole('heading', { name: '取消正在进行的试卷生成？' })).toBeVisible()
        await page.getByRole('button', { name: '取消', exact: true }).click()
        await expect(page.getByRole('list', { name: '试卷生成阶段' })).toContainText('生成过程')
      })

      await productStep('interrupt-on-failure', async () => {
        await expect(page.getByRole('heading', { name: '生成已中断' })).toBeVisible()
        const tasks = page.getByRole('region', { name: '试卷生成任务' })
        await expect(tasks).toContainText('合成语音 1：Welcome to the test')
        await expect(tasks).toContainText('第 4 / 4 次尝试失败')
        expect(requests.get('Welcome to the test')).toBe(1)
        expect(requests.get('Good morning')).toBe(4)

        await page.getByRole('heading', { name: '生成已中断' }).hover()
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
        await expect(page.getByText('关闭生成试卷', { exact: true })).toBeHidden()
        await evidence(testInfo, page, {
          key: 'speech-failure',
          kind: 'exception',
          step: 'interrupt-on-failure',
          caption: '语音达到重试上限后中断，并保留逐项任务状态'
        })
      })

      await productStep('resume-generation', async () => {
        await page.getByRole('button', { name: '从中断位置重试' }).click()
        await expect(page.getByText('试卷生成完成')).toBeVisible()
        expect(requests.get('Welcome to the test')).toBe(1)
        expect(requests.get('Good morning')).toBe(5)
        expect(requests.get('Please begin')).toBe(1)
      })

      await productStep('protect-unsaved-result', async () => {
        const result = page.getByRole('region', { name: '八年级英语听说练习' })
        await result.getByRole('button', { name: '关闭', exact: true }).click()
        await expect(page.getByRole('heading', { name: '放弃尚未保存的试卷？' })).toBeVisible()
        await page.getByRole('button', { name: '取消', exact: true }).click()
        await expect(page.getByText('试卷生成完成')).toBeVisible()
      })

      await productStep('save-result', async () => {
        await page.getByRole('button', { name: '加入试卷库' }).click()
        await expect(page.getByRole('button', { name: '已加入试卷库' })).toBeDisabled()

        const exportPath = path.join(userDataDir, '八年级英语听说练习.lsexam')
        await electronApp.evaluate(({ dialog }, filePath) => {
          Object.defineProperty(dialog, 'showSaveDialog', {
            configurable: true,
            value: async () => ({ canceled: false, filePath })
          })
        }, exportPath)
        await page.getByRole('button', { name: '导出文件' }).click()
        await expect(page.getByRole('button', { name: '再次导出文件' })).toBeVisible()
        await access(exportPath)
        await expect(page.getByText('试卷生成完成')).toBeVisible()

        await expect(page.getByText('试卷文件已导出', { exact: true })).toBeHidden({
          timeout: 6_000
        })
        await evidence(testInfo, page, {
          key: 'saved-result',
          kind: 'result',
          step: 'save-result',
          caption: '生成结果已加入试卷库且仍可再次导出文件'
        })
      })

      await productStep('close-generation', async () => {
        const result = page.getByRole('region', { name: '八年级英语听说练习' })
        await result.getByRole('button', { name: '关闭', exact: true }).click()
        await expect(
          page.getByRole('heading', { level: 1, name: '生成流程文档模板' })
        ).toBeVisible()
        await page.getByRole('button', { name: '返回模板' }).click()
        await page.getByRole('link', { name: '试卷库' }).click()
        await expect(page.getByRole('cell', { name: /八年级英语听说练习/ })).toBeVisible()
      })
    }
  )
)

async function selectSpeech(
  role: string,
  provider: string,
  model: string,
  voice: string
): Promise<void> {
  await page.getByLabel(`${role}提供商`).selectOption(provider)
  await page.getByLabel(`${role}模型`).selectOption(model)
  await page.getByLabel(`${role}音色`).selectOption(voice)
}

async function configureSpeechProviders(): Promise<void> {
  await page.evaluate(
    async ({ serverOrigin }) => {
      const providers = [
        {
          id: 'docs-default',
          name: '文档默认语音',
          path: 'default',
          model: 'default-model',
          voice: 'default-voice'
        },
        {
          id: 'docs-man',
          name: '文档男声',
          path: 'man',
          model: 'man-model',
          voice: 'man-voice'
        },
        {
          id: 'docs-woman',
          name: '文档女声',
          path: 'woman',
          model: 'woman-model',
          voice: 'woman-voice'
        }
      ]
      for (const provider of providers) {
        await window.airouter.saveSpeechProviderConfig({
          id: provider.id,
          name: provider.name,
          kind: 'online',
          type: 'openai-compatible',
          baseUrl: `${serverOrigin}/${provider.path}/v1`,
          models: [{ id: provider.model, enabled: true }],
          voices: [{ id: provider.voice, enabled: true }],
          apiKey: 'product-docs'
        })
      }
    },
    { serverOrigin }
  )
}

function createSpeechServer(requestCounts: Map<string, number>): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const input = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).input ?? '')
      const count = (requestCounts.get(input) ?? 0) + 1
      requestCounts.set(input, count)
      const reply = (): void => {
        if (input === 'Good morning' && count <= 4) {
          response.writeHead(503, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: '语音服务暂时不可用' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'audio/wav' })
        response.end(Buffer.from([82, 73, 70, 70, count, 0, 0, 0]))
      }
      if (input === 'Welcome to the test') setTimeout(reply, 350)
      else reply()
    })
  })
}

function generationTemplate(): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    revision: 0,
    content: {
      name: '生成流程文档模板',
      description: '测试即文档生成流程',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [
          speechPage('welcome', 'Welcome to the test'),
          speechPage('man', '[Man]: Good morning'),
          speechPage('woman', '[Woman]: Please begin')
        ]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function speechPage(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: 'page',
    content: {
      blocks: [
        {
          id: `${id}-text`,
          type: 'text',
          x: 10,
          y: 20,
          width: 80,
          fontSize: 36,
          align: 'center',
          text: { type: 'string', parts: [{ type: 'literal', value: text }] }
        }
      ]
    },
    timeline: [
      {
        type: 'play',
        text: { type: 'string', parts: [{ type: 'literal', value: text }] }
      }
    ]
  }
}

async function writeFileStoreText(
  scope: string[],
  filename: string,
  value: unknown
): Promise<void> {
  await page.evaluate(
    async ({ scope, filename, value }) => {
      await window.fileStore.invoke('file:write-text', { scope, filename }, JSON.stringify(value))
    },
    { scope, filename, value }
  )
}
