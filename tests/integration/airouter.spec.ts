import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { MOCK_PNG_BASE64, MockAiServer } from './support/mock-ai-server'
import { launchIntegrationApp } from './support/electron-app'

interface ModelConfig {
  id: string
  enabled: boolean
}

interface ProviderInput {
  id?: string
  name: string
  type: 'openai-compatible' | 'anthropic'
  baseUrl: string
  models: ModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

interface ImageProviderInput {
  id?: string
  name: string
  type: 'manual' | 'openai-compatible'
  baseUrl: string
  models: ModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

interface StreamEvent {
  type: 'chunk' | 'done' | 'error'
  chunk?: { type: 'output' | 'reasoning'; delta: string }
  message?: string
}

interface ImageEvent {
  type: 'result' | 'error'
  image?: { data: Uint8Array; mediaType: string }
  message?: string
}

interface SpeechProviderInput {
  id?: string
  name: string
  kind: 'online' | 'local'
  type: 'openai-compatible' | 'pocket-tts' | 'qwen-tts'
  baseUrl?: string
  modelPackageId?: string
  modelPackageVersion?: string
  models: ModelConfig[]
  voices: ModelConfig[]
  apiKey?: string
  clearApiKey?: boolean
}

interface SpeechEvent {
  type: 'result' | 'error'
  audio?: {
    data: Uint8Array
    mediaType: string
    format: 'wav' | 'mp3' | 'opus' | 'pcm-s16le'
    sampleRate?: number
    channels?: number
    durationMs?: number
  }
  message?: string
}

interface SpeechTarget {
  providerConfigId: string
  modelId: string
  voiceId: string
}

interface SpeechRouting {
  default: SpeechTarget
  man?: SpeechTarget
  woman?: SpeechTarget
}

const mockServer = new MockAiServer()

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[]
let cachedPocketTtsPackage: Uint8Array | undefined

test.beforeAll(async () => mockServer.start())
test.afterAll(async () => mockServer.close())

test.beforeEach(async () => {
  mockServer.reset()
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-airouter-'))
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

async function openAirouter(
  tab: '文本生成' | '图像生成' | '语音合成' | '语音识别' = '文本生成'
): Promise<void> {
  await page.getByRole('link', { name: '设置' }).click()
  await page.getByRole('button', { name: /AI 引擎/ }).click()
  await expect(page.getByRole('tab', { name: '文本生成' })).toBeVisible()
  if (tab !== '文本生成') await page.getByRole('tab', { name: tab }).click()
  await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
}

async function addModel(id: string, image = false): Promise<void> {
  await page.getByLabel(image ? '手动图像模型 ID' : '手动模型 ID').fill(id)
  await page.getByRole('button', { name: '添加', exact: true }).click()
}

async function saveTextProvider(input: ProviderInput): Promise<Record<string, unknown>> {
  return page.evaluate((config) => window.airouter.saveProviderConfig(config), input)
}

async function saveImageProvider(input: ImageProviderInput): Promise<Record<string, unknown>> {
  return page.evaluate((config) => window.airouter.saveImageProviderConfig(config), input)
}

async function saveSpeechProvider(input: SpeechProviderInput): Promise<Record<string, unknown>> {
  return page.evaluate((config) => window.airouter.saveSpeechProviderConfig(config), input)
}

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

function speechProvider(
  id: string,
  modelIds: string[] = ['mock-speech'],
  voiceIds: string[] = ['alloy']
): SpeechProviderInput {
  return {
    id,
    name: id,
    kind: 'online',
    type: 'openai-compatible',
    baseUrl: mockServer.baseUrl,
    models: modelIds.map((modelId) => ({ id: modelId, enabled: true })),
    voices: voiceIds.map((voiceId) => ({ id: voiceId, enabled: true })),
    apiKey: `${id}-secret`
  }
}

async function collectText(providerConfigId: string, modelId: string): Promise<StreamEvent[]> {
  return collectTextRequest({ providerConfigId, modelId, prompt: 'Integration prompt' })
}

async function collectTextRequest(request: {
  providerConfigId: string
  modelId: string
  prompt: string
}): Promise<StreamEvent[]> {
  return page.evaluate(
    (input) =>
      new Promise((resolve) => {
        const events: StreamEvent[] = []
        window.airouter.startTextGeneration(input, (event) => {
          events.push(event)
          if (event.type === 'done' || event.type === 'error') resolve(events)
        })
      }),
    request
  )
}

async function collectImage(
  providerConfigId: string,
  modelId: string,
  size?: { width: number; height: number }
): Promise<ImageEvent> {
  return collectImageRequest({
    providerConfigId,
    modelId,
    prompt: 'A green circle',
    size
  })
}

async function collectImageRequest(request: {
  providerConfigId: string
  modelId: string
  prompt: string
  size?: { width: number; height: number }
}): Promise<ImageEvent> {
  return page.evaluate(
    (input) =>
      new Promise((resolve) => {
        window.airouter.startImageGeneration(input, resolve)
      }),
    request
  )
}

async function collectSpeech(request: {
  text: string
  routing: SpeechRouting
  format?: 'wav' | 'mp3' | 'opus' | 'pcm-s16le'
}): Promise<SpeechEvent> {
  return page.evaluate(
    (input) =>
      new Promise((resolve) => {
        window.airouter.startSpeechSynthesis(input, resolve)
      }),
    request
  )
}

async function selectFileInElectronDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath], bookmarks: [] })
    })
  }, filePath)
}

test('AR-01 navigates through AI engine settings categories', async () => {
  await openAirouter()
  for (const name of ['图像生成', '语音合成', '语音识别', '文本生成'] as const) {
    await page.getByRole('tab', { name }).click()
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.getByText('尚未添加文本生成 Provider')).toBeVisible()
  await page.getByRole('tab', { name: '语音合成' }).click()
  await expect(page.getByRole('heading', { name: '语音 Provider' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'TTS 模型包' })).toBeVisible()
  await page.getByRole('tab', { name: '语音识别' }).click()
  await expect(
    page.getByText('语音识别模型的 Provider、模型和连接测试将在这里配置。')
  ).toBeVisible()
})

test('AR-02 exposes the text empty state and default manual image provider', async () => {
  await openAirouter()
  await expect(page.getByText('共 0 个 Provider')).toBeVisible()
  await expect(page.getByText('尚未添加文本生成 Provider')).toBeVisible()
  await page.getByRole('tab', { name: '图像生成' }).click()
  await expect(page.getByRole('button', { name: /手动生成/ })).toBeVisible()
  const state = await page.evaluate(async () => ({
    image: await window.airouter.listImageProviderConfigs(),
    text: await window.airouter.listProviderConfigs()
  }))
  expect(state.text).toEqual([])
  expect(state.image).toEqual([
    expect.objectContaining({ id: 'manual', name: '手动生成', type: 'manual', models: [] })
  ])
})

