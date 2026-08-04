// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualImageGenerationCoordinator } from '../features/airouter/ManualImageGeneration'
import { ManualImageGenerationDialog } from '../features/airouter/ManualImageGenerationDialog'

const mocks = vi.hoisted(() => ({
  readBinary: vi.fn(),
  readImage: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('@ls101/file-dialog/renderer', () => ({
  fileDialog: { readBinary: mocks.readBinary }
}))

vi.mock('@ls101/clipboard/renderer', () => ({
  imageClipboard: { readImage: mocks.readImage, writeText: mocks.writeText }
}))

afterEach(() => {
  mocks.readBinary.mockReset()
  mocks.readImage.mockReset()
  mocks.writeText.mockReset()
  vi.restoreAllMocks()
  cleanup()
})

describe('ManualImageGenerationDialog', () => {
  it('copies the prompt and resolves with a clipboard image', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:manual-image')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    mocks.writeText.mockResolvedValue(undefined)
    mocks.readImage.mockResolvedValue(new Uint8Array([1, 2, 3]))
    const coordinator = new ManualImageGenerationCoordinator()
    render(<ManualImageGenerationDialog coordinator={coordinator} />)

    let pending!: Promise<{ data: Uint8Array; mediaType: string }>
    act(() => {
      pending = coordinator.generate('一名学生站在操场上')
    })

    expect(screen.getByDisplayValue('一名学生站在操场上')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith('一名学生站在操场上'))

    fireEvent.click(screen.getByRole('button', { name: '从剪贴板读取' }))
    expect(await screen.findByAltText('待导入图片预览')).toHaveAttribute('src', 'blob:manual-image')
    fireEvent.click(screen.getByRole('button', { name: '使用此图片' }))

    await expect(pending).resolves.toEqual({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png'
    })
  })
})
