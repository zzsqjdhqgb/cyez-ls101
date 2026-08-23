import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import stableStringify from 'fast-json-stable-stringify'
import type { FieldCollection, FieldNode, InterfaceDef } from '@ls101/interface-editor'
import { MOCK_PNG_BASE64, MockAiServer } from './support/mock-ai-server'
import { closeStartupReleaseNotes, launchIntegrationApp } from './support/electron-app'

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

const BUILTIN_KEY = 'shanghai-gaokao-speaking'
const BUNDLED_INTERFACE_ID =
  'sha256:a53e4092e675dcf366ffe5f9c3fa06ad213923ea3ced42ea3b6ee640919d9d14'
const BUNDLED_INTERFACE_PATH = path.join(
  process.cwd(),
  'resources/builtin/interface-editor/builtin/shanghai-gaokao-speaking/versions',
  BUNDLED_INTERFACE_ID.slice('sha256:'.length),
  '.text/interface.json'
)

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
  await closeStartupReleaseNotes(page)
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

function canonicalizeFieldNode(node: FieldNode): unknown {
  if (node.type === 'group') {
    return { type: 'group', children: canonicalizeFieldCollection(node.children) }
  }
  return {
    type: node.type,
    varName: normalizeText(node.varName),
    description: normalizeText(node.description),
    example: normalizeText(node.example)
  }
}

function canonicalizeFieldCollection(fields: FieldCollection): unknown[] {
  return fields.order.map((key) => [normalizeText(key), canonicalizeFieldNode(fields.nodes[key])])
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

function deriveDefinitionId(content: Omit<InterfaceDef, 'id'>): string {
  const canonical = stableStringify({
    name: normalizeText(content.name),
    description: normalizeText(content.description),
    promptTemplate: normalizeText(content.promptTemplate),
    fields: canonicalizeFieldCollection(content.fields)
  })
  return `sha256:${createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')}`
}

function withoutId(definition: InterfaceDef): Omit<InterfaceDef, 'id'> {
  const content = structuredClone(definition) as InterfaceDef & { id?: string }
  delete content.id
  return content
}

function structuralBuiltinVersion(bundled: InterfaceDef): InterfaceDef {
  const content = withoutId(bundled)
  const oldContent: Omit<InterfaceDef, 'id'> = {
    ...content,
    fields: {
      order: ['legacy'],
      nodes: {
        legacy: { type: 'group', children: content.fields }
      }
    }
  }
  return { id: deriveDefinitionId(oldContent), ...oldContent }
}

function contractChangedBuiltinVersion(bundled: InterfaceDef): InterfaceDef {
  const content = withoutId(bundled)
  const oldContent = structuredClone(content)
  mutateFirstLeaf(oldContent.fields, (leaf) => {
    leaf.varName = `${leaf.varName}_legacy`
  })
  return { id: deriveDefinitionId(oldContent), ...oldContent }
}

function mutateFirstLeaf(
  fields: FieldCollection,
  mutate: (leaf: Exclude<FieldNode, { type: 'group' }>) => void
): void {
  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') {
      mutateFirstLeaf(node.children, mutate)
      return
    }
    mutate(node)
    return
  }
}

function emptyInstanceValues(fields: FieldCollection): Record<string, string> {
  const values: Record<string, string> = {}
  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') Object.assign(values, emptyInstanceValues(node.children))
    else values[node.varName] = ''
  }
  return values
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

async function readFileStoreText<T>(scope: string[], filename: string): Promise<T | null> {
  const raw = (await page.evaluate(
    (location) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:read-text', location),
    { scope, filename }
  )) as string | null
  return raw === null ? null : (JSON.parse(raw) as T)
}

async function clearFileStoreScope(scope: string[]): Promise<void> {
  await page.evaluate(
    (scope) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:clear-scope', scope),
    scope
  )
}

async function listFileStoreScopes(scope: string[]): Promise<string[]> {
  return (await page.evaluate(
    (scope) =>
      (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore.invoke('file:list-scopes', scope),
    scope
  )) as string[]
}

async function writeFileStoreAsset(
  scope: string[],
  filename: string,
  bytes: number[]
): Promise<void> {
  await page.evaluate(
    async ({ scope, filename, bytes }) => {
      const fileStore = (
        window as unknown as {
          fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
        }
      ).fileStore
      await fileStore.invoke('file:write-asset', { scope, filename }, new Uint8Array(bytes))
    },
    { scope, filename, bytes }
  )
}

async function writeBuiltinState(definition: InterfaceDef): Promise<void> {
  const digest = definition.id.slice('sha256:'.length)
  await clearFileStoreScope(['interfaces', 'builtin', BUILTIN_KEY])
  await writeFileStoreText(
    ['interfaces', 'builtin', BUILTIN_KEY, 'versions', digest],
    'interface.json',
    definition
  )
  await writeFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json', {
    builtinKey: BUILTIN_KEY,
    currentInterfaceId: definition.id
  })
}

