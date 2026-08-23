// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LicenseSettingsPage } from '../features/settings/LicenseSettingsPage'

afterEach(() => {
  cleanup()
  delete window.license
})

describe('LicenseSettingsPage', () => {
  it('opens the bundled activation guide', async () => {
    const openActivationGuide = vi.fn().mockResolvedValue(undefined)
    window.license = {
      getStatus: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      openActivationGuide
    }

    render(<LicenseSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: '查看说明' }))

    await waitFor(() => expect(openActivationGuide).toHaveBeenCalledOnce())
  })

  it('deactivates after confirmation', async () => {
    const deactivate = vi.fn().mockResolvedValue(undefined)
    window.license = {
      getStatus: vi.fn(),
      activate: vi.fn(),
      deactivate,
      openActivationGuide: vi.fn()
    }

    render(<LicenseSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '取消激活' }))
    expect(screen.getByRole('heading', { name: '取消激活？' })).toBeInTheDocument()
    expect(screen.getByText(/其他软件数据不会被删除/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消激活并重启' }))

    await waitFor(() => expect(deactivate).toHaveBeenCalledTimes(1))
  })

  it('keeps the confirmation open when deactivation fails', async () => {
    window.license = {
      getStatus: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn().mockRejectedValue(new Error('failed')),
      openActivationGuide: vi.fn()
    }

    render(<LicenseSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: '取消激活' }))
    fireEvent.click(screen.getByRole('button', { name: '取消激活并重启' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('取消激活失败，请稍后重试。')
    expect(screen.getByRole('heading', { name: '取消激活？' })).toBeInTheDocument()
  })
})
