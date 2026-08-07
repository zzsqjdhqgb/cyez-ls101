import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import stableStringify from 'fast-json-stable-stringify'
import { MockAiServer } from './support/mock-ai-server'
import { launchIntegrationApp } from './support/electron-app'

interface ProviderInput {
  id?: string
  name: string
  type: 'openai-compatible' | 'anthropic'
  baseUrl: string
  models: Array<{ id: string; enabled: boolean }>
  apiKey?: string
  clearApiKey?: boolean
}

interface ImageProviderInput {
  id?: string
  name: string
  type: 'manual' | 'openai-compatible'
  baseUrl: string
  models: Array<{ id: string; enabled: boolean }>
  apiKey?: string
  clearApiKey?: boolean
}

type SeededLeaf = { type: 'text' | 'image'; varName: string; description: string; example: string }

interface SeededFields {
  order: string[]
  nodes: Record<string, SeededLeaf>
}

interface SeededInterfaceContent {
  name: string
  description: string
  promptTemplate: string
  fields: SeededFields
}

const mockServer = new MockAiServer()

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]

const textInterface: SeededInterfaceContent = {
  name: '集成测试题型',
  description: 'Playwright 跨包 AI 生成端到端测试用题型',
  promptTemplate: '请生成一份听说测试内容。',
  fields: {
    order: ['title', 'answer'],
    nodes: {
      title: {
        type: 'text',
        varName: 'titleText',
        description: '题目标题',
        example: '示例标题'
      },
      answer: {
        type: 'text',
        varName: 'answerText',
        description: '参考答案',
        example: '示例答案'
      }
    }
  }
}

const imageInterface: SeededInterfaceContent = {
  name: '集成测试图片题型',
  description: '包含图片字段的跨包 AI 生成端到端测试题型',
  promptTemplate: '请生成一份带配图的听说测试内容。',
  fields: {
    order: ['title', 'picture'],
    nodes: {
      title: {
        type: 'text',
        varName: 'titleText',
        description: '题目标题',
        example: '示例标题'
      },
      picture: {
        type: 'image',
        varName: 'pictureImage',
        description: '题目配图',
        example: '一枚简洁的绿色圆形图标'
      }
    }
  }
}

test.beforeAll(async () => mockServer.start())
test.afterAll(async () => mockServer.close())