test('AR-03 creates and reloads an OpenAI-compatible provider through the UI', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Local OpenAI')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('openai-secret')
  await addModel('mock-text')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Local OpenAI”')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('已配置密钥')).toBeVisible()
  await page.reload()
  await openAirouter()
  await expect(page.getByRole('button', { name: /Local OpenAI/ })).toContainText('1 个已启用模型')
  const configs = await page.evaluate(() => window.airouter.listProviderConfigs())
  expect(configs).toEqual([
    expect.objectContaining({
      name: 'Local OpenAI',
      type: 'openai-compatible',
      baseUrl: mockServer.baseUrl,
      hasApiKey: true,
      catalogProviderId: '',
      models: [{ id: 'mock-text', enabled: true, maxOutputTokens: 128 * 1024 }]
    })
  ])
  expect(JSON.stringify(configs)).not.toContain('openai-secret')
})

test('AR-04 creates and reloads an Anthropic provider through the UI', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Local Anthropic')
  await page.getByLabel('Provider', { exact: true }).selectOption('anthropic')
  await expect(page.getByLabel('Base URL')).toHaveValue('https://api.anthropic.com/v1')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await addModel('mock-reasoning')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Local Anthropic”')).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await openAirouter()
  await page.getByRole('button', { name: /Local Anthropic/ }).click()
  await expect(page.getByLabel('Provider', { exact: true })).toHaveValue('自定义 Anthropic')
  await expect(page.getByLabel('Provider', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Base URL')).toHaveValue(mockServer.baseUrl)
  await expect(page.getByRole('checkbox', { name: 'mock-reasoning' })).toBeChecked()
  expect(await page.evaluate(() => window.airouter.listProviderConfigs())).toEqual([
    expect.objectContaining({
      name: 'Local Anthropic',
      type: 'anthropic',
      baseUrl: mockServer.baseUrl,
      models: [{ id: 'mock-reasoning', enabled: true, maxOutputTokens: 128 * 1024 }],
      hasApiKey: false
    })
  ])
})

test('AR-05 loads, replaces and clears a text provider API key', async () => {
  const saved = await saveTextProvider(textProvider('key-lifecycle', 'mock-text'))
  const id = String(saved.id)
  await openAirouter()
  await page.getByRole('button', { name: /key-lifecycle/ }).click()
  const apiKey = page.getByRole('textbox', { name: 'API Key', exact: true })
  await expect(apiKey).toHaveAttribute('placeholder', '已安全保存')
  await page.getByRole('button', { name: '显示 API Key' }).click()
  await expect(apiKey).toHaveValue('key-lifecycle-secret')
  await apiKey.fill('replacement-secret')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“key-lifecycle”')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() => page.evaluate((value) => window.airouter.readProviderApiKey(value), id), {
      timeout: 10_000
    })
    .toBe('replacement-secret')
  await page.getByRole('button', { name: '显示 API Key' }).click()
  await expect(apiKey).toHaveValue('replacement-secret')
  await apiKey.fill('')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“key-lifecycle”').last()).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() => page.evaluate((value) => window.airouter.readProviderApiKey(value), id), {
      timeout: 10_000
    })
    .toBeNull()
})

test('AR-06 manages manual text models, enabled state, deduplication and removal', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Model Manager')
  await addModel('alpha')
  await addModel('alpha')
  await addModel('beta')
  await page.getByRole('checkbox', { name: 'beta' }).uncheck()
  await page.getByRole('button', { name: '移除模型 alpha' }).click()
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.airouter.listProviderConfigs()))[0]?.models ?? null,
      { timeout: 10_000 }
    )
    .toEqual([{ id: 'beta', enabled: false, maxOutputTokens: 128 * 1024 }])
})

test('AR-07 discovers, sorts and merges text models with the draft', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Discovery')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('discovery-secret')
  await addModel('mock-text')
  await addModel('custom-model')
  await page.getByRole('button', { name: '获取模型列表' }).click()
  await expect(page.getByText('获取到 5 个模型')).toBeVisible()
  const labels = await page
    .getByRole('checkbox')
    .evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label') ?? ''))
  expect(labels).toEqual([
    'a-model',
    'mock-image',
    'mock-reasoning',
    'mock-text',
    'z-model',
    'custom-model'
  ])
  await expect(page.getByRole('checkbox', { name: 'mock-text' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'custom-model' })).toBeChecked()
  const request = mockServer.findRequest('/v1/models')
  expect(request?.headers.authorization).toBe('Bearer discovery-secret')
})

test('AR-08 tests an unsaved OpenAI-compatible draft without persisting it', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Unsaved OpenAI')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('draft-secret')
  await addModel('mock-text')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功，模型回复：OK')).toBeVisible()
  expect(await page.evaluate(() => window.airouter.listProviderConfigs())).toEqual([])
  const request = mockServer.findRequest('/v1/chat/completions')
  expect(request?.headers.authorization).toBe('Bearer draft-secret')
})

test('AR-09 tests an unsaved Anthropic draft with its own protocol and headers', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Unsaved Anthropic')
  await page.getByLabel('Provider', { exact: true }).selectOption('anthropic')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('anthropic-secret')
  await addModel('mock-text')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功，模型回复：OK')).toBeVisible()
  const request = mockServer.findRequest('/v1/messages')
  expect(request?.headers['x-api-key']).toBe('anthropic-secret')
  expect(request?.headers['anthropic-version']).toBeTruthy()
  expect(mockServer.findRequest('/v1/chat/completions')).toBeUndefined()
})

test('AR-10 edits and deletes a text provider with its secret without affecting others', async () => {
  await saveTextProvider(textProvider('delete-me', 'mock-text'))
  await saveTextProvider(textProvider('keep-me', 'mock-text'))
  await openAirouter()
  await page.getByRole('button', { name: /delete-me/ }).click()
  await page.getByLabel('配置名称').fill('edited-provider')
  await addModel('second-model')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await page.getByRole('button', { name: '删除 Provider' }).click()
  await page.getByRole('button', { name: '删除配置' }).click()
  await expect(page.getByRole('button', { name: /edited-provider/ })).toBeHidden()
  const state = await page.evaluate(async () => {
    let deletedKeyError = ''
    try {
      await window.airouter.readProviderApiKey('delete-me')
    } catch (error) {
      deletedKeyError = error instanceof Error ? error.message : String(error)
    }
    return { configs: await window.airouter.listProviderConfigs(), deletedKeyError }
  })
  expect(state.configs).toEqual([expect.objectContaining({ id: 'keep-me', hasApiKey: true })])
  expect(state.deletedKeyError).toContain('Provider 配置不存在')
})

test('AR-11 streams OpenAI-compatible output across HTTP, main, IPC and preload', async () => {
  await saveTextProvider(textProvider('openai-stream', 'mock-text'))
  const events = await collectText('openai-stream', 'mock-text')
  expect(events).toEqual([
    { type: 'chunk', chunk: { type: 'output', delta: 'Mock ' } },
    { type: 'chunk', chunk: { type: 'output', delta: 'response' } },
    { type: 'done' }
  ])
  expect(mockServer.findRequest('/v1/chat/completions')?.body).toMatchObject({
    model: 'mock-text',
    messages: [{ role: 'user', content: 'Integration prompt' }],
    stream: true
  })
})