async function writeBuiltinInstance(
  definition: InterfaceDef,
  instanceId: string,
  name: string,
  assets: readonly string[] = []
): Promise<void> {
  await writeFileStoreText(
    [
      'interfaces',
      'builtin',
      BUILTIN_KEY,
      'versions',
      definition.id.slice('sha256:'.length),
      'instances',
      instanceId
    ],
    'instance.json',
    {
      instance: {
        instanceId,
        name,
        generatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        values: emptyInstanceValues(definition.fields)
      },
      assets: [...assets]
    }
  )
}

async function writeTemplateInterfaceReference(
  templateId: string,
  interfaceId: string
): Promise<void> {
  await writeFileStoreText(['template-editor', 'templates', templateId], 'template.json', {
    templateId,
    revision: 0,
    content: {
      name: '内置题型升级引用模板',
      description: '',
      interfaces: [{ alias: 'speaking', interfaceId, acceptedVars: ['sentence_1'] }],
      root: { id: 'root', type: 'frame', children: [] },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  })
}

async function readBundledDefinition(): Promise<InterfaceDef> {
  return JSON.parse(await readFile(BUNDLED_INTERFACE_PATH, 'utf8')) as InterfaceDef
}

async function restartIntegrationApp(): Promise<void> {
  await electronApp.close()
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('[aria-modal="true"], h1').first()).toBeVisible()
}

async function createInstanceFromDetails(
  instanceName = '集成测试题组',
  mode: '手工填写' | 'AI 生成' = '手工填写'
): Promise<void> {
  await page.getByRole('button', { name: '新建题组' }).click()
  const dialog = page.getByRole('dialog', { name: '新建题组' })
  await dialog.getByLabel('题组名称').fill(instanceName)
  await dialog.getByLabel(mode).check()
  await dialog.getByRole('button', { name: '创建题组' }).click()
  await expect(page.getByRole('heading', { level: 1, name: instanceName })).toBeVisible()
}

async function openInstanceEditor(
  interfaceId: string,
  interfaceName: string,
  instanceName = '集成测试题组'
): Promise<void> {
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: interfaceName, exact: true }).click()
  await createInstanceFromDetails(instanceName)
}