test.beforeEach(async () => {
  mockServer.reset()
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-interface-'))
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

function textProvider(
  id: string,
  modelId: string,
  type: ProviderInput['type'] = 'openai-compatible'
): ProviderInput {
  return {
    id,
    name: id,
    type,
    baseUrl: mockServer.baseUrl,
    models: [{ id: modelId, enabled: true }],
    apiKey: `${id}-secret`
  }
}

function imageProvider(id: string, modelId: string): ImageProviderInput {
  return {
    id,
    name: id,
    type: 'openai-compatible',
    baseUrl: mockServer.baseUrl,
    models: [{ id: modelId, enabled: true }],
    apiKey: `${id}-secret`
  }
}

async function saveTextProvider(config: ProviderInput): Promise<void> {
  await page.evaluate((input) => window.airouter.saveProviderConfig(input), config)
}

async function saveImageProvider(config: ImageProviderInput): Promise<void> {
  await page.evaluate((input) => window.airouter.saveImageProviderConfig(input), config)
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}

function canonicalizeNode(node: SeededLeaf): unknown {
  return {
    type: node.type,
    varName: normalizeText(node.varName),
    description: normalizeText(node.description),
    example: normalizeText(node.example)
  }
}

function canonicalizeFields(fields: SeededFields): unknown[] {
  return fields.order.map((key) => [normalizeText(key), canonicalizeNode(fields.nodes[key])])
}

function canonicalizeInterfaceContent(content: SeededInterfaceContent): string {
  return stableStringify({
    name: normalizeText(content.name),
    description: normalizeText(content.description),
    promptTemplate: normalizeText(content.promptTemplate),
    fields: canonicalizeFields(content.fields)
  })
}

function deriveInterfaceId(content: SeededInterfaceContent): string {
  const bytes = Buffer.from(canonicalizeInterfaceContent(content), 'utf8')
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

async function seedInterface(content: SeededInterfaceContent): Promise<string> {
  const id = deriveInterfaceId(content)
  const digest = id.slice('sha256:'.length)
  await page.evaluate(
    async ({ scope, filename, def }) => {
      const fileStore = (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore
      await fileStore.invoke('file:write-text', { scope, filename }, JSON.stringify(def))
    },
    {
      scope: ['interfaces', 'published', digest],
      filename: 'interface.json',
      def: { id, ...content }
    }
  )
  return id
}

async function openInstanceEditor(interfaceId: string, interfaceName: string): Promise<void> {
  await page.getByRole('link', { name: '题型' }).click()
  await page.getByRole('button', { name: interfaceName, exact: true }).click()
  await page.getByRole('button', { name: '新建题组' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未命名题组' })).toBeVisible()
}

async function readInstance(
  interfaceId: string
): Promise<{ instance: Record<string, unknown>; assets: string[] }> {
  const instanceIds = (await page.evaluate(
    (scope) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:list-scopes', scope),
    ['interfaces', 'published', interfaceId.slice('sha256:'.length), 'instances']
  )) as string[]
  expect(instanceIds).toHaveLength(1)
  const raw = (await page.evaluate(
    (location) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:read-text', location),
    {
      scope: [
        'interfaces',
        'published',
        interfaceId.slice('sha256:'.length),
        'instances',
        instanceIds[0]
      ],
      filename: 'instance.json'
    }
  )) as string
  return JSON.parse(raw) as { instance: Record<string, unknown>; assets: string[] }
}

test('IE-01 generates and saves an instance through the real AIRouter pipeline', async () => {
  await saveTextProvider(textProvider('ie-text', 'mock-json'))
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)

  await page.getByRole('button', { name: 'AI 生成' }).click()
  const modelSelect = page.getByLabel('生成模型', { exact: true })
  await expect(modelSelect).toBeVisible()
  await modelSelect.selectOption({ label: 'mock-json' })
  await page.getByRole('button', { name: '开始生成' }).click()

  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
  await expect(page.getByLabel('answer 内容')).toHaveValue('AI answer')

  const request = mockServer.findRequest('/v1/chat/completions')
  expect(request?.body).toMatchObject({
    model: 'mock-json',
    messages: [{ role: 'user', content: expect.stringContaining(textInterface.promptTemplate) }],
    stream: true
  })
  expect(await readInstance(interfaceId)).toMatchObject({
    instance: { values: { titleText: 'AI 标题', answerText: 'AI answer' } }
  })
})

test('IE-02 generates text and images atomically through the real pipelines', async () => {
  await saveTextProvider(textProvider('ie-text-image', 'mock-json-image'))
  await saveImageProvider(imageProvider('ie-image', 'mock-image'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)

  await page.getByRole('button', { name: 'AI 生成' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-image' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '开始生成' }).click()

  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
  await expect(page.getByLabel('picture图片提示词')).toHaveValue('A green circle icon')
  await expect(page.getByAltText('picture预览')).toBeVisible()

  expect(mockServer.findRequest('/v1/chat/completions')?.body).toMatchObject({
    model: 'mock-json-image',
    stream: true
  })
  expect(mockServer.findRequest('/v1/images/generations')?.body).toMatchObject({
    model: 'mock-image',
    prompt: 'A green circle icon'
  })
  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.imagePrompts).toEqual({ pictureImage: 'A green circle icon' })
  expect(persisted.assets).toHaveLength(1)
})

test('IE-03 reports invalid AI output and supports cancellation without saving', async () => {
  await saveTextProvider(textProvider('ie-errors', 'mock-nonjson'))
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)

  await page.getByRole('button', { name: 'AI 生成' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-nonjson' })
  await page.getByRole('button', { name: '开始生成' }).click()
  await expect(page.getByText('生成内容未通过校验')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('发现 1 个字段错误')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('')

  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByLabel('JSON 内容')).toHaveValue('这不是一个合法的 JSON 响应')
  await expect(page.getByRole('alert')).toContainText('JSON 格式不合法')

  await saveTextProvider(textProvider('ie-slow', 'mock-slow'))
  await page.getByRole('button', { name: 'AI 生成' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-slow' })
  await page.getByRole('button', { name: '开始生成' }).click()
  await page.getByRole('button', { name: '取消生成' }).click()
  await expect(page.getByText('生成已取消')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已取消 AI 生成')).toBeVisible()

  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.values).toEqual({ titleText: '', answerText: '' })
})
