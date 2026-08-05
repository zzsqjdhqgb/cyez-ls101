import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import stableStringify from 'fast-json-stable-stringify'
import { MOCK_PNG_BASE64, MockAiServer } from './support/mock-ai-server'

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

interface SeededDraft {
  draftId: string
  name: string
  description: string
  promptTemplate: string
  fields: { order: string[]; nodes: Record<string, never> }
}

const projectRoot = process.cwd()
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
  electronApp = await electron.launch({
    args: ['.', '--no-sandbox', '--password-store=basic', `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    env: { ...process.env, LS101_INTEGRATION_TEST: '1' }
  })
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

async function openDraftEditor(): Promise<void> {
  await page.getByRole('link', { name: '题型' }).click()
  await page.getByRole('button', { name: '草稿' }).click()
  await page.getByRole('button', { name: '新建草稿' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
}

async function seedDraft(draft: SeededDraft): Promise<void> {
  await page.evaluate(
    async ({ scope, filename, value }) => {
      const fileStore = (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore
      await fileStore.invoke('file:write-text', { scope, filename }, JSON.stringify(value))
    },
    { scope: ['interfaces', 'drafts', draft.draftId], filename: 'draft.json', value: draft }
  )
}

async function clearPublishedInterface(interfaceId: string): Promise<void> {
  await page.evaluate(
    (scope) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:clear-scope', scope),
    ['interfaces', 'published', interfaceId.slice('sha256:'.length)]
  )
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
  const modelSelect = page.getByLabel('生成模型', { exact: true })
  const modelOptions = modelSelect.locator('option')
  await expect(modelOptions).toHaveCount(2)
  await expect(modelOptions).toContainText(['mock-nonjson', 'mock-slow'])
  await page.getByRole('button', { name: '刷新生成模型' }).click()
  await expect(modelOptions).toHaveCount(2)
  await modelSelect.selectOption({ label: 'mock-slow' })
  await page.getByRole('button', { name: '开始生成' }).click()
  await page.getByRole('button', { name: '取消生成' }).click()
  await expect(page.getByText('生成已取消')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已取消 AI 生成')).toBeVisible()
  await expect(page.getByText('已取消 AI 生成')).toBeHidden()
  await page.getByRole('button', { name: '重新生成' }).click()
  await expect(page.getByRole('button', { name: '取消生成' })).toBeVisible()
  await page.getByRole('button', { name: '取消生成' }).click()
  await expect(page.getByText('生成已取消')).toBeVisible({ timeout: 15_000 })

  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.values).toEqual({ titleText: '', answerText: '' })
})

test('IE-04 creates, edits and persists a draft through the real UI', async () => {
  await openDraftEditor()
  const content = page.getByLabel('题型内容')
  await content.getByLabel('名称').fill('系统测试题型')
  await content.getByLabel('描述').fill('系统级草稿编辑测试')
  await content.getByLabel('生成要求').fill('请生成测试内容。')
  await page.getByRole('button', { name: '添加字段', exact: true }).click()
  const inspector = page.getByLabel('字段结构')
  await inspector.getByLabel('变量名').fill('questionText')
  await inspector.getByLabel('描述').fill('题干文本')
  await inspector.getByLabel('示例').fill('示例题干')
  await inspector.getByLabel('字段标识').fill('question')
  await inspector.getByLabel('字段标识').press('Tab')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()

  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await page.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '系统测试题型' })).toBeVisible()
  const reopened = page.getByLabel('题型内容')
  await expect(reopened.getByLabel('名称')).toHaveValue('系统测试题型')
  await expect(reopened.getByLabel('描述')).toHaveValue('系统级草稿编辑测试')
  await expect(reopened.getByLabel('生成要求')).toHaveValue('请生成测试内容。')
  await expect(
    page.getByLabel('字段结构').getByRole('button', { name: /questionText/ })
  ).toBeVisible()
})

test('IE-05 validates and publishes a draft through the real UI', async () => {
  await openDraftEditor()
  const content = page.getByLabel('题型内容')
  await content.getByLabel('名称').fill('校验发布题型')
  await content.getByLabel('描述').fill('发布流程测试')
  await content.getByLabel('生成要求').fill('请生成内容。')
  await page.getByRole('button', { name: '添加字段', exact: true }).click()

  await page.getByRole('button', { name: '发布' }).click()
  await expect(page.getByRole('alert')).toContainText('发布前需要修正以下内容')
  await expect(page.getByRole('alert')).toContainText('变量名不能为空')

  const inspector = page.getByLabel('字段结构')
  await inspector.getByLabel('变量名').fill('answerText')
  await inspector.getByLabel('描述').fill('答案文本')
  await inspector.getByLabel('示例').fill('示例答案')
  await inspector.getByLabel('字段标识').fill('answer')
  await inspector.getByLabel('字段标识').press('Tab')
  await page.getByRole('button', { name: '发布' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '校验发布题型' })).toBeVisible()

  await page.getByRole('button', { name: '返回题型' }).click()
  await expect(page.getByRole('button', { name: '校验发布题型', exact: true })).toBeVisible()
})

test('IE-06 deletes drafts and guards unsaved changes on leave', async () => {
  await seedDraft({
    draftId: randomUUID(),
    name: '待删除草稿',
    description: '删除流程测试',
    promptTemplate: '请生成内容。',
    fields: { order: [], nodes: {} }
  })
  await page.getByRole('link', { name: '题型' }).click()
  await page.getByRole('button', { name: '草稿' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型草稿' })).toBeVisible()
  await page.getByRole('button', { name: '删除草稿', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除草稿“待删除草稿”')).toBeVisible()
  await expect(page.getByText('暂无草稿')).toBeVisible()

  await page.getByRole('button', { name: '新建草稿' }).click()
  await page.getByLabel('题型内容').getByLabel('名称').fill('未保存草稿')
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('放弃未保存的修改？')).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未保存草稿' })).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型草稿' })).toBeVisible()
  await expect(page.getByRole('button', { name: '未命名题型', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '未保存草稿', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '返回题型' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型' })).toBeVisible()
})

test('IE-07 edits and saves an instance and guards unsaved changes', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)
  await page.getByLabel('题组名称').fill('系统测试题组')
  await page.getByLabel('title 内容').fill('保存的标题')
  await page.getByLabel('answer 内容').fill('保存的答案')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('题组已保存')).toBeVisible()

  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '系统测试题组' }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('保存的标题')
  await expect(page.getByLabel('answer 内容')).toHaveValue('保存的答案')

  await page.getByLabel('title 内容').fill('未保存的修改')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('放弃未保存的修改？')).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('未保存的修改')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改' }).click()
  await expect(page.getByRole('button', { name: '系统测试题组' })).toBeVisible()
  await page.getByRole('button', { name: '系统测试题组' }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('保存的标题')
})

test('IE-08 replaces instance values from JSON and reports invalid JSON', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)
  await page.getByRole('button', { name: 'JSON' }).click()
  await page.getByLabel('JSON 内容').fill('{"title":"JSON 标题","answer":"JSON 答案"}')
  await page.getByRole('button', { name: '覆盖全部值' }).click()
  await expect(page.getByText('已从 JSON 更新题组')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('JSON 标题')
  await expect(page.getByLabel('answer 内容')).toHaveValue('JSON 答案')
  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.values).toEqual({ titleText: 'JSON 标题', answerText: 'JSON 答案' })

  await page.getByRole('button', { name: 'JSON' }).click()
  await page.getByLabel('JSON 内容').fill('{"broken":')
  await page.getByRole('button', { name: '覆盖全部值' }).click()
  await expect(page.getByRole('alert')).toContainText('JSON 格式不合法')
  await expect(page.getByLabel('title 内容')).toHaveValue('JSON 标题')
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByLabel('JSON 内容')).toBeHidden()
})

test('IE-09 deletes an instance through the real UI', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '删除题组' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除题组“未命名题组”')).toBeVisible()
  await expect(page.getByText('暂无题组')).toBeVisible()
  const instanceIds = (await page.evaluate(
    (scope) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:list-scopes', scope),
    ['interfaces', 'published', interfaceId.slice('sha256:'.length), 'instances']
  )) as string[]
  expect(instanceIds).toEqual([])
})

test('IE-10 copies a published interface to a draft', async () => {
  await seedInterface(textInterface)
  await page.getByRole('link', { name: '题型' }).click()
  await page.getByRole('button', { name: textInterface.name, exact: true }).click()
  await page.getByRole('button', { name: '复制为草稿' }).click()
  await expect(page.getByRole('heading', { level: 1, name: textInterface.name })).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await expect(page.getByRole('button', { name: textInterface.name, exact: true })).toBeVisible()
})

test('IE-11 exports and re-imports an interface with its instances', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)
  await page.getByRole('button', { name: '返回题型详情' }).click()

  const exportPath = path.join(userDataDir, 'export.lsinterface')
  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath })
    })
  }, exportPath)
  await page.getByRole('button', { name: '导出' }).click()
  await expect(page.getByText('题型已导出')).toBeVisible()
  const exported = await readFile(exportPath)
  expect(exported.length).toBeGreaterThan(0)
  expect(exported.subarray(0, 2).toString()).toBe('PK')

  await clearPublishedInterface(interfaceId)
  await page.reload()
  await page.getByRole('link', { name: '题型' }).click()
  await expect(page.getByText('暂无题型')).toBeVisible()

  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
    })
  }, exportPath)
  await page.getByRole('button', { name: '导入' }).click()
  await expect(page.getByText('题型已导入')).toBeVisible()
  await expect(page.getByRole('button', { name: textInterface.name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '进入', exact: true }).click()
  await expect(page.getByRole('button', { name: '未命名题组' })).toBeVisible()
})

test('IE-12 manages draft field groups, image type and node deletion', async () => {
  await openDraftEditor()
  const content = page.getByLabel('题型内容')
  await content.getByLabel('名称').fill('字段树操作题型')
  await content.getByLabel('生成要求').fill('请生成内容。')
  const structure = page.getByLabel('字段结构')

  await page.getByRole('button', { name: '添加字段组', exact: true }).click()
  await expect(structure.getByText('选中此字段组后，新字段会添加到组内。')).toBeVisible()
  await page.getByRole('button', { name: '添加字段', exact: true }).click()
  await expect(structure.getByRole('button', { name: /group1/ })).toBeVisible()
  await expect(structure.getByRole('button', { name: /field1/ })).toBeVisible()

  await structure.getByRole('button', { name: /field1/ }).click()
  await structure.getByLabel('类型').selectOption('image')
  await structure.getByLabel('变量名').fill('pictureText')
  await structure.getByLabel('描述').fill('配图提示词')
  await structure.getByLabel('示例').fill('示例图片提示词')
  await structure.getByLabel('字段标识').fill('picture')
  await structure.getByLabel('字段标识').press('Tab')

  await page.getByRole('button', { name: '删除节点' }).click()
  await expect(structure.getByRole('button', { name: /picture/ })).toHaveCount(0)
  await expect(structure.getByRole('button', { name: /group1/ })).toBeVisible()

  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await page.getByRole('button', { name: '编辑' }).click()
  await expect(structure.getByRole('button', { name: /group1/ })).toBeVisible()
})

test('IE-13 drives the instance image field buttons end to end', async () => {
  await saveImageProvider(imageProvider('ie-field-image', 'mock-image'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)

  await page.getByLabel('picture图片提示词').fill('A green circle icon')
  await page.getByLabel('picture图像 Provider').selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成图片' }).click()
  await expect(page.getByText('图片已生成，请保存题组')).toBeVisible()
  await expect(page.getByAltText('picture预览')).toBeVisible()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('题组已保存')).toBeVisible()
  const saved = await readInstance(interfaceId)
  expect(saved.assets).toHaveLength(1)

  const originalClipboard = await electronApp.evaluate(({ clipboard }) => ({
    image: clipboard.readImage().toPNG(),
    text: clipboard.readText()
  }))
  try {
    const importPath = path.join(userDataDir, 'field-import.png')
    await writeFile(importPath, Buffer.from(MOCK_PNG_BASE64, 'base64'))
    await electronApp.evaluate(({ dialog }, filePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
      })
    }, importPath)
    await page.getByRole('button', { name: '选择文件' }).click()
    await expect(page.getByText('field-import.png')).toBeVisible()
    await expect(page.getByAltText('picture预览')).toBeVisible()

    await electronApp.evaluate(
      ({ clipboard, nativeImage }, base64) =>
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))),
      MOCK_PNG_BASE64
    )
    await page.getByRole('button', { name: '从剪贴板读取' }).click()
    await expect(page.getByText('剪贴板图片.png')).toBeVisible()
    await page.getByRole('button', { name: '移除图片' }).click()
    await expect(page.getByText('剪贴板图片.png')).toHaveCount(0)
    await expect(page.getByText('尚未选择图片')).toBeVisible()
  } finally {
    const restored = await electronApp.evaluate(({ clipboard, nativeImage }, previous) => {
      const image = previous.image.length
        ? nativeImage.createFromBuffer(Buffer.from(previous.image))
        : undefined
      clipboard.write(image ? { text: previous.text, image } : { text: previous.text })
      return { image: clipboard.readImage().toPNG(), text: clipboard.readText() }
    }, originalClipboard)
    expect(restored.text).toBe(originalClipboard.text)
    expect(Array.from(restored.image)).toEqual(Array.from(originalClipboard.image))
  }
})

test('IE-14 covers list and details page action buttons', async () => {
  await seedInterface(textInterface)
  await page.getByRole('link', { name: '题型' }).click()
  await page.getByRole('button', { name: '进入', exact: true }).click()
  await page.getByRole('button', { name: '新建题组' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未命名题组' })).toBeVisible()
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '编辑' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未命名题组' })).toBeVisible()
  await page.getByRole('button', { name: '返回题型详情' }).click()

  const originalText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await page.getByText('题型定义').click()
    await page.getByRole('button', { name: '复制完整提示词' }).click()
    await expect(page.getByText('已复制完整提示词')).toBeVisible()
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain(textInterface.promptTemplate)
    await page.getByRole('button', { name: '复制 JSON Schema' }).click()
    await expect(page.getByText('已复制JSON Schema')).toBeVisible()
  } finally {
    await electronApp.evaluate(({ clipboard }, value) => clipboard.writeText(value), originalText)
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(originalText)
  }
})

test('IE-15 drives the standalone AI image panel end to end', async () => {
  await saveImageProvider(imageProvider('ie-panel-image', 'mock-image'))
  await saveImageProvider(imageProvider('ie-panel-slow', 'mock-slow'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)
  await page.getByLabel('picture图片提示词').fill('A green circle icon')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('题组已保存')).toBeVisible()

  await page.getByRole('button', { name: 'AI 生图' }).click()
  const panel = page.getByLabel('AI 生图', { exact: true })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('1 张图片待生成')).toBeVisible()
  await panel.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await panel.getByRole('button', { name: '开始生图' }).click()
  await expect(panel.getByText('生图完成')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('AI 生图结果已保存')).toBeVisible()
  await panel.getByRole('button', { name: '完成' }).click()
  await expect(page.getByAltText('picture预览')).toBeVisible()

  await page.getByRole('button', { name: 'AI 生图' }).click()
  const slowPanel = page.getByLabel('AI 生图', { exact: true })
  await slowPanel.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-slow' })
  await slowPanel.getByRole('button', { name: '开始生图' }).click()
  await slowPanel.getByRole('button', { name: '取消生图' }).click()
  await expect(page.getByText('生图已取消')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已取消 AI 生图')).toBeVisible()
})