test('AR-12 streams Anthropic reasoning and output through the common chunk contract', async () => {
  await saveTextProvider(textProvider('anthropic-stream', 'mock-reasoning', 'anthropic'))
  const events = await collectText('anthropic-stream', 'mock-reasoning')
  expect(events.filter((event) => event.type === 'chunk')).toEqual([
    { type: 'chunk', chunk: { type: 'reasoning', delta: 'Mock reasoning' } },
    { type: 'chunk', chunk: { type: 'output', delta: 'Anthropic response' } }
  ])
  expect(events.at(-1)).toEqual({ type: 'done' })
})

test('AR-13 cancels text generation, closes HTTP work and allows a subsequent request', async () => {
  await saveTextProvider(textProvider('cancel-text', 'mock-slow'))
  const operation = page.evaluate(
    () =>
      new Promise<StreamEvent[]>((resolve) => {
        const events: StreamEvent[] = []
        const abort = window.airouter.startTextGeneration(
          { providerConfigId: 'cancel-text', modelId: 'mock-slow', prompt: 'Cancel me' },
          (event) => events.push(event)
        )
        ;(window as unknown as { __abortTextGeneration?: () => void }).__abortTextGeneration = abort
        setTimeout(() => resolve(events), 1_500)
      })
  )
  const request = await mockServer.waitForRequest(
    (item) => item.path === '/v1/chat/completions',
    10_000
  )
  await page.evaluate(() => {
    ;(window as unknown as { __abortTextGeneration?: () => void }).__abortTextGeneration?.()
  })
  expect(await operation).toEqual([])
  await expect.poll(() => request.closedBeforeResponse).toBe(true)
  await saveTextProvider(textProvider('after-cancel', 'mock-text'))
  expect((await collectText('after-cancel', 'mock-text')).at(-1)).toEqual({ type: 'done' })
})

test('AR-14 reports both provider protocols, stream failures and truncation', async () => {
  await saveTextProvider({
    ...textProvider('text-errors', 'mock-http-error'),
    models: ['mock-http-error', 'mock-stream-error', 'mock-length', 'mock-content-filter'].map(
      (id) => ({ id, enabled: true })
    )
  })
  await saveTextProvider(textProvider('anthropic-errors', 'mock-http-error', 'anthropic'))
  const http = await collectText('text-errors', 'mock-http-error')
  const anthropicHttp = await collectText('anthropic-errors', 'mock-http-error')
  const stream = await collectText('text-errors', 'mock-stream-error')
  const length = await collectText('text-errors', 'mock-length')
  const filtered = await collectText('text-errors', 'mock-content-filter')
  expect(http.at(-1)).toMatchObject({ type: 'error' })
  expect(http.at(-1)?.message).toContain('mock authentication failed')
  expect(anthropicHttp.at(-1)).toMatchObject({ type: 'error' })
  expect(anthropicHttp.at(-1)?.message).toContain('mock anthropic failure')
  expect(stream.at(-1)).toMatchObject({ type: 'error' })
  expect(stream.at(-1)?.message).toContain('mock stream failure')
  expect(length.at(-1)).toEqual({
    type: 'error',
    message: 'AI 输出达到长度上限，JSON 未完整生成；请减少字段内容后重试'
  })
  expect(filtered.at(-1)).toEqual({
    type: 'error',
    message: 'AI 输出被 Provider 的内容安全策略截断'
  })
})

test('AR-15 imports and cancels manual image generation through the global dialog', async () => {
  const originalClipboard = await electronApp.evaluate(({ clipboard }) => ({
    image: clipboard.readImage().toPNG(),
    text: clipboard.readText()
  }))
  try {
    const importPath = path.join(userDataDir, 'manual-import.png')
    await writeFile(importPath, Buffer.from(MOCK_PNG_BASE64, 'base64'))
    await electronApp.evaluate(({ dialog }, filePath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [filePath], bookmarks: [] })
      })
    }, importPath)
    await openAirouter('图像生成')
    await page.getByRole('button', { name: /手动生成/ }).click()
    await page.getByRole('button', { name: '测试手动生成' }).click()
    await expect(page.getByRole('heading', { name: '生成并导入图片' })).toBeVisible()
    await expect(page.getByLabel('图片提示词')).toHaveValue('一枚简洁的绿色圆形图标')
    await page.getByRole('button', { name: '选择文件' }).click()
    await expect(page.getByText('manual-import.png')).toBeVisible()
    await expect(page.getByAltText('待导入图片预览')).toBeVisible()
    await page.getByRole('button', { name: '使用此图片' }).click()
    await expect(page.getByText('测试图片已导入')).toBeVisible()

    await page.getByRole('button', { name: '测试手动生成' }).click()
    await page.getByRole('button', { name: '复制' }).click()
    await expect
      .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('一枚简洁的绿色圆形图标')
    await electronApp.evaluate(
      ({ clipboard, nativeImage }, base64) =>
        clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(base64, 'base64'))),
      MOCK_PNG_BASE64
    )
    await page.getByRole('button', { name: '从剪贴板读取' }).click()
    await expect(page.getByAltText('待导入图片预览')).toBeVisible()
    await page.getByRole('button', { name: '使用此图片' }).click()
    await expect(page.getByText('测试图片已导入')).toBeVisible()
    await page.getByRole('button', { name: '测试手动生成' }).click()
    await page.getByRole('button', { name: '取消图片生成' }).click()
    await expect(page.getByRole('heading', { name: '生成并导入图片' })).toBeHidden()
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

