// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LegacyDataInfo } from '@ls101/core-types'
import { LegacyDataDialog } from '../features/settings/LegacyDataDialog'

afterEach(() => {
  cleanup()
  delete window.legacyData
})

describe('LegacyDataDialog', () => {
  it('exports an archived ZIP before confirming cleanup', async () => {
    const archived = archivedInfo()
    const exportArchive = vi.fn().mockResolvedValue(true)
    const cleanupLegacy = vi.fn().mockResolvedValue({ ...archived, status: 'cleaned' })
    window.legacyData = {
      getInfo: vi.fn().mockResolvedValue(archived),
      exportArchive,
      cleanup: cleanupLegacy,
      retry: vi.fn()
    }

    render(<LegacyDataDialog />)

    expect(await screen.findByRole('heading', { name: '检测到旧版数据' })).toBeInTheDocument()
    expect(screen.getByText(/2 个目录、2 个文件/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导出旧数据' }))
    await waitFor(() => expect(exportArchive).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/归档已导出到你选择的位置/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '继续并清理' }))
    await waitFor(() => expect(cleanupLegacy).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '检测到旧版数据' })).not.toBeInTheDocument()
    )
  })

  it('can defer cleanup without deleting data', async () => {
    const cleanupLegacy = vi.fn()
    window.legacyData = {
      getInfo: vi.fn().mockResolvedValue(archivedInfo()),
      exportArchive: vi.fn(),
      cleanup: cleanupLegacy,
      retry: vi.fn()
    }

    render(<LegacyDataDialog />)
    fireEvent.click(await screen.findByRole('button', { name: '稍后处理' }))

    expect(cleanupLegacy).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: '检测到旧版数据' })).not.toBeInTheDocument()
  })

  it('offers retry when archival failed', async () => {
    const retry = vi.fn().mockResolvedValue(archivedInfo())
    window.legacyData = {
      getInfo: vi.fn().mockResolvedValue({
        status: 'error',
        archivePath: null,
        archiveSizeBytes: null,
        sourceDirectories: [],
        error: '无法读取旧文件'
      }),
      exportArchive: vi.fn(),
      cleanup: vi.fn(),
      retry
    }

    render(<LegacyDataDialog />)
    expect(await screen.findByRole('heading', { name: '旧数据归档失败' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取旧文件')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '检测到旧版数据' })).toBeInTheDocument()
  })
})

function archivedInfo(): LegacyDataInfo {
  return {
    status: 'archived',
    archivePath: '/profile/legacy-archives/legacy.zip',
    archiveSizeBytes: 512,
    sourceDirectories: [
      { name: 'drafts', fileCount: 1, sizeBytes: 5 },
      { name: 'submissions', fileCount: 1, sizeBytes: 5 }
    ]
  }
}
