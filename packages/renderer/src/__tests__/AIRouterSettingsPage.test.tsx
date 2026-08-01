// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIRouterProviderConfigSummary } from '@ls101/airouter'
import { AIRouterSettingsPage } from '../features/airouter/AIRouterSettingsPage'
import type { AIRouterApplication } from '../features/airouter/AIRouterApplication'

afterEach(cleanup)

describe('AIRouterSettingsPage', () => {
  it('edits a provider without exposing its saved API key and runs the fixed test', async () => {
    const config: AIRouterProviderConfigSummary = {
      id: 'provider-1',
      name: '学校 OpenAI',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'test-model', enabled: true }],
      hasApiKey: true
    }
    const application: AIRouterApplication = {
      listConfigs: vi.fn().mockResolvedValue([config]),
      saveConfig: vi.fn().mockResolvedValue(config),
      deleteConfig: vi.fn(),
      listModels: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, text: 'OK' })
    }

    render(<AIRouterSettingsPage application={application} />)

    expect(await screen.findByDisplayValue('学校 OpenAI')).not.toBeNull()
    const apiKeyInput = screen.getByLabelText('API Key') as HTMLInputElement
    expect(apiKeyInput.placeholder).toBe('已安全保存')
    expect(apiKeyInput.value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
    await waitFor(() =>
      expect(application.testConnection).toHaveBeenCalledWith('provider-1', 'test-model')
    )
    expect(await screen.findByText('连接成功，模型回复：OK')).not.toBeNull()
    expect(application.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-1', apiKey: undefined })
    )
  })
})