test('AR-16 saves and reloads an image provider with isolated config and secret scopes', async () => {
  await openAirouter('图像生成')
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('图像配置名称').fill('Image API')
  await page.getByLabel('图像 Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: '图像 API Key', exact: true }).fill('image-secret')
  await addModel('mock-image', true)
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Image API”')).toBeVisible({ timeout: 10_000 })
  const imageConfig = (await page.evaluate(() => window.airouter.listImageProviderConfigs())).find(
    (config) => config.type === 'openai-compatible'
  )
  expect(imageConfig).toBeTruthy()
  const sharedId = String(imageConfig?.id)
  await saveTextProvider({
    id: sharedId,
    name: 'Text API',
    type: 'openai-compatible',
    baseUrl: mockServer.baseUrl,
    models: [{ id: 'mock-text', enabled: true }],
    apiKey: 'text-domain-secret'
  })
  await page.reload()
  await openAirouter('图像生成')
  await expect(page.getByRole('button', { name: /Image API/ })).toContainText('1 个已启用模型')
  await page.getByRole('button', { name: /Image API/ }).click()
  await expect(page.getByLabel('图像 Provider 类型')).toBeDisabled()
  await expect(page.getByLabel('图像 Base URL')).toHaveValue(mockServer.baseUrl)
  const modelCheckbox = page.getByRole('checkbox', { name: 'mock-image' })
  const modelRow = modelCheckbox.locator('../..')
  await expect(modelCheckbox).toBeChecked()
  await expect(modelRow).toHaveCSS('display', 'flex')
  await expect(modelRow).toHaveCSS('min-height', '44px')
  await expect(modelRow).toHaveCSS('align-items', 'center')
  const state = await page.evaluate(
    async (id) => ({
      image: await window.airouter.listImageProviderConfigs(),
      imageKey: await window.airouter.readImageProviderApiKey(id),
      text: await window.airouter.listProviderConfigs(),
      textKey: await window.airouter.readProviderApiKey(id)
    }),
    sharedId
  )
  expect(state.image).toContainEqual(
    expect.objectContaining({
      id: sharedId,
      name: 'Image API',
      type: 'openai-compatible',
      baseUrl: mockServer.baseUrl,
      models: [{ id: 'mock-image', enabled: true }],
      hasApiKey: true
    })
  )
  expect(state.text).toEqual([
    expect.objectContaining({
      id: sharedId,
      name: 'Text API',
      models: [{ id: 'mock-text', enabled: true }],
      hasApiKey: true
    })
  ])
  expect(state.imageKey).toBe('image-secret')
  expect(state.textKey).toBe('text-domain-secret')
})

test('AR-17 discovers image models and previews an unsaved connection test', async () => {
  await openAirouter('图像生成')
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('图像配置名称').fill('Image Draft')
  await page.getByLabel('图像 Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: '图像 API Key', exact: true }).fill('image-draft-secret')
  await page.getByRole('button', { name: '获取模型列表' }).click()
  await expect(page.getByText('获取到 5 个模型')).toBeVisible()
  await page.getByRole('checkbox', { name: 'mock-image' }).check()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('连接成功，测试图片已生成')).toBeVisible()
  await expect(page.getByAltText('测试生成图片')).toBeVisible()
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toEqual([
    expect.objectContaining({ id: 'manual' })
  ])
  expect(mockServer.findRequest('/v1/images/generations')?.headers.authorization).toBe(
    'Bearer image-draft-secret'
  )
})

test('AR-18 generates an API image end to end with prompt and dimensions', async () => {
  await saveImageProvider(imageProvider('image-runtime', 'mock-image'))
  const event = await collectImage('image-runtime', 'mock-image', { width: 256, height: 128 })
  expect(event.type).toBe('result')
  expect(event.image?.mediaType).toBe('image/png')
  expect(Array.from(event.image?.data ?? [])).toEqual(
    Array.from(Buffer.from(MOCK_PNG_BASE64, 'base64'))
  )
  expect(mockServer.findRequest('/v1/images/generations')?.body).toMatchObject({
    model: 'mock-image',
    prompt: 'A green circle',
    size: '256x128'
  })
})

test('AR-19 reports image failures and suppresses results after cancellation', async () => {
  for (const model of ['mock-http-error', 'mock-invalid-media', 'mock-oversized', 'mock-slow']) {
    await saveImageProvider(imageProvider(model, model))
  }
  const http = await collectImage('mock-http-error', 'mock-http-error')
  const invalid = await collectImage('mock-invalid-media', 'mock-invalid-media')
  const oversized = await collectImage('mock-oversized', 'mock-oversized')
  expect(http).toMatchObject({ type: 'error' })
  expect(http.message).toContain('mock image quota exceeded')
  expect(invalid).toEqual({ type: 'error', message: '生成结果不是图片' })
  expect(oversized).toEqual({ type: 'error', message: '生成图片不能超过 20 MB' })

  mockServer.reset()
  const operation = page.evaluate(
    () =>
      new Promise<ImageEvent[]>((resolve) => {
        const values: ImageEvent[] = []
        const abort = window.airouter.startImageGeneration(
          { providerConfigId: 'mock-slow', modelId: 'mock-slow', prompt: 'Cancel image' },
          (event) => values.push(event)
        )
        ;(window as unknown as { __abortImageGeneration?: () => void }).__abortImageGeneration =
          abort
        setTimeout(() => resolve(values), 1_500)
      })
  )
  const request = await mockServer.waitForRequest(
    (item) => item.path === '/v1/images/generations',
    10_000
  )
  await page.evaluate(() => {
    ;(window as unknown as { __abortImageGeneration?: () => void }).__abortImageGeneration?.()
  })
  expect(await operation).toEqual([])
  await expect.poll(() => request.closedBeforeResponse).toBe(true)
})

test('AR-20 deletes image providers and restores the manual fallback with secret cleanup', async () => {
  await saveImageProvider(imageProvider('only-api', 'mock-image'))
  await page.evaluate(() => window.airouter.deleteImageProviderConfig('manual'))
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toEqual([
    expect.objectContaining({ id: 'only-api', hasApiKey: true })
  ])
  await saveImageProvider({
    ...imageProvider('only-api', 'mock-image'),
    models: [{ id: 'mock-image', enabled: false }]
  })
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toEqual([
    expect.objectContaining({
      id: 'only-api',
      models: [{ id: 'mock-image', enabled: false }]
    }),
    expect.objectContaining({ type: 'manual' })
  ])
  await openAirouter('图像生成')
  await page.getByRole('button', { name: /only-api/ }).click()
  await page.getByRole('button', { name: '删除 Provider' }).click()
  await page.getByRole('button', { name: '删除配置' }).click()
  await expect(page.getByRole('button', { name: /手动生成/ })).toBeVisible()
  const state = await page.evaluate(async () => {
    let deletedKeyError = ''
    try {
      await window.airouter.readImageProviderApiKey('only-api')
    } catch (error) {
      deletedKeyError = error instanceof Error ? error.message : String(error)
    }
    return { configs: await window.airouter.listImageProviderConfigs(), deletedKeyError }
  })
  expect(state.configs).toEqual([
    expect.objectContaining({ name: '手动生成', type: 'manual', hasApiKey: false })
  ])
  expect(state.deletedKeyError).toContain('图像 Provider 配置不存在')
})

test('AR-21 edits image models and completes the image API key lifecycle', async () => {
  await saveImageProvider(imageProvider('image-lifecycle', 'alpha'))
  await openAirouter('图像生成')
  await page.getByRole('button', { name: /image-lifecycle/ }).click()
  const apiKey = page.getByRole('textbox', { name: '图像 API Key', exact: true })
  await expect(apiKey).toHaveAttribute('placeholder', '已安全保存')
  await page.getByRole('button', { name: '显示图像 API Key' }).click()
  await expect(apiKey).toHaveValue('image-lifecycle-secret')
  await apiKey.fill('replacement-image-secret')
  await expect(apiKey).toHaveValue('replacement-image-secret')
  await page.getByLabel('图像配置名称').fill('Edited Image Provider')
  await addModel('beta', true)
  await addModel('beta', true)
  await addModel('remove-me', true)
  await page.getByRole('checkbox', { name: 'alpha' }).uncheck()
  await page.getByRole('button', { name: '移除图像模型 remove-me' }).click()
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Edited Image Provider”')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(() => page.evaluate(() => window.airouter.readImageProviderApiKey('image-lifecycle')), {
      timeout: 10_000
    })
    .toBe('replacement-image-secret')
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toContainEqual(
    expect.objectContaining({
      id: 'image-lifecycle',
      name: 'Edited Image Provider',
      models: [
        { id: 'alpha', enabled: false },
        { id: 'beta', enabled: true }
      ],
      hasApiKey: true
    })
  )

  await page.getByRole('button', { name: '显示图像 API Key' }).click()
  await expect(apiKey).toHaveValue('replacement-image-secret')
  await apiKey.fill('')
  await page.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Edited Image Provider”').last()).toBeVisible({
    timeout: 10_000
  })
  await expect
    .poll(() => page.evaluate(() => window.airouter.readImageProviderApiKey('image-lifecycle')), {
      timeout: 10_000
    })
    .toBeNull()
  await page.reload()
  await openAirouter('图像生成')
  await expect(page.getByRole('button', { name: /Edited Image Provider/ })).toContainText(
    '1 个已启用模型'
  )
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toContainEqual(
    expect.objectContaining({ id: 'image-lifecycle', hasApiKey: false })
  )
})

