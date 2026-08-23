// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LegacyDataInfo } from '@ls101/core-types'
import { LegacyDataMigrationPage } from '../features/legacy-data/LegacyDataMigrationPage'

afterEach(() => {
  cleanup()
  delete window.legacyData
  delete window.windowControls
})

describe('LegacyDataMigrationPage', () => {
  it('requires cleanup before completing the startup flow', async () => {
    const archived = archivedInfo()
    const onComplete = vi.fn()
    const exportArchive = vi.fn().mockResolvedValue(true)
    const cleanupLegacy = vi.fn().mockResolvedValue({ ...archived, status: 'cleaned' })
    const getInfo = vi.fn().mockResolvedValue(archived)
    window.legacyData = {
      getInfo,
      exportArchive,
      cleanup: cleanupLegacy,
      retry: vi.fn()
    }

    render(<LegacyDataMigrationPage initialInfo={archived} onComplete={onComplete} />)

    expect(await screen.findByRole('heading', { name: '旧数据已归档' })).toBeInTheDocument()
    expect(getInfo).not.toHaveBeenCalled()
    expect(screen.getAllByText('2 个')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '稍后处理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '导出旧数据' }))
    await waitFor(() => expect(exportArchive).toHaveBeenCalledOnce())
    expect(await screen.findByText('归档已导出到你选择的位置。')).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清理并继续' }))
    await waitFor(() => expect(cleanupLegacy).toHaveBeenCalledOnce())
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  })

  it('completes immediately when the profile has no legacy data', async () => {
    const onComplete = vi.fn()
    window.legacyData = {
      getInfo: vi.fn().mockResolvedValue({
        status: 'none',
        archivePath: null,
        archiveSizeBytes: null,
        sourceDirectories: []
      }),
      exportArchive: vi.fn(),
      cleanup: vi.fn(),
      retry: vi.fn()
    }

    render(<LegacyDataMigrationPage onComplete={onComplete} />)

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  })

  it('keeps the blocking page open and offers retry after archival failure', async () => {
    const onComplete = vi.fn()
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

    render(<LegacyDataMigrationPage onComplete={onComplete} />)
    expect(await screen.findByRole('heading', { name: '旧数据整理失败' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取旧文件')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
    expect(await screen.findByRole('heading', { name: '旧数据已归档' })).toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('offers retry when an interrupted cleanup reports an error', async () => {
    const retry = vi.fn().mockResolvedValue(archivedInfo())
    window.legacyData = {
      getInfo: vi.fn().mockResolvedValue({
        ...archivedInfo(),
        status: 'cleaning',
        error: '无法继续清理旧文件'
      }),
      exportArchive: vi.fn(),
      cleanup: vi.fn(),
      retry
    }

    render(<LegacyDataMigrationPage onComplete={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '旧数据整理失败' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
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
