// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterProviderConfigInput, AIRouterProviderConfigSummary } from '@ls101/airouter'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AIRouterSettingsPage } from '../features/airouter/AIRouterSettingsPage'
import type { AIRouterApplication } from '../features/airouter/AIRouterApplication'
import { manualImageGenerationCoordinator } from '../features/airouter/ManualImageGeneration'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AIRouterSettingsPage', () => {
  it('opens provider editing in a modal and saves base fields and model ids together', async () => {
    const config: AIRouterProviderConfigSummary = {
      id: 'provider-1',
      name: '学校 OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'test-model', enabled: true }],
      hasApiKey: true
    }
    const application = applicationWith({
      listConfigs: vi.fn().mockResolvedValue([config]),
      saveConfig: vi.fn().mockImplementation(async (input: AIRouterProviderConfigInput) => ({
        id: input.id ?? 'provider-1',
        name: input.name,
        type: input.type,
        baseUrl: input.baseUrl ?? config.baseUrl,
        models: input.models,
        hasApiKey: config.hasApiKey || Boolean(input.apiKey)
      })),
      deleteConfig: vi.fn(),
      readApiKey: vi.fn().mockResolvedValue('saved-secret'),
      listModels: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, text: 'OK' })
    })

    renderAIRouter(application)

    const providerButton = await screen.findByRole('button', { name: /学校 OpenAI/ })
    expect(screen.queryByLabelText('API Key')).toBeNull()
    fireEvent.click(providerButton)

    const dialog = screen.getByRole('dialog', { name: '学校 OpenAI' })
    const apiKeyInput = within(dialog).getByLabelText('API Key') as HTMLInputElement
    const providerType = within(dialog).getByLabelText('Provider 类型') as HTMLInputElement
    expect(providerType.tagName).toBe('INPUT')
    expect(providerType).toBeDisabled()
    expect(providerType.value).toBe('OpenAI Compatible')
    expect(apiKeyInput.placeholder).toBe('已安全保存')
    expect(apiKeyInput.value).toBe('')
    expect(apiKeyInput.type).toBe('password')
    expect(within(dialog).queryByText('已保存密钥；留空将保留原值。')).toBeNull()
    expect(within(dialog).queryByText('清除密钥')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: '保存模型设置' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '显示 API Key' }))
    await waitFor(() => expect(application.readApiKey).toHaveBeenCalledWith('provider-1'))
    expect(apiKeyInput.value).toBe('saved-secret')
    expect(apiKeyInput.type).toBe('text')
    expect(within(dialog).getByRole('button', { name: '保存 Provider' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: '隐藏 API Key' }))
    expect(apiKeyInput.type).toBe('password')

    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }))
    await waitFor(() =>
      expect(application.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'provider-1',
          name: '学校 OpenAI',
          apiKey: undefined,
          models: [{ id: 'test-model', enabled: true }]
        }),
        'test-model'
      )
    )
    const connectionSection = within(dialog)
      .getByRole('heading', { name: '连接测试' })
      .closest('section')
    expect(connectionSection).not.toBeNull()
    expect(
      await within(connectionSection as HTMLElement).findByText('连接成功，模型回复：OK')
    ).toBeInTheDocument()
    expect(application.saveConfig).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('配置名称'), {
      target: { value: '学校 OpenAI 更新' }
    })
    fireEvent.change(within(dialog).getByLabelText('手动模型 ID'), {
      target: { value: 'new-model' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() => expect(application.saveConfig).toHaveBeenCalledTimes(1))
    expect(application.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'provider-1',
        name: '学校 OpenAI 更新',
        apiKey: undefined,
        models: [
          { id: 'test-model', enabled: true },
          { id: 'new-model', enabled: true }
        ]
      })
    )
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '保存 Provider' })).toBeDisabled()
  })

  it('clears a saved API key when the revealed input is emptied and saved', async () => {
    const config: AIRouterProviderConfigSummary = {
      id: 'provider-1',
      name: 'OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [],
      hasApiKey: true
    }
    const application = applicationWith({
      listConfigs: vi.fn().mockResolvedValue([config]),
      saveConfig: vi.fn().mockImplementation(async (input: AIRouterProviderConfigInput) => ({
        ...config,
        hasApiKey: !input.clearApiKey
      })),
      deleteConfig: vi.fn(),
      readApiKey: vi.fn().mockResolvedValue('saved-secret'),
      listModels: vi.fn(),
      testConnection: vi.fn()
    })

    renderAIRouter(application)

    fireEvent.click(await screen.findByRole('button', { name: /OpenAI/ }))
    const dialog = screen.getByRole('dialog', { name: 'OpenAI' })
    fireEvent.click(within(dialog).getByRole('button', { name: '显示 API Key' }))
    const apiKeyInput = (await within(dialog).findByDisplayValue(
      'saved-secret'
    )) as HTMLInputElement
    fireEvent.change(apiKeyInput, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() =>
      expect(application.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'provider-1',
          apiKey: undefined,
          clearApiKey: true
        })
      )
    )
  })

  it('discovers models and tests an unsaved provider draft before saving once', async () => {
    const application = applicationWith({
      listConfigs: vi.fn().mockResolvedValue([]),
      saveConfig: vi.fn().mockImplementation(async (input: AIRouterProviderConfigInput) => ({
        id: 'new-provider',
        name: input.name,
        type: input.type,
        baseUrl: input.baseUrl ?? 'https://api.openai.com/v1',
        models: input.models,
        hasApiKey: Boolean(input.apiKey)
      })),
      deleteConfig: vi.fn(),
      readApiKey: vi.fn(),
      listModels: vi.fn().mockResolvedValue([{ id: 'draft-model' }]),
      testConnection: vi.fn().mockResolvedValue({ ok: true, text: 'OK' })
    })

    renderAIRouter(application)

    fireEvent.click(await screen.findByRole('button', { name: '添加 Provider' }))
    const dialog = screen.getByRole('dialog', { name: '未命名 Provider' })
    expect(within(dialog).getByLabelText('Provider 类型').tagName).toBe('SELECT')
    fireEvent.change(within(dialog).getByLabelText('配置名称'), {
      target: { value: '未保存 Provider' }
    })
    fireEvent.change(within(dialog).getByLabelText('API Key'), {
      target: { value: 'draft-secret' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '获取模型列表' }))

    await waitFor(() =>
      expect(application.listModels).toHaveBeenCalledWith(
        expect.objectContaining({
          id: undefined,
          name: '未保存 Provider',
          apiKey: 'draft-secret',
          models: []
        })
      )
    )
    expect(application.saveConfig).not.toHaveBeenCalled()
    const modelSection = within(dialog)
      .getByRole('heading', { name: 'Model ID' })
      .closest('section')
    expect(modelSection).not.toBeNull()
    expect(within(modelSection as HTMLElement).getByText('获取到 1 个模型')).toBeInTheDocument()

    const modelToggle = await within(dialog).findByRole('checkbox', { name: 'draft-model' })
    fireEvent.click(modelToggle)
    fireEvent.click(within(dialog).getByRole('button', { name: '测试连接' }))

    await waitFor(() =>
      expect(application.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: undefined,
          name: '未保存 Provider',
          apiKey: 'draft-secret',
          models: [{ id: 'draft-model', enabled: true }]
        }),
        'draft-model'
      )
    )
    expect(application.saveConfig).not.toHaveBeenCalled()
    const connectionSection = within(dialog)
      .getByRole('heading', { name: '连接测试' })
      .closest('section')
    expect(connectionSection).not.toBeNull()
    expect(
      await within(connectionSection as HTMLElement).findByText('连接成功，模型回复：OK')
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))
    await waitFor(() => expect(application.saveConfig).toHaveBeenCalledTimes(1))
    expect(dialog).toBeInTheDocument()
    const savedProviderType = within(dialog).getByLabelText('Provider 类型') as HTMLInputElement
    expect(savedProviderType.tagName).toBe('INPUT')
    expect(savedProviderType).toBeDisabled()
    expect(savedProviderType.value).toBe('OpenAI Compatible')
    expect(within(dialog).getByRole('button', { name: '保存 Provider' })).toBeDisabled()
  })

  it('uses URL-backed model categories and keeps speech recognition as a placeholder', async () => {
    const application = applicationWith({
      listSpeechConfigs: vi.fn().mockResolvedValue([]),
      listSpeechPackages: vi.fn().mockResolvedValue([])
    })

    renderAIRouter(application, '/settings/ai-router/speech-synthesis')

    expect(screen.getByRole('tab', { name: '语音合成' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { name: '语音 Provider' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'TTS 模型包' })).toBeInTheDocument()
    expect(screen.queryByText('临时占位')).toBeNull()
    expect(application.listConfigs).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: '语音识别' }))
    expect(screen.getByRole('tab', { name: '语音识别' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '语音识别' })).toBeInTheDocument()
    expect(screen.getByText('临时占位')).toBeInTheDocument()
  })

  it('saves an OpenAI-compatible speech Provider with model and voice IDs', async () => {
    const application = applicationWith({
      listSpeechConfigs: vi.fn().mockResolvedValue([]),
      listSpeechPackages: vi.fn().mockResolvedValue([]),
      saveSpeechConfig: vi.fn().mockImplementation(async (input) => ({
        id: 'speech-online',
        name: input.name,
        kind: input.kind,
        type: input.type,
        baseUrl: input.baseUrl ?? '',
        modelPackageId: '',
        modelPackageVersion: '',
        models: input.models,
        voices: input.voices,
        hasApiKey: Boolean(input.apiKey)
      }))
    })

    renderAIRouter(application, '/settings/ai-router/speech-synthesis')

    fireEvent.click(await screen.findByRole('button', { name: '添加 Provider' }))
    const dialog = screen.getByRole('dialog', { name: '未命名 Provider' })
    fireEvent.change(within(dialog).getByLabelText('语音配置名称'), {
      target: { value: '在线语音' }
    })
    fireEvent.change(within(dialog).getByLabelText('语音 API Key'), {
      target: { value: 'speech-secret' }
    })
    fireEvent.change(within(dialog).getByLabelText('手动语音模型 ID'), {
      target: { value: 'gpt-4o-mini-tts' }
    })
    fireEvent.click(within(dialog).getAllByRole('button', { name: '添加' })[0])
    fireEvent.change(within(dialog).getByLabelText('手动语音音色 ID'), {
      target: { value: 'alloy' }
    })
    fireEvent.click(within(dialog).getAllByRole('button', { name: '添加' })[1])
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() =>
      expect(application.saveSpeechConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '在线语音',
          kind: 'online',
          type: 'openai-compatible',
          apiKey: 'speech-secret',
          models: [{ id: 'gpt-4o-mini-tts', enabled: true }],
          voices: [{ id: 'alloy', enabled: true }]
        })
      )
    )
  })

  it('prompts for a local package and configures the imported package', async () => {
    const modelPackage = createSpeechPackageSummary()
    vi.spyOn(fileDialog, 'readBinary').mockResolvedValue({
      name: 'pocket-tts-en-1.0.0.zip',
      data: new Uint8Array([1, 2, 3])
    })
    const application = applicationWith({
      listSpeechConfigs: vi.fn().mockResolvedValue([]),
      listSpeechPackages: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([modelPackage]),
      importSpeechPackage: vi.fn().mockResolvedValue({
        package: modelPackage,
        reusedAssetCount: 2,
        storedAssetCount: 3
      }),
      saveSpeechConfig: vi.fn().mockImplementation(async (input) => ({
        id: 'speech-local',
        name: input.name,
        kind: input.kind,
        type: input.type,
        baseUrl: '',
        modelPackageId: input.modelPackageId ?? '',
        modelPackageVersion: input.modelPackageVersion ?? '',
        models: input.models,
        voices: input.voices,
        hasApiKey: false
      }))
    })

    renderAIRouter(application, '/settings/ai-router/speech-synthesis')

    fireEvent.click(await screen.findByRole('button', { name: '添加 Provider' }))
    const dialog = screen.getByRole('dialog', { name: '未命名 Provider' })
    fireEvent.change(within(dialog).getByLabelText('语音运行方式'), {
      target: { value: 'local' }
    })
    expect(within(dialog).getByText('需要先导入 Pocket TTS 模型包')).toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: '启用模型' })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: '导入模型包' }))
    await waitFor(() =>
      expect(application.importSpeechPackage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    )
    expect(await within(dialog).findByRole('heading', { name: '启用模型' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Pocket English (pocket-en)')).toBeChecked()
    expect(within(dialog).getByLabelText('Alba (alba)')).toBeChecked()

    fireEvent.change(within(dialog).getByLabelText('语音配置名称'), {
      target: { value: '本地英文语音' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() =>
      expect(application.saveSpeechConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '本地英文语音',
          kind: 'local',
          type: 'pocket-tts',
          modelPackageId: 'pocket-tts-en',
          modelPackageVersion: '1.0.0',
          models: [{ id: 'pocket-en', enabled: true }],
          voices: [{ id: 'alba', enabled: true }]
        })
      )
    )
  })

  it('manages image Providers without a default Provider control', async () => {
    const manualProvider = {
      id: 'manual',
      name: '手动生成',
      type: 'manual' as const,
      baseUrl: '',
      models: [],
      hasApiKey: false
    }
    const application = applicationWith({
      listImageConfigs: vi.fn().mockResolvedValue([manualProvider]),
      saveImageConfig: vi.fn().mockImplementation(async (input) => ({
        id: 'image-provider',
        name: input.name,
        type: 'openai-compatible',
        baseUrl: input.baseUrl,
        models: input.models,
        hasApiKey: Boolean(input.apiKey)
      }))
    })

    renderAIRouter(application, '/settings/ai-router/image')

    expect(await screen.findByText('共 1 个 Provider')).toBeInTheDocument()
    expect(screen.queryByLabelText('默认图像 Provider')).toBeNull()
    expect(screen.queryByRole('button', { name: 'API Provider' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加 Provider' }))
    const dialog = screen.getByRole('dialog', { name: '未命名 Provider' })
    fireEvent.change(within(dialog).getByLabelText('图像配置名称'), {
      target: { value: '图片服务' }
    })
    fireEvent.change(within(dialog).getByLabelText('图像 API Key'), {
      target: { value: 'image-secret' }
    })
    fireEvent.change(within(dialog).getByLabelText('手动图像模型 ID'), {
      target: { value: 'gpt-image-1' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() => expect(application.saveImageConfig).toHaveBeenCalledOnce())
  })

  it('adds manual generation as a Provider type without API fields', async () => {
    const application = applicationWith({
      listImageConfigs: vi.fn().mockResolvedValue([
        {
          id: 'manual',
          name: '手动生成',
          type: 'manual',
          baseUrl: '',
          models: [],
          hasApiKey: false
        }
      ]),
      saveImageConfig: vi.fn().mockImplementation(async (input) => ({
        id: 'custom-manual',
        name: input.name,
        type: input.type,
        baseUrl: '',
        models: [],
        hasApiKey: false
      }))
    })

    renderAIRouter(application, '/settings/ai-router/image')

    fireEvent.click(await screen.findByRole('button', { name: '添加 Provider' }))
    const dialog = screen.getByRole('dialog', { name: '未命名 Provider' })
    fireEvent.change(within(dialog).getByLabelText('图像 Provider 类型'), {
      target: { value: 'manual' }
    })
    expect(within(dialog).queryByLabelText('图像 API Key')).toBeNull()
    expect(within(dialog).queryByLabelText('手动图像模型 ID')).toBeNull()
    expect(within(dialog).queryByRole('heading', { name: '连接测试' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: '测试手动生成' })).toBeInTheDocument()

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:manual-test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    fireEvent.click(within(dialog).getByRole('button', { name: '测试手动生成' }))
    await vi.waitFor(() =>
      expect(manualImageGenerationCoordinator.getSnapshot()?.prompt).toContain('绿色圆形图标')
    )
    manualImageGenerationCoordinator.complete(
      manualImageGenerationCoordinator.getSnapshot()?.id ?? '',
      { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png' }
    )
    expect(await within(dialog).findByText('测试图片已导入')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('图像配置名称'), {
      target: { value: '浏览器生图' }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存 Provider' }))

    await waitFor(() =>
      expect(application.saveImageConfig).toHaveBeenCalledWith(
        expect.objectContaining({ name: '浏览器生图', type: 'manual' })
      )
    )
  })
})

function applicationWith(overrides: Partial<AIRouterApplication>): AIRouterApplication {
  return {
    listConfigs: vi.fn().mockResolvedValue([]),
    saveConfig: vi.fn(),
    deleteConfig: vi.fn(),
    readApiKey: vi.fn(),
    listModels: vi.fn(),
    testConnection: vi.fn(),
    listImageConfigs: vi.fn().mockResolvedValue([]),
    saveImageConfig: vi.fn(),
    deleteImageConfig: vi.fn(),
    readImageApiKey: vi.fn(),
    listImageModels: vi.fn(),
    testImageConnection: vi.fn(),
    listSpeechConfigs: vi.fn().mockResolvedValue([]),
    saveSpeechConfig: vi.fn(),
    deleteSpeechConfig: vi.fn(),
    readSpeechApiKey: vi.fn(),
    listSpeechPackages: vi.fn().mockResolvedValue([]),
    importSpeechPackage: vi.fn(),
    deleteSpeechPackage: vi.fn(),
    listSpeechModels: vi.fn(),
    listSpeechVoices: vi.fn(),
    testSpeechConnection: vi.fn(),
    ...overrides
  }
}

function createSpeechPackageSummary() {
  return {
    package: {
      id: 'pocket-tts-en',
      version: '1.0.0',
      name: 'Pocket TTS English',
      description: 'English Pocket TTS model'
    },
    runtime: { engine: 'pocket-tts' as const, engineApiVersion: 1 },
    models: [
      {
        id: 'pocket-en',
        name: 'Pocket English',
        languageCodes: ['en'],
        artifacts: { model: ['model.bin'] },
        parameters: {}
      }
    ],
    voices: [
      {
        id: 'alba',
        name: 'Alba',
        languageCodes: ['en'],
        files: ['voices.bin']
      }
    ],
    assetCount: 5,
    totalBytes: 1024
  }
}

function renderAIRouter(
  application: AIRouterApplication,
  initialEntry = '/settings/ai-router/text'
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/settings/ai-router/*"
          element={<AIRouterSettingsPage application={application} />}
        />
      </Routes>
    </MemoryRouter>
  )
}