test('AR-22 reports failed text and image draft connection tests without persisting them', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Failed Text Draft')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('bad-text-key')
  await addModel('mock-http-error')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByRole('alert')).toContainText('mock authentication failed')
  expect(await page.evaluate(() => window.airouter.listProviderConfigs())).toEqual([])

  await page.reload()
  await openAirouter('图像生成')
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('图像配置名称').fill('Failed Image Draft')
  await page.getByLabel('图像 Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: '图像 API Key', exact: true }).fill('bad-image-key')
  await addModel('mock-http-error', true)
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByRole('alert')).toContainText('mock image quota exceeded', {
    timeout: 15_000
  })
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toEqual([
    expect.objectContaining({ id: 'manual' })
  ])
})

test('AR-23 rejects invalid image prompts and dimensions before issuing HTTP requests', async () => {
  await saveImageProvider(imageProvider('image-validation', 'mock-image'))
  const blankPrompt = await collectImageRequest({
    providerConfigId: 'image-validation',
    modelId: 'mock-image',
    prompt: '   '
  })
  const zeroWidth = await collectImageRequest({
    providerConfigId: 'image-validation',
    modelId: 'mock-image',
    prompt: 'invalid width',
    size: { width: 0, height: 128 }
  })
  const oversizedHeight = await collectImageRequest({
    providerConfigId: 'image-validation',
    modelId: 'mock-image',
    prompt: 'invalid height',
    size: { width: 128, height: 8193 }
  })
  const fractionalWidth = await collectImageRequest({
    providerConfigId: 'image-validation',
    modelId: 'mock-image',
    prompt: 'fractional width',
    size: { width: 128.5, height: 128 }
  })
  expect(blankPrompt).toEqual({ type: 'error', message: '图片提示词不能为空' })
  expect(zeroWidth).toEqual({
    type: 'error',
    message: '图片尺寸必须是 1 到 8192 之间的整数'
  })
  expect(oversizedHeight).toEqual(zeroWidth)
  expect(fractionalWidth).toEqual(zeroWidth)
  expect(mockServer.allRequests()).toEqual([])
})

test('AR-24 reports model discovery failures without persisting drafts', async () => {
  await openAirouter()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('配置名称').fill('Failed Discovery')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('discovery-bad-key')
  mockServer.failNextRequest('/v1/models', 500, {
    error: { message: 'mock model list failure' }
  })
  await page.getByRole('button', { name: '获取模型列表' }).click()
  await expect(page.getByRole('alert')).toContainText('获取模型列表失败（HTTP 500）')
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => window.airouter.listProviderConfigs())).toEqual([])

  await page.getByRole('button', { name: '关闭 Provider 编辑器' }).click()
  await page.getByRole('tab', { name: '图像生成' }).click()
  await page.getByRole('button', { name: '添加 Provider' }).click()
  await page.getByLabel('图像配置名称').fill('Image Failed Discovery')
  await page.getByLabel('图像 Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: '图像 API Key', exact: true }).fill('image-discovery-bad')
  mockServer.failNextRequest('/v1/models', 401, { error: { message: 'mock unauthorized' } })
  await page.getByRole('button', { name: '获取模型列表' }).click()
  await expect(page.getByText('获取模型列表失败（HTTP 401）')).toBeVisible()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => window.airouter.listImageProviderConfigs())).toEqual([
    expect.objectContaining({ id: 'manual' })
  ])
})

test('AR-25 closes an unsaved provider draft without persisting it', async () => {
  await openAirouter()
  const openDraft = async (): Promise<void> => {
    await page.getByRole('button', { name: '添加 Provider' }).click()
    await page.getByLabel('配置名称').fill('Unsaved Draft')
    await page.getByLabel('Base URL').fill(mockServer.baseUrl)
    await addModel('draft-model')
  }
  const assertClosedAndEmpty = async (): Promise<void> => {
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await page.evaluate(() => window.airouter.listProviderConfigs())).toEqual([])
  }

  await openDraft()
  await page.getByRole('button', { name: '取消' }).click()
  await assertClosedAndEmpty()

  await openDraft()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await assertClosedAndEmpty()

  await openDraft()
  const backdrop = page.locator('div[role="presentation"]').filter({
    has: page.getByRole('dialog')
  })
  await backdrop.click({ position: { x: 8, y: 8 } })
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()
  await assertClosedAndEmpty()
})

test('AR-26 constrains save and busy states in the provider editor', async () => {
  await saveTextProvider(textProvider('existing-state', 'mock-text'))
  await openAirouter()
  await page.getByRole('button', { name: /existing-state/ }).click()
  const save = page.getByRole('button', { name: '保存 Provider' })
  await expect(save).toBeDisabled()
  await page.getByLabel('配置名称').fill('changed-state-name')
  await expect(save).toBeEnabled()
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '添加 Provider' }).click()
  await expect(save).toBeDisabled()
  await page.getByLabel('配置名称').fill('State Test')
  await page.getByLabel('Base URL').fill(mockServer.baseUrl)
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('state-secret')
  await addModel('mock-slow')
  await expect(save).toBeEnabled()
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByLabel('配置名称')).toBeDisabled()
  await expect(page.getByLabel('Base URL')).toBeDisabled()
  await expect(save).toBeDisabled()
  await expect(page.getByText('连接成功，模型回复：OK')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('配置名称')).toBeEnabled()
  await expect(save).toBeEnabled()
})

test('AR-27 cancels text generation after partial output and reuses the pipeline', async () => {
  await saveTextProvider(textProvider('partial-cancel', 'mock-partial-stall'))
  const operation = page.evaluate(
    () =>
      new Promise<StreamEvent[]>((resolve) => {
        const events: StreamEvent[] = []
        const abort = window.airouter.startTextGeneration(
          {
            providerConfigId: 'partial-cancel',
            modelId: 'mock-partial-stall',
            prompt: 'Cancel me'
          },
          (event) => {
            events.push(event)
            if (event.type === 'chunk') {
              ;(window as unknown as { __abortPartialText?: () => void }).__abortPartialText = abort
            }
          }
        )
        setTimeout(() => resolve(events), 1_800)
      })
  )
  const request = await mockServer.waitForRequest(
    (item) => item.path === '/v1/chat/completions',
    10_000
  )
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __abortPartialText?: () => void }).__abortPartialText ===
            'function'
        ),
      { timeout: 5_000 }
    )
    .toBe(true)
  await page.evaluate(() => {
    ;(window as unknown as { __abortPartialText?: () => void }).__abortPartialText?.()
  })
  expect(await operation).toEqual([{ type: 'chunk', chunk: { type: 'output', delta: 'Partial ' } }])
  await expect.poll(() => request.closedBeforeResponse).toBe(true)
  await saveTextProvider(textProvider('after-partial-cancel', 'mock-text'))
  expect((await collectText('after-partial-cancel', 'mock-text')).at(-1)).toEqual({ type: 'done' })
})

