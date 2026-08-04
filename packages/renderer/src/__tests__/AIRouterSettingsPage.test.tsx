// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterProviderConfigInput, AIRouterProviderConfigSummary } from '@ls101/airouter'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AIRouterSettingsPage } from '../features/airouter/AIRouterSettingsPage'
import type { AIRouterApplication } from '../features/airouter/AIRouterApplication'

afterEach(cleanup)

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

  it('uses URL-backed model categories and marks speech pages as placeholders', async () => {
    const application = applicationWith({
      listConfigs: vi.fn().mockResolvedValue([]),
      saveConfig: vi.fn(),
      deleteConfig: vi.fn(),
      readApiKey: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn()
    })

    renderAIRouter(application, '/settings/ai-router/speech-synthesis')

    expect(screen.getByRole('tab', { name: '语音合成' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '语音合成' })).toBeInTheDocument()
    expect(screen.getByText('临时占位')).toBeInTheDocument()
    expect(application.listConfigs).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: '语音识别' }))
    expect(screen.getByRole('tab', { name: '语音识别' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: '语音识别' })).toBeInTheDocument()
    expect(screen.getByText('临时占位')).toBeInTheDocument()
  })

  it('configures a separate image provider and switches from manual to API mode', async () => {
    const saveImageSettings = vi.fn().mockImplementation(async (settings) => settings)
    const application = applicationWith({
      listImageConfigs: vi.fn().mockResolvedValue([]),
      getImageSettings: vi.fn().mockResolvedValue({ mode: 'manual' }),
      saveImageConfig: vi.fn().mockImplementation(async (input) => ({
        id: 'image-provider',
        name: input.name,
        type: 'openai-compatible',
        baseUrl: input.baseUrl,
        models: input.models,
        hasApiKey: Boolean(input.apiKey)
      })),
      saveImageSettings
    })

    renderAIRouter(application, '/settings/ai-router/image')

    expect(await screen.findByRole('button', { name: '手动生成' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'API Provider' })).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: 'API Provider' }))
    await waitFor(() =>
      expect(saveImageSettings).toHaveBeenCalledWith({
        mode: 'provider',
        providerConfigId: 'image-provider',
        modelId: 'gpt-image-1'
      })
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
    getImageSettings: vi.fn().mockResolvedValue({ mode: 'manual' }),
    saveImageSettings: vi.fn(),
    testImageConnection: vi.fn(),
    ...overrides
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
