// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { AboutSettingsPage } from '../features/settings/AboutSettingsPage'

afterEach(() => {
  cleanup()
  delete window.appInfo
})

describe('AboutSettingsPage', () => {
  it('shows product, team and runtime version information', async () => {
    window.appInfo = {
      getVersion: vi.fn().mockResolvedValue('0.3.1-test'),
      ensureInstallationMarker: vi.fn().mockResolvedValue(undefined)
    }

    render(
      <MemoryRouter>
        <AboutSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('heading', { name: '曹二听说101' })).toBeInTheDocument()
    expect(await screen.findByText('版本 0.3.1-test')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '项目发起人' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '开发者' })).toBeInTheDocument()
    expect(screen.getByText('周飞')).toBeInTheDocument()
    expect(screen.getByText('开发者 · 上海市曹杨第二中学 2027届永强班学生')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '应昊廷的 GitHub 主页' })).toHaveAttribute(
      'href',
      'https://github.com/zzsqjdhqgb'
    )
    expect(screen.getByRole('link', { name: '项目主页' })).toHaveAttribute(
      'href',
      'https://github.com/zzsqjdhqgb/cyez-ls101'
    )
    expect(screen.getByRole('button', { name: /版本说明/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /版本说明/ }))
    expect(screen.getByRole('dialog', { name: '曹二听说101 v0.4.0' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '关闭版本说明' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the page usable when the preload bridge is unavailable', async () => {
    render(
      <MemoryRouter>
        <AboutSettingsPage />
      </MemoryRouter>
    )

    expect(await screen.findByText('版本 未知')).toBeInTheDocument()
  })
})