test('AR-28 manages a local TTS model package and its Provider lifecycle', async () => {
  const packagePath = path.join(userDataDir, 'integration-pocket.zip')
  await writeFile(packagePath, createTestSpeechPackage())
  await openAirouter('语音合成')
  await expect(page.getByText('共 0 个 Provider')).toBeVisible()
  await expect(page.getByText('已安装 0 个模型包')).toBeVisible()

  await page.getByRole('button', { name: '添加 Provider' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('语音配置名称').fill('Local Pocket')
  await editor.getByLabel('语音运行方式').selectOption('local')
  await expect(editor.getByText('需要先导入 Pocket TTS 模型包')).toBeVisible()
  await expect(editor.getByRole('heading', { name: '启用模型' })).toBeHidden()

  await selectFileInElectronDialog(packagePath)
  await editor.getByRole('button', { name: '导入模型包' }).click()
  await expect(
    page.getByRole('button', {
      includeHidden: true,
      name: '删除模型包 Integration Pocket Package'
    })
  ).toBeVisible()
  await expect(editor.getByRole('heading', { name: '启用模型' })).toBeVisible()
  await expect(editor.getByRole('checkbox', { name: 'Pocket A (pocket-a)' })).toBeChecked()
  await expect(editor.getByRole('checkbox', { name: 'Pocket B (pocket-b)' })).toBeChecked()
  await expect(editor.getByRole('checkbox', { name: 'Alba (alba)' })).toBeChecked()
  await expect(editor.getByRole('checkbox', { name: 'Marius (marius)' })).toBeChecked()
  await expect(page.getByText('新增 1 个资源，复用 2 个资源')).toBeVisible()

  await editor.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Local Pocket”')).toBeVisible({ timeout: 10_000 })
  const savedState = await page.evaluate(async () => {
    const configs = await window.airouter.listSpeechProviderConfigs()
    const config = configs[0]
    return {
      configs,
      models: config ? await window.airouter.listSpeechModels(config) : [],
      voices: config ? await window.airouter.listSpeechVoices({ config, modelId: 'pocket-a' }) : []
    }
  })
  expect(savedState.configs).toEqual([
    expect.objectContaining({
      name: 'Local Pocket',
      kind: 'local',
      type: 'pocket-tts',
      modelPackageId: 'integration-pocket',
      modelPackageVersion: '1.0.0',
      models: [
        { id: 'pocket-a', enabled: true },
        { id: 'pocket-b', enabled: true }
      ],
      voices: [
        { id: 'alba', enabled: true },
        { id: 'marius', enabled: true }
      ],
      hasApiKey: false
    })
  ])
  expect(savedState.models).toEqual([
    { id: 'pocket-a', name: 'Pocket A', languageCodes: ['en'] },
    { id: 'pocket-b', name: 'Pocket B', languageCodes: ['en'] }
  ])
  expect(savedState.voices).toEqual([
    { id: 'alba', name: 'Alba', languageCodes: ['en'] },
    { id: 'marius', name: 'Marius', languageCodes: ['en'] }
  ])
  await editor.getByRole('button', { name: '取消' }).click()

  const packageRemove = page.getByRole('button', {
    name: '删除模型包 Integration Pocket Package'
  })
  await expect(packageRemove).toBeDisabled()
  await page.reload()
  await openAirouter('语音合成')
  await expect(page.getByRole('button', { name: /Local Pocket/ })).toContainText('2 个模型')
  await page.getByRole('button', { name: /Local Pocket/ }).click()
  await expect(page.getByLabel('语音运行方式')).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: 'Pocket A (pocket-a)' })).toBeChecked()
  await page.getByRole('button', { name: '删除 Provider' }).click()
  const providerConfirm = page.getByRole('alertdialog', { name: '删除语音 Provider？' })
  await providerConfirm.getByRole('button', { name: '删除 Provider' }).click()
  await expect(page.getByRole('button', { name: /Local Pocket/ })).toBeHidden()

  await page.getByRole('button', { name: '删除模型包 Integration Pocket Package' }).click()
  const packageConfirm = page.getByRole('alertdialog', { name: '删除 TTS 模型包？' })
  await packageConfirm.getByRole('button', { name: '删除模型包' }).click()
  await expect(page.getByText('已安装 0 个模型包')).toBeVisible()
  await expect(page.evaluate(() => window.airouter.listSpeechModelPackages())).resolves.toEqual([])
})

