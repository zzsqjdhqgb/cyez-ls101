// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettingsPage } from '../features/settings/AppearanceSettingsPage'
import { AppearanceSettingsProvider } from '../features/settings/AppearanceSettingsProvider'
import type {
  AppearanceSettings,
  AppearanceSettingsApplication
} from '../features/settings/AppearanceSettingsApplication'

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  )
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-reduce-motion')
  vi.unstubAllGlobals()
})

describe('AppearanceSettingsPage', () => {
  it('applies persisted settings when the application starts', async () => {
    const settings: AppearanceSettings = { theme: 'dark', reduceMotion: true }
    const application: AppearanceSettingsApplication = {
      load: vi.fn().mockResolvedValue(settings),
      save: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(settings)
    }

    render(
      <AppearanceSettingsProvider application={application}>
        <div>应用内容</div>
      </AppearanceSettingsProvider>
    )

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true)
  })

  it('applies the selected theme and reduced motion preference', async () => {
    const settings: AppearanceSettings = { theme: 'system', reduceMotion: false }
    const application: AppearanceSettingsApplication = {
      load: vi.fn().mockResolvedValue(settings),
      save: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(settings)
    }
    render(
      <AppearanceSettingsProvider application={application}>
        <AppearanceSettingsPage />
      </AppearanceSettingsProvider>
    )

    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: '界面主题' })).not.toBeNull()
    })
    fireEvent.change(screen.getByRole('combobox', { name: '界面主题' }), {
      target: { value: 'dark' }
    })
    await waitFor(() =>
      expect(application.save).toHaveBeenCalledWith({ theme: 'dark', reduceMotion: false })
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    fireEvent.click(screen.getByRole('switch', { name: '减少动态效果' }))
    await waitFor(() =>
      expect(application.save).toHaveBeenCalledWith({ theme: 'dark', reduceMotion: true })
    )
    expect(document.documentElement.hasAttribute('data-reduce-motion')).toBe(true)
  })

  it('rolls back the rendered theme when persistence fails', async () => {
    const settings: AppearanceSettings = { theme: 'light', reduceMotion: false }
    const application: AppearanceSettingsApplication = {
      load: vi.fn().mockResolvedValue(settings),
      save: vi.fn().mockRejectedValue(new Error('无法保存外观设置')),
      reset: vi.fn().mockResolvedValue(settings)
    }
    render(
      <AppearanceSettingsProvider application={application}>
        <AppearanceSettingsPage />
      </AppearanceSettingsProvider>
    )

    await screen.findByRole('combobox', { name: '界面主题' })
    fireEvent.change(screen.getByRole('combobox', { name: '界面主题' }), {
      target: { value: 'dark' }
    })

    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toContain('无法保存外观设置')
    expect((screen.getByRole('combobox', { name: '界面主题' }) as HTMLSelectElement).value).toBe(
      'light'
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
