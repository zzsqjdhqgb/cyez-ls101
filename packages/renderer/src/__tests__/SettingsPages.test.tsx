// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Cpu, Palette } from 'lucide-react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { settingsPageRegistry } from '../app/settings-registry'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../components/settings/SettingsContent'
import { SettingsDetailPage } from '../pages/SettingsDetailPage'
import { SettingsOverviewPage } from '../pages/SettingsOverviewPage'

afterEach(cleanup)

function AppearanceSettings() {
  return (
    <SettingsContent>
      <SettingsSection title="主题">
        <SettingsRow label="界面主题">跟随系统</SettingsRow>
      </SettingsSection>
    </SettingsContent>
  )
}

function renderSettings(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/settings" element={<SettingsOverviewPage />} />
        <Route path="/settings/:settingsPageId/*" element={<SettingsDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('settings pages', () => {
  it('shows the empty state without registrations', () => {
    renderSettings()
    expect(screen.getByText('暂无设置项')).toBeInTheDocument()
  })

  it('groups registrations and opens them in the shared detail layout', () => {
    const unregister = settingsPageRegistry.register({
      id: 'appearance',
      title: '外观',
      description: '调整界面显示方式',
      icon: Palette,
      group: { id: 'general', label: '通用', order: 0 },
      component: AppearanceSettings
    })

    renderSettings()
    expect(screen.getByRole('heading', { name: '通用' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /外观/ }))

    expect(screen.getByRole('heading', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByText('调整界面显示方式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回设置' })).toBeInTheDocument()
    expect(screen.getByText('跟随系统')).toBeInTheDocument()

    unregister()
  })

  it('orders groups and pages by registration metadata', () => {
    const unregisterAi = settingsPageRegistry.register({
      id: 'ai',
      title: 'AI 引擎',
      icon: Cpu,
      group: { id: 'services', label: '服务', order: 20 },
      order: 0,
      component: AppearanceSettings
    })
    const unregisterTheme = settingsPageRegistry.register({
      id: 'theme',
      title: '主题',
      icon: Palette,
      group: { id: 'general', label: '通用', order: 0 },
      order: 20,
      component: AppearanceSettings
    })
    const unregisterLanguage = settingsPageRegistry.register({
      id: 'language',
      title: '语言',
      icon: Palette,
      group: { id: 'general', label: '通用', order: 0 },
      order: 10,
      component: AppearanceSettings
    })

    renderSettings()

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    ).toEqual(['通用', '服务'])
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '语言',
      '主题',
      'AI 引擎'
    ])

    unregisterLanguage()
    unregisterTheme()
    unregisterAi()
  })

  it('shows a recoverable state for unknown settings pages', () => {
    renderSettings('/settings/missing')
    expect(screen.getByText('设置项不存在')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
  })
})