test('AR-29 configures and tests an online TTS Provider through the UI', async () => {
  await openAirouter('语音合成')
  await page.getByRole('button', { name: '添加 Provider' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('语音配置名称').fill('Online Speech')
  await editor.getByLabel('语音 Base URL').fill(mockServer.baseUrl)
  await editor.getByRole('textbox', { name: '语音 API Key', exact: true }).fill('speech-ui-secret')
  await editor.getByRole('button', { name: '获取模型列表' }).click()
  await expect(editor.getByText('获取到 5 个模型')).toBeVisible()
  await editor.getByRole('checkbox', { name: 'mock-text' }).check()
  await editor.getByLabel('手动语音音色 ID').fill('alloy')
  await editor.getByRole('button', { name: '添加', exact: true }).last().click()

  await editor.getByRole('button', { name: '测试合成' }).click()
  await expect(editor.getByText('测试语音合成成功')).toBeVisible()
  await expect(editor.locator('audio')).toBeVisible()
  await expect(editor.locator('audio')).toHaveAttribute('src', /^blob:/)
  const request = mockServer.findRequest('/v1/audio/speech')
  expect(request?.headers.authorization).toBe('Bearer speech-ui-secret')
  expect(request?.body).toMatchObject({
    model: 'mock-text',
    input: 'This is a voice synthesis connection test.',
    voice: 'alloy',
    response_format: 'wav'
  })

  await editor.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Online Speech”')).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await openAirouter('语音合成')
  await page.getByRole('button', { name: /Online Speech/ }).click()
  const apiKey = page.getByRole('textbox', { name: '语音 API Key', exact: true })
  await expect(apiKey).toHaveAttribute('placeholder', '已安全保存')
  await page.getByRole('button', { name: '显示语音 API Key' }).click()
  await expect(apiKey).toHaveValue('speech-ui-secret')
  const state = await page.evaluate(async () => {
    const configs = await window.airouter.listSpeechProviderConfigs()
    return {
      configs,
      apiKey: configs[0] ? await window.airouter.readSpeechProviderApiKey(configs[0].id) : null
    }
  })
  expect(state.configs).toEqual([
    expect.objectContaining({
      name: 'Online Speech',
      kind: 'online',
      type: 'openai-compatible',
      baseUrl: mockServer.baseUrl,
      models: [
        { id: 'a-model', enabled: false },
        { id: 'mock-image', enabled: false },
        { id: 'mock-reasoning', enabled: false },
        { id: 'mock-text', enabled: true },
        { id: 'z-model', enabled: false }
      ],
      voices: [{ id: 'alloy', enabled: true }],
      hasApiKey: true
    })
  ])
  expect(state.apiKey).toBe('speech-ui-secret')
  expect(JSON.stringify(state.configs)).not.toContain('speech-ui-secret')
})

test('AR-30 routes speech roles, merges adjacent segments, and returns requested formats', async () => {
  await saveSpeechProvider(
    speechProvider('speech-route', ['mock-speech'], ['default', 'man', 'woman'])
  )
  const result = await collectSpeech({
    text: 'Default line\n[Man]: First line\n[Man]: Second line\n[Woman]: Woman line\n[Woman]: Another line\nLast default',
    routing: {
      default: { providerConfigId: 'speech-route', modelId: 'mock-speech', voiceId: 'default' },
      man: { providerConfigId: 'speech-route', modelId: 'mock-speech', voiceId: 'man' },
      woman: { providerConfigId: 'speech-route', modelId: 'mock-speech', voiceId: 'woman' }
    }
  })
  expect(result).toMatchObject({
    type: 'result',
    audio: { mediaType: 'audio/wav', format: 'wav', sampleRate: 24000, channels: 1 }
  })
  expect(result.audio?.data.byteLength).toBeGreaterThan(44)
  expect(
    mockServer
      .allRequests()
      .filter((request) => request.path === '/v1/audio/speech')
      .map((request) => ({
        input: request.body.input,
        voice: request.body.voice,
        responseFormat: request.body.response_format
      }))
  ).toEqual([
    { input: 'Default line', voice: 'default', responseFormat: 'wav' },
    { input: 'First line\nSecond line', voice: 'man', responseFormat: 'wav' },
    { input: 'Woman line\nAnother line', voice: 'woman', responseFormat: 'wav' },
    { input: 'Last default', voice: 'default', responseFormat: 'wav' }
  ])

  for (const [format, mediaType] of [
    ['mp3', 'audio/mpeg'],
    ['opus', 'audio/opus'],
    ['pcm-s16le', 'audio/pcm']
  ] as const) {
    const converted = await collectSpeech({
      text: `One ${format} segment`,
      format,
      routing: {
        default: { providerConfigId: 'speech-route', modelId: 'mock-speech', voiceId: 'default' }
      }
    })
    expect(converted).toEqual({
      type: 'result',
      audio: expect.objectContaining({ mediaType, format })
    })
    expect(converted.audio?.data.byteLength).toBeGreaterThan(0)
    expect(mockServer.allRequests().at(-1)?.body).toMatchObject({
      response_format: 'wav',
      input: `One ${format} segment`
    })
  }
})

test('AR-31 reports speech failures, cancels slow synthesis, and reuses the pipeline', async () => {
  await saveSpeechProvider(
    speechProvider('speech-errors', [
      'speech-http-error',
      'speech-invalid-media',
      'speech-slow',
      'mock-speech'
    ])
  )
  const httpError = await collectSpeech({
    text: 'HTTP failure',
    routing: {
      default: {
        providerConfigId: 'speech-errors',
        modelId: 'speech-http-error',
        voiceId: 'alloy'
      }
    }
  })
  expect(httpError).toMatchObject({ type: 'error', message: 'mock speech authentication failed' })

  const invalidMedia = await collectSpeech({
    text: 'Invalid media',
    routing: {
      default: {
        providerConfigId: 'speech-errors',
        modelId: 'speech-invalid-media',
        voiceId: 'alloy'
      }
    }
  })
  expect(invalidMedia).toMatchObject({ type: 'error', message: '语音合成结果不是音频' })

  const operation = page.evaluate(
    () =>
      new Promise<SpeechEvent[]>((resolve) => {
        const events: SpeechEvent[] = []
        const abort = window.airouter.startSpeechSynthesis(
          {
            text: 'Cancel speech',
            routing: {
              default: {
                providerConfigId: 'speech-errors',
                modelId: 'speech-slow',
                voiceId: 'alloy'
              }
            }
          },
          (event) => events.push(event)
        )
        ;(window as unknown as { __abortSpeech?: () => void }).__abortSpeech = abort
        setTimeout(() => resolve(events), 1_800)
      })
  )
  const request = await mockServer.waitForRequest(
    (item) => item.path === '/v1/audio/speech' && item.body.model === 'speech-slow',
    10_000
  )
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __abortSpeech?: () => void }).__abortSpeech ===
            'function'
        ),
      { timeout: 5_000 }
    )
    .toBe(true)
  await page.evaluate(() => {
    ;(window as unknown as { __abortSpeech?: () => void }).__abortSpeech?.()
  })
  expect(await operation).toEqual([])
  await expect.poll(() => request.closedBeforeResponse).toBe(true)

  const afterCancel = await collectSpeech({
    text: 'After cancel',
    routing: {
      default: {
        providerConfigId: 'speech-errors',
        modelId: 'mock-speech',
        voiceId: 'alloy'
      }
    }
  })
  expect(afterCancel).toMatchObject({ type: 'result', audio: { format: 'wav' } })
})

test('AR-32 executes the real Pocket TTS model package through the Electron stack', async () => {
  test.setTimeout(180_000)
  const packagePath = path.join(userDataDir, 'pocket-tts-integration.zip')
  await writeFile(packagePath, await createRealPocketTtsPackage())
  await selectFileInElectronDialog(packagePath)
  await openAirouter('语音合成')
  await page.getByRole('button', { name: '添加 Provider' }).click()
  const editor = page.getByRole('dialog')
  await editor.getByLabel('语音配置名称').fill('Pocket TTS Integration')
  await editor.getByLabel('语音运行方式').selectOption('local')
  await editor.getByRole('button', { name: '导入模型包' }).click()
  await expect(
    page.getByRole('button', {
      includeHidden: true,
      name: '删除模型包 Pocket TTS Integration Package'
    })
  ).toBeVisible({ timeout: 30_000 })
  await expect(editor.getByRole('checkbox', { name: 'Alba (alba)' })).toBeChecked()
  await expect(
    editor.getByRole('checkbox', { name: 'Pocket English (pocket-tts-en-v1)' })
  ).toBeChecked()

  await editor.getByRole('button', { name: '测试合成' }).click()
  await expect(editor.getByText('测试语音合成成功')).toBeVisible({ timeout: 120_000 })
  await expect(editor.locator('audio')).toBeVisible()
  await expect(editor.locator('audio')).toHaveAttribute('src', /^blob:/)

  await editor.getByRole('button', { name: '保存 Provider' }).click()
  await expect(page.getByText('已保存“Pocket TTS Integration”')).toBeVisible({ timeout: 10_000 })
  const config = await page.evaluate(
    async () => (await window.airouter.listSpeechProviderConfigs())[0]
  )
  expect(config).toEqual(
    expect.objectContaining({
      name: 'Pocket TTS Integration',
      kind: 'local',
      type: 'pocket-tts',
      modelPackageId: 'integration-pocket-real',
      modelPackageVersion: '1.0.0',
      models: [{ id: 'pocket-tts-en-v1', enabled: true }],
      voices: [{ id: 'alba', enabled: true }]
    })
  )

  const result = await collectSpeech({
    text: 'Hello from the Pocket TTS integration test.',
    routing: {
      default: {
        providerConfigId: String(config?.id),
        modelId: 'pocket-tts-en-v1',
        voiceId: 'alba'
      }
    }
  })
  expect(result).toMatchObject({
    type: 'result',
    audio: { mediaType: 'audio/wav', format: 'wav', sampleRate: 24000, channels: 1 }
  })
  expect(result.audio?.data.byteLength).toBeGreaterThan(44)

  const longText = Array.from(
    { length: 8 },
    (_, index) => `Pocket TTS chunk ${index + 1} is deliberately long enough to exercise splitting.`
  ).join(' ')
  const longResult = await collectSpeech({
    text: longText,
    routing: {
      default: {
        providerConfigId: String(config?.id),
        modelId: 'pocket-tts-en-v1',
        voiceId: 'alba'
      }
    }
  })
  expect(longResult).toMatchObject({
    type: 'result',
    audio: { mediaType: 'audio/wav', format: 'wav', sampleRate: 24000, channels: 1 }
  })
  expect(longResult.audio?.data.byteLength).toBeGreaterThan(44)
})

