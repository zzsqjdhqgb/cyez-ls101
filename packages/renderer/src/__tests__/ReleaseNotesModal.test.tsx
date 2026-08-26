// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReleaseNotesModal } from '../features/release-notes/ReleaseNotesModal'

afterEach(() => {
  cleanup()
  delete window.appInfo
})

describe('ReleaseNotesModal', () => {
  it('presents the current release using the shared modal', async () => {
    window.appInfo = {
      getVersion: vi.fn().mockResolvedValue('0.4.1-test'),
      ensureInstallationMarker: vi.fn().mockResolvedValue(undefined),
      claimReleaseNotesVersion: vi.fn().mockResolvedValue(false)
    }
    const onOpenChange = vi.fn()

    render(<ReleaseNotesModal open onOpenChange={onOpenChange} />)

    expect(screen.getByRole('dialog', { name: '曹二听说101 v0.4.1' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '启动与稳定性' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '内置内容' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '桌面交互' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Windows 安装' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '升级说明' })).toBeInTheDocument()
    expect(await screen.findByText('已安装 0.4.1-test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看完整变更/ })).toHaveAttribute(
      'href',
      'https://github.com/zzsqjdhqgb/cyez-ls101/compare/v0.4.0...v0.4.1'
    )

    expect(screen.getByRole('button', { name: '关闭版本说明' })).toBeInTheDocument()
  })
})
