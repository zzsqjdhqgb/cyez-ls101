// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageSettingsPage } from '../features/settings/StorageSettingsPage'

afterEach(() => {
  cleanup()
  delete window.dataDirectory
})

describe('StorageSettingsPage', () => {
  it('shows the current directory and schedules copying to an empty directory', async () => {
    const migrate = vi.fn().mockResolvedValue(undefined)
    window.dataDirectory = {
      getInfo: vi.fn().mockResolvedValue({
        currentPath: '/profile/data',
        defaultPath: '/profile/data',
        sizeBytes: 2 * 1024 * 1024
      }),
      choose: vi.fn().mockResolvedValue({
        path: '/mnt/storage/ls101',
        kind: 'empty',
        sizeBytes: 0
      }),
      migrate,
      useExisting: vi.fn()
    }

    render(<StorageSettingsPage />)

    expect(await screen.findByText('/profile/data')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB · 默认位置')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更改位置' }))
    expect(await screen.findByRole('heading', { name: '迁移数据目录？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制并重启' }))
    await waitFor(() => expect(migrate).toHaveBeenCalledWith('/mnt/storage/ls101'))
  })

  it('can switch directly to an existing managed directory', async () => {
    const useExisting = vi.fn().mockResolvedValue(undefined)
    window.dataDirectory = {
      getInfo: vi.fn().mockResolvedValue({
        currentPath: '/profile/data',
        defaultPath: '/profile/data',
        sizeBytes: 0
      }),
      choose: vi.fn().mockResolvedValue({
        path: '/mnt/existing',
        kind: 'managed',
        sizeBytes: 4096
      }),
      migrate: vi.fn(),
      useExisting
    }

    render(<StorageSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '更改位置' }))
    expect(await screen.findByText(/直接使用/)).toHaveTextContent('/mnt/existing')
    fireEvent.click(screen.getByRole('button', { name: '使用并重启' }))
    await waitFor(() => expect(useExisting).toHaveBeenCalledWith('/mnt/existing'))
  })
})