test('AR-33 rejects invalid text and speech selections before making HTTP requests', async () => {
  await saveTextProvider({
    ...textProvider('text-validation', 'enabled-text'),
    models: [
      { id: 'enabled-text', enabled: true },
      { id: 'disabled-text', enabled: false }
    ]
  })
  const speechConfig = speechProvider(
    'speech-validation',
    ['enabled-speech', 'disabled-speech'],
    ['enabled-voice', 'disabled-voice']
  )
  speechConfig.models[1].enabled = false
  speechConfig.voices[1].enabled = false
  await saveSpeechProvider(speechConfig)

  const invalidTextProvider = await collectTextRequest({
    providerConfigId: 'invalid id',
    modelId: 'enabled-text',
    prompt: 'Should fail validation'
  })
  const disabledTextModel = await collectTextRequest({
    providerConfigId: 'text-validation',
    modelId: 'disabled-text',
    prompt: 'Should fail validation'
  })
  const missingTextModel = await collectTextRequest({
    providerConfigId: 'text-validation',
    modelId: 'missing-text',
    prompt: 'Should fail validation'
  })
  expect(invalidTextProvider.at(-1)).toEqual({ type: 'error', message: 'Provider 配置 ID 无效' })
  expect(disabledTextModel.at(-1)).toEqual({ type: 'error', message: '模型未配置或未启用' })
  expect(missingTextModel.at(-1)).toEqual({ type: 'error', message: '模型未配置或未启用' })

  const enabledTarget = {
    providerConfigId: 'speech-validation',
    modelId: 'enabled-speech',
    voiceId: 'enabled-voice'
  }
  const emptySpeechText = await collectSpeech({ text: '   ', routing: { default: enabledTarget } })
  const missingDefault = await collectSpeech({
    text: 'Missing default',
    routing: {} as SpeechRouting
  })
  const invalidSpeechFormat = await collectSpeech({
    text: 'Invalid format',
    format: 'flac' as never,
    routing: { default: enabledTarget }
  })
  const disabledSpeechModel = await collectSpeech({
    text: 'Disabled model',
    routing: {
      default: { ...enabledTarget, modelId: 'disabled-speech' }
    }
  })
  const disabledSpeechVoice = await collectSpeech({
    text: 'Disabled voice',
    routing: {
      default: { ...enabledTarget, voiceId: 'disabled-voice' }
    }
  })
  expect(emptySpeechText).toEqual({ type: 'error', message: '语音合成文本不能为空' })
  expect(missingDefault).toEqual({ type: 'error', message: '语音合成必须配置 default 目标' })
  expect(invalidSpeechFormat).toEqual({ type: 'error', message: '不支持的语音输出格式' })
  expect(disabledSpeechModel).toEqual({ type: 'error', message: '语音模型未配置或未启用' })
  expect(disabledSpeechVoice).toEqual({ type: 'error', message: '语音音色未配置或未启用' })
  expect(mockServer.allRequests()).toEqual([])
})

function createTestSpeechPackage(): Uint8Array {
  const bytes = new Uint8Array([1, 2, 3, 4])
  const hash = createHash('sha256').update(bytes).digest('hex')
  const assets = [
    { path: 'model/model.bin', kind: 'model-weights' },
    { path: 'tokenizer/tokenizer.model', kind: 'tokenizer' },
    { path: 'voices/alba.bin', kind: 'voice' }
  ]
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: {
      id: 'integration-pocket',
      version: '1.0.0',
      name: 'Integration Pocket Package',
      description: 'Small package used by the AIRouter integration suite'
    },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: assets.map((asset) => ({ ...asset, size: bytes.byteLength, sha256: hash })),
    models: [
      {
        id: 'pocket-a',
        name: 'Pocket A',
        languageCodes: ['en'],
        artifacts: { weights: ['model/model.bin'], tokenizer: ['tokenizer/tokenizer.model'] },
        parameters: {}
      },
      {
        id: 'pocket-b',
        name: 'Pocket B',
        languageCodes: ['en'],
        artifacts: { weights: ['model/model.bin'], tokenizer: ['tokenizer/tokenizer.model'] },
        parameters: {}
      }
    ],
    voices: [
      { id: 'alba', name: 'Alba', languageCodes: ['en'], files: ['voices/alba.bin'] },
      { id: 'marius', name: 'Marius', languageCodes: ['en'], files: ['voices/alba.bin'] }
    ]
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    ...Object.fromEntries(assets.map((asset) => [asset.path, bytes]))
  })
}

async function createRealPocketTtsPackage(): Promise<Uint8Array> {
  if (cachedPocketTtsPackage) return cachedPocketTtsPackage
  const sourceFiles = [
    { source: 'model.safetensors', path: 'model/model.safetensors', kind: 'model-weights' },
    { source: 'tokenizer.model', path: 'tokenizer/tokenizer.model', kind: 'tokenizer' },
    { source: 'voices/alba.safetensors', path: 'voices/alba.safetensors', kind: 'voice' }
  ]
  const assets = await Promise.all(
    sourceFiles.map(async (asset) => ({
      ...asset,
      bytes: await readFile(path.join('model-assets', 'tts', asset.source))
    }))
  )
  const manifest = {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: {
      id: 'integration-pocket-real',
      version: '1.0.0',
      name: 'Pocket TTS Integration Package'
    },
    runtime: { engine: 'pocket-tts', engineApiVersion: 1 },
    assets: assets.map(({ path: assetPath, kind, bytes }) => ({
      path: assetPath,
      kind,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })),
    models: [
      {
        id: 'pocket-tts-en-v1',
        name: 'Pocket English',
        languageCodes: ['en', 'en-US'],
        artifacts: {
          weights: ['model/model.safetensors'],
          tokenizer: ['tokenizer/tokenizer.model']
        },
        parameters: {
          load: { quantization: 'f32' },
          audio: { sampleRate: 24000 },
          synthesis: {
            maxTokensPerChunk: 50,
            silenceBetweenChunksMs: 200,
            temperature: 0.7,
            padShortInputs: false,
            removeSemicolons: false
          }
        }
      }
    ],
    voices: [
      {
        id: 'alba',
        name: 'Alba',
        languageCodes: ['en', 'en-US'],
        files: ['voices/alba.safetensors']
      }
    ]
  }
  const entries: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) }
  for (const asset of assets) entries[asset.path] = asset.bytes
  cachedPocketTtsPackage = zipSync(entries, { level: 0 })
  return cachedPocketTtsPackage
}
