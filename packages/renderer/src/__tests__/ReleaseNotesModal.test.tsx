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
      getVersion: vi.fn().mockResolvedValue('0.4.0-test')
    }
    const onOpenChange = vi.fn()

    render(<ReleaseNotesModal open onOpenChange={onOpenChange} />)

    expect(screen.getByRole('dialog', { name: '曹二听说101 v0.4.0' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '内容准备' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '试卷模板与生成' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '评分与结算' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI 与语音能力' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '升级注意事项' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '已知限制' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('内置模板')
    expect(await screen.findByText('已安装 0.4.0-test')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看完整变更/ })).toHaveAttribute(
      'href',
      'https://github.com/zzsqjdhqgb/cyez-ls101/compare/v0.3.2...v0.4.0'
    )

    expect(screen.getByRole('button', { name: '关闭版本说明' })).toBeInTheDocument()
  })
})