async function openDraftEditor(): Promise<void> {
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('tab', { name: '草稿' }).click()
  await page.getByRole('button', { name: '新建题型' }).click()
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

async function expectRenderedAssetsToLoad(expectedCount: number): Promise<void> {
  const urls = await page
    .locator('img[src^="asset://"]')
    .evaluateAll((images) =>
      images.map((image) => image.getAttribute('src')).filter((url): url is string => Boolean(url))
    )
  expect(urls).toHaveLength(expectedCount)

  const responses = await electronApp.evaluate(async ({ net }, assetUrls) => {
    return Promise.all(
      assetUrls.map(async (url) => {
        try {
          const response = await net.fetch(url)
          return {
            url,
            status: response.status,
            bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
            error: null
          }
        } catch (error) {
          return {
            url,
            status: null,
            bytes: [],
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
    )
  }, urls)
  const expectedBytes = Array.from(Buffer.from(MOCK_PNG_BASE64, 'base64'))
  for (const response of responses) {
    expect(response.status, `${response.url}: ${response.error ?? 'unexpected status'}`).toBe(200)
    expect(response.bytes, response.url).toEqual(expectedBytes)
  }

  const responseSummary = responses.map(({ url, status, error, bytes }) => ({
    url,
    status,
    error,
    byteLength: bytes.length
  }))
  await expect
    .poll(
      () =>
        page.locator('img[src^="asset://"]').evaluateAll((images) =>
          images.map((image) => ({
            url: image.getAttribute('src'),
            loaded: image.complete && (image as HTMLImageElement).naturalWidth > 0
          }))
        ),
      { message: `asset responses: ${JSON.stringify(responseSummary)}` }
    )
    .toEqual(urls.map((url) => ({ url, loaded: true })))
}

test('IE-01 generates and saves an instance through the real AIRouter pipeline', async () => {
  await saveTextProvider(textProvider('ie-text', 'mock-json'))
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)

  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  const modelSelect = page.getByLabel('生成模型', { exact: true })
  await expect(modelSelect).toBeVisible()
  await modelSelect.selectOption({ label: 'mock-json' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()

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

  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-image' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()

  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
  await expect(page.getByLabel('picture图片提示词')).toHaveValue('A green circle icon')
  await expect(page.getByAltText('picture预览')).toBeVisible()
  await expectRenderedAssetsToLoad(1)

  expect(mockServer.findRequest('/v1/chat/completions')?.body).toMatchObject({
    model: 'mock-json-image',
    stream: true
  })
  expect(
    mockServer
      .allRequests()
      .filter((request) => request.path === '/v1/images/generations')
      .at(-1)?.body
  ).toMatchObject({
    model: 'mock-image',
    prompt: 'A green circle icon'
  })
  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.imagePrompts).toEqual({ pictureImage: 'A green circle icon' })
  expect(persisted.assets).toHaveLength(1)
})

test('IE-02b retries a failed image step without regenerating completed text', async () => {
  await saveTextProvider(textProvider('ie-retry-text', 'mock-json-image'))
  await saveImageProvider(imageProvider('ie-retry-image', 'mock-image'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)
  mockServer.failNextRequest('/v1/images/generations', 200, {
    created: 1,
    data: [{ b64_json: 'bm90IGFuIGltYWdl', revised_prompt: 'A green circle icon' }]
  })

  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-image' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()

  await expect(page.getByText('生成失败', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('region', { name: 'AI 生成进度' }).locator('li[data-status="failed"]')
  ).toContainText('生成图片：pictureImage')
  await page.getByRole('button', { name: '从失败位置重试' }).click()

  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
  expect(
    mockServer.allRequests().filter((request) => request.path === '/v1/chat/completions')
  ).toHaveLength(1)
  expect(
    mockServer.allRequests().filter((request) => request.path === '/v1/images/generations')
  ).toHaveLength(2)
  expect((await readInstance(interfaceId)).assets).toHaveLength(1)
})

test('IE-03 reports invalid AI output and supports cancellation without saving', async () => {
  await saveTextProvider(textProvider('ie-errors', 'mock-nonjson'))
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)

  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-nonjson' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
  await expect(page.getByText('生成内容未通过校验')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('发现 1 个字段错误')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('')

  await page.getByRole('button', { name: '检查 JSON' }).click()
  await expect(page.getByLabel('JSON 内容')).toHaveValue('这不是一个合法的 JSON 响应')
  await expect(page.getByRole('alert')).toContainText('JSON 格式不合法')
  await page
    .getByRole('dialog', { name: '从 JSON 覆盖题组' })
    .getByRole('button', { name: '取消' })
    .click()

  await saveTextProvider(textProvider('ie-slow', 'mock-slow'))
  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-slow' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
  await page.getByRole('button', { name: '取消生成' }).click()
  await expect(page.getByText('生成已取消')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已取消 AI 生成')).toBeVisible()

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
  await page.getByRole('button', { name: '系统测试题型', exact: true }).click()
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
  await page
    .getByRole('alertdialog', { name: '发布当前题型草稿？' })
    .getByRole('button', { name: '发布题型' })
    .click()
  const publishSummary = page.getByRole('alert').filter({
    hasText: '发布前需要修正以下内容'
  })
  await expect(publishSummary).toContainText('发布前需要修正以下内容')
  await expect(publishSummary).toContainText('变量名不能为空')

  const inspector = page.getByLabel('字段结构')
  await inspector.getByLabel('变量名').fill('answerText')
  await inspector.getByLabel('描述').fill('答案文本')
  await inspector.getByLabel('示例').fill('示例答案')
  await inspector.getByLabel('字段标识').fill('answer')
  await inspector.getByLabel('字段标识').press('Tab')
  await page.getByRole('button', { name: '发布' }).click()
  await page
    .getByRole('alertdialog', { name: '发布当前题型草稿？' })
    .getByRole('button', { name: '发布题型' })
    .click()
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
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('tab', { name: '草稿' }).click()
  await expect(page.getByRole('tab', { name: '草稿', selected: true })).toBeVisible()
  await page.getByRole('button', { name: '删除草稿', exact: true }).click()
  await page.locator('[aria-modal="true"]').getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除草稿“待删除草稿”')).toBeVisible()
  await expect(page.getByText('暂无草稿')).toBeVisible()

  await page.getByRole('button', { name: '新建题型' }).click()
  await page.getByLabel('题型内容').getByLabel('名称').fill('未保存草稿')
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  const dialog = page.locator('[aria-modal="true"]')
  await expect(dialog.getByText('放弃未保存的修改？')).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '未保存草稿' })).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await page.locator('[aria-modal="true"]').getByRole('button', { name: '放弃修改' }).click()
  await expect(page.getByRole('tab', { name: '草稿', selected: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '未命名题型', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '未保存草稿', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '题型' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
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
  await page.getByRole('button', { name: '系统测试题组', exact: true }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('保存的标题')
  await expect(page.getByLabel('answer 内容')).toHaveValue('保存的答案')

  await page.getByLabel('title 内容').fill('未保存的修改')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  const dialog = page.locator('[aria-modal="true"]')
  await expect(dialog.getByText('放弃未保存的修改？')).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('未保存的修改')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.locator('[aria-modal="true"]').getByRole('button', { name: '放弃修改' }).click()
  await expect(page.getByRole('button', { name: '系统测试题组', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '系统测试题组', exact: true }).click()
  await expect(page.getByLabel('title 内容')).toHaveValue('保存的标题')
})

test('IE-08 replaces instance values from JSON and reports invalid JSON', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name)
  await page.getByRole('button', { name: '高级操作' }).click()
  await page.getByRole('menuitem', { name: '从 JSON 覆盖' }).click()
  await page.getByLabel('JSON 内容').fill('{"title":"JSON 标题","answer":"JSON 答案"}')
  await page.getByRole('button', { name: '校验并覆盖' }).click()
  await expect(page.getByText('已从 JSON 更新题组')).toBeVisible()
  await expect(page.getByLabel('title 内容')).toHaveValue('JSON 标题')
  await expect(page.getByLabel('answer 内容')).toHaveValue('JSON 答案')
  const persisted = await readInstance(interfaceId)
  expect(persisted.instance.values).toEqual({ titleText: 'JSON 标题', answerText: 'JSON 答案' })

  await page.getByRole('button', { name: '高级操作' }).click()
  await page.getByRole('menuitem', { name: '从 JSON 覆盖' }).click()
  await page.getByLabel('JSON 内容').fill('{"broken":')
  await page.getByRole('button', { name: '校验并覆盖' }).click()
  await page
    .getByRole('alertdialog', { name: '覆盖当前题组内容？' })
    .getByRole('button', { name: '校验并覆盖' })
    .click()
  await expect(page.getByRole('alert')).toContainText('JSON 格式不合法')
  await expect(page.getByLabel('title 内容')).toHaveValue('JSON 标题')
  await page.getByRole('button', { name: '取消' }).click()
  await expect(page.getByLabel('JSON 内容')).toBeHidden()
})

test('IE-08b generates image fields from JSON without selecting a text model', async () => {
  await saveImageProvider(imageProvider('ie-json-image', 'mock-image'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)

  await page.getByRole('button', { name: '高级操作' }).click()
  await page.getByRole('menuitem', { name: '从 JSON 覆盖' }).click()
  const jsonDialog = page.getByRole('dialog', { name: '从 JSON 覆盖题组' })
  await expect(jsonDialog.getByLabel('生成模型')).toHaveCount(0)
  await jsonDialog
    .getByLabel('图像 Provider', { exact: true })
    .selectOption({ label: 'mock-image' })
  await jsonDialog
    .getByLabel('JSON 内容')
    .fill('{"title":"JSON 图片题","picture":"A JSON green circle icon"}')
  await jsonDialog.getByRole('button', { name: '校验并覆盖' }).click()

  await expect(page.getByText('已从 JSON 更新题组')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByLabel('title 内容')).toHaveValue('JSON 图片题')
  await expect(page.getByLabel('picture图片提示词')).toHaveValue('A JSON green circle icon')
  await expect(page.getByAltText('picture预览')).toBeVisible()
  await expectRenderedAssetsToLoad(1)

  expect(mockServer.findRequest('/v1/chat/completions')).toBeUndefined()
  expect(mockServer.findRequest('/v1/images/generations')?.body).toMatchObject({
    model: 'mock-image',
    prompt: 'A JSON green circle icon'
  })
  expect(await readInstance(interfaceId)).toMatchObject({
    instance: {
      values: { titleText: 'JSON 图片题' },
      imagePrompts: { pictureImage: 'A JSON green circle icon' }
    },
    assets: [expect.stringMatching(/^pictureImage-[0-9a-f-]{36}\.png$/)]
  })
})

test('IE-09 deletes an instance through the real UI', async () => {
  const interfaceId = await seedInterface(textInterface)
  await openInstanceEditor(interfaceId, textInterface.name, '待删除题组')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '题组操作：待删除题组' }).click()
  await page.getByRole('menuitem', { name: '删除题组' }).click()
  await page.locator('[aria-modal="true"]').getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除题组“待删除题组”')).toBeVisible()
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
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: textInterface.name, exact: true }).click()
  await page.getByRole('tab', { name: '题型定义' }).click()
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
  await page.getByRole('button', { name: '导出题型' }).click()
  await expect(page.getByRole('heading', { name: '选择要交付的题组' })).toBeVisible()
  await expect(page.getByText('已选择 1 个')).toBeVisible()
  await page.getByRole('button', { name: '导出题型' }).click()
  await expect(page.getByText('题型已导出')).toBeVisible()
  const exported = await readFile(exportPath)
  expect(exported.length).toBeGreaterThan(0)
  expect(exported.subarray(0, 2).toString()).toBe('PK')

  await clearPublishedInterface(interfaceId)
  await page.reload()
  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('button', { name: textInterface.name, exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上海高考英语口语', exact: true })).toBeVisible()

  await electronApp.evaluate(({ dialog }, filePath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
    })
  }, exportPath)
  await page.getByRole('button', { name: '题型库操作' }).click()
  await page.getByRole('menuitem', { name: '导入题型' }).click()
  await expect(page.getByRole('heading', { name: '审查题型文件' })).toBeVisible()
  await expect(page.getByText('可以导入')).toBeVisible()
  await page.getByRole('button', { name: '导入选中的题组' }).click()
  await expect(page.getByText('题型已导入')).toBeVisible()
  const importedRow = page.locator('article').filter({ hasText: textInterface.name })
  await expect(
    importedRow.getByRole('button', { name: textInterface.name, exact: true })
  ).toBeVisible()
  await importedRow.getByRole('button', { name: textInterface.name, exact: true }).click()
  await expect(page.getByRole('button', { name: '集成测试题组', exact: true })).toBeVisible()
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
  await expect(structure.locator('[data-field-path="group1"]')).toBeVisible()
  await expect(structure.locator('[data-field-path="group1.field1"]')).toBeVisible()

  await structure.locator('[data-field-path="group1.field1"]').click()
  await structure.getByLabel('类型').selectOption('image')
  await structure.getByLabel('变量名').fill('pictureText')
  await structure.getByLabel('描述').fill('配图提示词')
  await structure.getByLabel('示例').fill('示例图片提示词')
  await structure.getByLabel('字段标识').fill('picture')
  await structure.getByLabel('字段标识').press('Tab')

  await page.getByRole('button', { name: '删除节点' }).click()
  await expect(structure.locator('[data-field-path="group1.picture"]')).toHaveCount(0)
  await expect(structure.locator('[data-field-path="group1"]')).toBeVisible()

  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('草稿已保存')).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await page.getByRole('button', { name: '字段树操作题型', exact: true }).click()
  await expect(structure.locator('[data-field-path="group1"]')).toBeVisible()
})

test('IE-13 drives the instance image field buttons end to end', async () => {
  await saveImageProvider(imageProvider('ie-field-image', 'mock-image'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)

  await page.getByLabel('picture图片提示词').fill('A green circle icon')
  await page.getByLabel('picture图像 Provider').selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成图片' }).click()
  await expect(page.getByText('图片已生成，请保存题组')).toBeVisible()
  const preview = page.getByAltText('picture预览')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveCSS('object-fit', 'scale-down')
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
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page
    .getByRole('alertdialog', { name: '放弃未保存的修改？' })
    .getByRole('button', { name: '放弃修改' })
    .click()
})

test('IE-14 covers list and details page action buttons', async () => {
  await seedInterface(textInterface)
  await page.getByRole('link', { name: '题型库' }).click()
  const interfaceRow = page.locator('article').filter({ hasText: textInterface.name })
  await interfaceRow.getByRole('button', { name: textInterface.name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: textInterface.name })).toBeVisible()
  await createInstanceFromDetails('操作按钮题组')
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '操作按钮题组', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: '操作按钮题组' })).toBeVisible()
  await page.getByRole('button', { name: '返回题型详情' }).click()

  const originalText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await page.getByRole('tab', { name: '题型定义' }).click()
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

test('IE-15 drives the standalone AI image task dialog end to end', async () => {
  await saveImageProvider(imageProvider('ie-panel-image', 'mock-image'))
  await saveImageProvider(imageProvider('ie-panel-slow', 'mock-slow'))
  const interfaceId = await seedInterface(imageInterface)
  await openInstanceEditor(interfaceId, imageInterface.name)
  await page.getByLabel('picture图片提示词').fill('A green circle icon')

  await page.getByRole('button', { name: '批量生图' }).click()
  const dialog = page.getByRole('dialog', { name: 'AI 生图' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('将为 1 个已填写提示词的字段生成图片，成功后立即保存')
  await dialog.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await dialog.getByRole('button', { name: '开始生图' }).click()
  await expect(dialog.getByText('生图完成')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('AI 生图结果已保存')).toBeVisible()
  await dialog.getByRole('button', { name: '返回题组' }).click()
  await expect(page.getByAltText('picture预览')).toBeVisible()
  await expectRenderedAssetsToLoad(1)

  await page.getByRole('button', { name: '批量生图' }).click()
  const slowPanel = page.getByLabel('AI 生图', { exact: true })
  await slowPanel.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-slow' })
  await slowPanel.getByRole('button', { name: '开始生图' }).click()
  await slowPanel.getByRole('button', { name: '取消生图' }).click()
  await expect(page.getByText('生图已取消')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('已取消 AI 生图')).toBeVisible()
})

test('IE-16 installs all bundled Shanghai Interfaces on first launch', async () => {
  await page.getByRole('link', { name: '题型库' }).click()
  const builtin = page.getByRole('button', { name: '上海高考英语口语', exact: true })
  await expect(builtin).toBeVisible()
  await expect(page.getByRole('button', { name: '上海中考英语口语', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '上海高考英语听力', exact: true })).toBeVisible()
  await expect(page.getByText('内置', { exact: true })).toHaveCount(3)
  await builtin.click()
  await expect(page.getByText('内置题型')).toBeVisible()
  await expect(page.getByRole('button', { name: '新建题组' })).toBeVisible()
  await page.getByRole('tab', { name: '题型定义' }).click()
  await expect(page.getByText('sentence1', { exact: true })).toBeVisible()
})

test('IE-17 manages a bundled instance and copies the builtin to a draft', async () => {
  await saveTextProvider(textProvider('ie-builtin-manage-text', 'mock-json-shanghai'))
  await saveImageProvider(imageProvider('ie-builtin-manage-image', 'mock-image'))
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
  await expect(page.getByText('内置题型', { exact: true })).toBeVisible()

  await createInstanceFromDetails('上海内置回归题组')
  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-shanghai' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '返回题组' }).click()
  await page.getByLabel('题组名称').fill('上海内置回归题组')
  await page.getByLabel('sentence1 内容').fill('A saved sentence from the bundled Interface.')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('题组已保存')).toBeVisible()

  await page.getByRole('button', { name: '返回题型详情' }).click()
  await expect(page.getByRole('button', { name: '上海内置回归题组', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '上海内置回归题组', exact: true }).click()
  await expect(page.getByLabel('sentence1 内容')).toHaveValue(
    'A saved sentence from the bundled Interface.'
  )

  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('tab', { name: '题型定义' }).click()
  await page.getByRole('button', { name: '复制为草稿' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '上海高考英语口语' })).toBeVisible()
  await page.getByRole('button', { name: '返回草稿列表' }).click()
  await expect(page.getByRole('button', { name: '上海高考英语口语', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: '题型' }).click()
  await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
  await page.getByRole('button', { name: '题组操作：上海内置回归题组' }).click()
  await page.getByRole('menuitem', { name: '删除题组' }).click()
  await page.locator('[aria-modal="true"]').getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除题组“上海内置回归题组”')).toBeVisible()
  await expect(page.getByText('暂无题组')).toBeVisible()

  expect(
    await listFileStoreScopes([
      'interfaces',
      'builtin',
      BUILTIN_KEY,
      'versions',
      BUNDLED_INTERFACE_ID.slice('sha256:'.length),
      'instances'
    ])
  ).toEqual([])
})

test('IE-18 generates and persists an image in a bundled picture field', async () => {
  await saveTextProvider(textProvider('ie-builtin-image-text', 'mock-json-shanghai'))
  await saveImageProvider(imageProvider('ie-builtin-image', 'mock-image'))
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
  await createInstanceFromDetails('内置图片题组')
  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-shanghai' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '返回题组' }).click()
  await page.getByLabel('题组名称').fill('内置图片题组')

  const pictureField = page
    .locator('section')
    .filter({ has: page.getByLabel('picture1图片提示词') })
    .last()
  await pictureField
    .getByLabel('picture1图片提示词')
    .fill('A clean educational illustration of a park.')
  await pictureField.getByLabel('picture1图像 Provider').selectOption({ label: 'mock-image' })
  await pictureField.getByRole('button', { name: '生成图片' }).click()
  await expect(page.getByText('图片已生成，请保存题组')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByAltText('picture1预览')).toBeVisible()
  expect(
    mockServer
      .allRequests()
      .filter((request) => request.path === '/v1/images/generations')
      .at(-1)?.body
  ).toMatchObject({
    model: 'mock-image',
    prompt: 'A clean educational illustration of a park.'
  })

  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('题组已保存')).toBeVisible()
  await page.getByRole('button', { name: '返回题型详情' }).click()
  await page.getByRole('button', { name: '内置图片题组', exact: true }).click()
  await expect(page.getByLabel('picture1图片提示词')).toHaveValue(
    'A clean educational illustration of a park.'
  )
  await expect(page.getByAltText('picture1预览')).toBeVisible()
  await expectRenderedAssetsToLoad(4)

  const instanceIds = await listFileStoreScopes([
    'interfaces',
    'builtin',
    BUILTIN_KEY,
    'versions',
    BUNDLED_INTERFACE_ID.slice('sha256:'.length),
    'instances'
  ])
  expect(instanceIds).toEqual([expect.any(String)])
  const instanceScope = [
    'interfaces',
    'builtin',
    BUILTIN_KEY,
    'versions',
    BUNDLED_INTERFACE_ID.slice('sha256:'.length),
    'instances',
    instanceIds[0]
  ]
  const stored = await readFileStoreText<{
    instance: { values: Record<string, string>; imagePrompts?: Record<string, string> }
    assets: string[]
  }>(instanceScope, 'instance.json')
  expect(stored?.instance.imagePrompts).toMatchObject({
    picture_file1: 'A clean educational illustration of a park.'
  })
  expect(stored?.assets).toHaveLength(4)
  expect(stored?.instance.values.picture_file1).toMatch(/^picture_file1-[0-9a-f-]+\.png$/)
  expect(stored?.assets).toContain(stored?.instance.values.picture_file1)
  await expect(listFileStoreScopes(instanceScope)).resolves.toEqual([])
  await expect(
    page.evaluate(
      (location) =>
        (
          window as unknown as {
            fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
          }
        ).fileStore.invoke('file:list-assets', location),
      instanceScope
    )
  ).resolves.toEqual(stored?.assets)
})

test('IE-23 generates all four bundled story pictures through the AI pipeline', async () => {
  await saveTextProvider(textProvider('ie-builtin-text', 'mock-json-shanghai'))
  await saveImageProvider(imageProvider('ie-builtin-four-images', 'mock-image'))
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: '上海高考英语口语', exact: true }).click()
  await createInstanceFromDetails('内置四图题组')

  await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
  await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json-shanghai' })
  await page.getByLabel('图像 Provider', { exact: true }).selectOption({ label: 'mock-image' })
  await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()

  await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
  await expect(page.getByAltText('picture1预览')).toBeVisible()
  await expect(page.getByAltText('picture2预览')).toBeVisible()
  await expect(page.getByAltText('picture3预览')).toBeVisible()
  await expect(page.getByAltText('picture4预览')).toBeVisible()
  await expectRenderedAssetsToLoad(4)

  const imageRequests = mockServer
    .allRequests()
    .filter((request) => request.path === '/v1/images/generations')
  expect(imageRequests).toHaveLength(4)
  expect(imageRequests.map((request) => request.body.prompt)).toEqual([
    'Shanghai story picture 1',
    'Shanghai story picture 2',
    'Shanghai story picture 3',
    'Shanghai story picture 4'
  ])

  const interfaceIds = await listFileStoreScopes([
    'interfaces',
    'builtin',
    BUILTIN_KEY,
    'versions',
    BUNDLED_INTERFACE_ID.slice('sha256:'.length),
    'instances'
  ])
  expect(interfaceIds).toEqual([expect.any(String)])
  const instanceScope = [
    'interfaces',
    'builtin',
    BUILTIN_KEY,
    'versions',
    BUNDLED_INTERFACE_ID.slice('sha256:'.length),
    'instances',
    interfaceIds[0]
  ]
  const stored = await readFileStoreText<{
    instance: { values: Record<string, string>; imagePrompts?: Record<string, string> }
    assets: string[]
  }>(instanceScope, 'instance.json')
  expect(stored?.assets).toHaveLength(4)
  expect(stored?.instance.imagePrompts).toEqual({
    picture_file1: 'Shanghai story picture 1',
    picture_file2: 'Shanghai story picture 2',
    picture_file3: 'Shanghai story picture 3',
    picture_file4: 'Shanghai story picture 4'
  })
  for (const varName of ['picture_file1', 'picture_file2', 'picture_file3', 'picture_file4']) {
    const filename = stored?.instance.values[varName]
    expect(filename).toMatch(new RegExp(`^${varName}-[0-9a-f-]+\\.png$`))
    expect(stored?.assets).toContain(filename)
  }
})

test('IE-19 keeps bundled Interface installation idempotent across restarts', async () => {
  await expect(
    listFileStoreScopes(['interfaces', 'builtin', BUILTIN_KEY, 'versions'])
  ).resolves.toEqual([BUNDLED_INTERFACE_ID.slice('sha256:'.length)])
  await expect(
    readFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json')
  ).resolves.toEqual({
    builtinKey: BUILTIN_KEY,
    currentInterfaceId: BUNDLED_INTERFACE_ID
  })

  await restartIntegrationApp()
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('button', { name: '上海高考英语口语', exact: true })).toHaveCount(1)
  await expect(
    listFileStoreScopes(['interfaces', 'builtin', BUILTIN_KEY, 'versions'])
  ).resolves.toEqual([BUNDLED_INTERFACE_ID.slice('sha256:'.length)])
  await expect(
    readFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json')
  ).resolves.toEqual({
    builtinKey: BUILTIN_KEY,
    currentInterfaceId: BUNDLED_INTERFACE_ID
  })
})

test('IE-20 migrates bundled instances, assets and template references after restart', async () => {
  const bundled = await readBundledDefinition()
  const previous = structuralBuiltinVersion(bundled)
  const instanceId = randomUUID()
  const templateId = randomUUID()
  await writeBuiltinState(previous)
  await writeBuiltinInstance(previous, instanceId, '待迁移的上海题组', ['reference.png'])
  await writeFileStoreAsset(
    [
      'interfaces',
      'builtin',
      BUILTIN_KEY,
      'versions',
      previous.id.slice('sha256:'.length),
      'instances',
      instanceId
    ],
    'reference.png',
    [1, 2, 3, 4]
  )
  await writeTemplateInterfaceReference(templateId, previous.id)

  await restartIntegrationApp()
  const dialog = page.locator('[aria-modal="true"]')
  await expect(dialog.getByText('内置题型需要迁移')).toBeVisible()
  await expect(dialog).toContainText('上海高考英语口语')
  await dialog.getByRole('button', { name: '迁移并更新' }).click()
  await expect(dialog).toBeHidden()

  await expect(
    readFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json')
  ).resolves.toMatchObject({ currentInterfaceId: BUNDLED_INTERFACE_ID })
  await expect(
    listFileStoreScopes(['interfaces', 'builtin', BUILTIN_KEY, 'versions'])
  ).resolves.toEqual([BUNDLED_INTERFACE_ID.slice('sha256:'.length)])
  await expect(
    listFileStoreScopes([
      'interfaces',
      'builtin',
      BUILTIN_KEY,
      'versions',
      BUNDLED_INTERFACE_ID.slice('sha256:'.length),
      'instances'
    ])
  ).resolves.toEqual([instanceId])
  await expect(
    readFileStoreText(
      [
        'interfaces',
        'builtin',
        BUILTIN_KEY,
        'versions',
        BUNDLED_INTERFACE_ID.slice('sha256:'.length),
        'instances',
        instanceId
      ],
      'instance.json'
    )
  ).resolves.toMatchObject({ instance: { instanceId, name: '待迁移的上海题组' } })
  await expect(
    page.evaluate(
      (location) =>
        (
          window as unknown as {
            fileStore: { invoke(channel: string, ...args: unknown[]): Promise<unknown> }
          }
        ).fileStore.invoke('file:read-asset', location),
      {
        scope: [
          'interfaces',
          'builtin',
          BUILTIN_KEY,
          'versions',
          BUNDLED_INTERFACE_ID.slice('sha256:'.length),
          'instances',
          instanceId
        ],
        filename: 'reference.png'
      }
    )
  ).resolves.toEqual(expect.anything())
  await expect(
    readFileStoreText(['template-editor', 'templates', templateId], 'template.json')
  ).resolves.toMatchObject({
    revision: 1,
    content: { interfaces: [{ interfaceId: BUNDLED_INTERFACE_ID }] }
  })
})

test('IE-21 can keep the previous bundled version as a published Interface', async () => {
  const bundled = await readBundledDefinition()
  const previous = structuralBuiltinVersion(bundled)
  const instanceId = randomUUID()
  await writeBuiltinState(previous)
  await writeBuiltinInstance(previous, instanceId, '保留旧版的上海题组')

  await restartIntegrationApp()
  const dialog = page.locator('[aria-modal="true"]')
  await expect(dialog.getByText('内置题型需要迁移')).toBeVisible()
  await dialog.getByRole('button', { name: '保留旧版' }).click()
  await expect(dialog).toBeHidden()

  await expect(
    readFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json')
  ).resolves.toMatchObject({ currentInterfaceId: BUNDLED_INTERFACE_ID })
  await expect(
    listFileStoreScopes(['interfaces', 'builtin', BUILTIN_KEY, 'versions'])
  ).resolves.toEqual([BUNDLED_INTERFACE_ID.slice('sha256:'.length)])
  await expect(listFileStoreScopes(['interfaces', 'published'])).resolves.toContain(
    previous.id.slice('sha256:'.length)
  )
  await expect(
    listFileStoreScopes([
      'interfaces',
      'published',
      previous.id.slice('sha256:'.length),
      'instances'
    ])
  ).resolves.toEqual([instanceId])

  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('button', { name: '上海高考英语口语', exact: true })).toHaveCount(2)
  await expect(page.getByText('内置', { exact: true })).toHaveCount(3)
})

test('IE-22 refuses a bundled update that changes its variable contract', async () => {
  const bundled = await readBundledDefinition()
  const previous = contractChangedBuiltinVersion(bundled)
  await writeBuiltinState(previous)

  await restartIntegrationApp()
  const dialog = page.locator('[aria-modal="true"]')
  await expect(dialog.getByText('内置题型无法自动更新')).toBeVisible()
  await expect(dialog).toContainText('变量名称或类型')
  await dialog.getByRole('button', { name: '知道了' }).click()
  await expect(dialog).toBeHidden()

  await expect(
    readFileStoreText(['interfaces', 'builtin', BUILTIN_KEY], 'current.json')
  ).resolves.toMatchObject({ currentInterfaceId: previous.id })
  await expect(
    listFileStoreScopes(['interfaces', 'builtin', BUILTIN_KEY, 'versions'])
  ).resolves.toEqual([previous.id.slice('sha256:'.length)])
  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('button', { name: '上海高考英语口语', exact: true })).toHaveCount(1)
})
