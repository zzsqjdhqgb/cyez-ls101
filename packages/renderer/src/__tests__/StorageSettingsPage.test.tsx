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
        sizeBytes: 2 * 1024 * 1024,
        oldDataDirectory: null
      }),
      choose: vi.fn().mockResolvedValue({
        path: '/mnt/storage/ls101',
        kind: 'empty',
        sizeBytes: 0
      }),
      chooseDefault: vi.fn(),
      resetDefault: vi.fn(),
      migrate,
      useExisting: vi.fn(),
      deleteOld: vi.fn()
    }

    render(<StorageSettingsPage />)

    expect(await screen.findByText('/profile/data')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB · 默认位置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复默认位置' })).toBeDisabled()
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
        sizeBytes: 0,
        oldDataDirectory: null
      }),
      choose: vi.fn().mockResolvedValue({
        path: '/mnt/existing',
        kind: 'managed',
        sizeBytes: 4096
      }),
      chooseDefault: vi.fn(),
      resetDefault: vi.fn(),
      migrate: vi.fn(),
      useExisting,
      deleteOld: vi.fn()
    }

    render(<StorageSettingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: '更改位置' }))
    expect(await screen.findByText(/直接使用/)).toHaveTextContent('/mnt/existing')
    fireEvent.click(screen.getByRole('button', { name: '使用并重启' }))
    await waitFor(() => expect(useExisting).toHaveBeenCalledWith('/mnt/existing'))
  })

  it('deletes the recorded old directory before allowing another location change', async () => {
    const deleteOld = vi.fn().mockResolvedValue(undefined)
    const getInfo = vi
      .fn()
      .mockResolvedValueOnce({
        currentPath: '/mnt/current',
        defaultPath: '/profile/data',
        sizeBytes: 4096,
        oldDataDirectory: {
          path: '/profile/data',
          sizeBytes: 2048,
          deleting: false
        }
      })
      .mockResolvedValueOnce({
        currentPath: '/mnt/current',
        defaultPath: '/profile/data',
        sizeBytes: 4096,
        oldDataDirectory: null
      })
    window.dataDirectory = {
      getInfo,
      choose: vi.fn(),
      chooseDefault: vi.fn(),
      resetDefault: vi.fn(),
      migrate: vi.fn(),
      useExisting: vi.fn(),
      deleteOld
    }

    render(<StorageSettingsPage />)

    expect(await screen.findByText('/profile/data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更改位置' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除旧数据' }))
    expect(screen.getByRole('heading', { name: '删除旧数据目录？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))
    await waitFor(() => expect(deleteOld).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '更改位置' })).toBeEnabled())
  })

  it('validates the default directory as a candidate before resetting', async () => {
    const resetDefault = vi.fn().mockResolvedValue(undefined)
    const chooseDefault = vi.fn().mockResolvedValue({
      path: '/profile/data',
      kind: 'empty',
      sizeBytes: 0
    })
    window.dataDirectory = {
      getInfo: vi.fn().mockResolvedValue({
        currentPath: '/mnt/current',
        defaultPath: '/profile/data',
        sizeBytes: 8192,
        oldDataDirectory: null
      }),
      choose: vi.fn(),
      chooseDefault,
      resetDefault,
      migrate: vi.fn(),
      useExisting: vi.fn(),
      deleteOld: vi.fn()
    }

    render(<StorageSettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: '恢复默认位置' }))
    await waitFor(() => expect(chooseDefault).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '迁移数据目录？' })).toBeInTheDocument()
    expect(screen.getByText(/\/profile\/data/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制并重启' }))
    await waitFor(() => expect(resetDefault).toHaveBeenCalledTimes(1))
  })

  it('keeps case-sensitive Linux paths distinct when checking the default location', async () => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64'
    })
    const chooseDefault = vi.fn().mockResolvedValue({
      path: '/profile/data',
      kind: 'empty',
      sizeBytes: 0
    })
    window.dataDirectory = {
      getInfo: vi.fn().mockResolvedValue({
        currentPath: '/profile/Data',
        defaultPath: '/profile/data',
        sizeBytes: 8192,
        oldDataDirectory: null
      }),
      choose: vi.fn(),
      chooseDefault,
      resetDefault: vi.fn(),
      migrate: vi.fn(),
      useExisting: vi.fn(),
      deleteOld: vi.fn()
    }

    render(<StorageSettingsPage />)

    expect(await screen.findByText('/profile/Data')).toBeInTheDocument()
    expect(screen.getByText('8.0 KB · 自定义位置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复默认位置' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认位置' }))
    await waitFor(() => expect(chooseDefault).toHaveBeenCalledTimes(1))
  })
})
