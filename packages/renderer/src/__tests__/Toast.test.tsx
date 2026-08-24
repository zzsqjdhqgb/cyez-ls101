// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { toast } from '../components/ui/toast'
import { AppToaster } from '../components/ui/ToastViewport'

afterEach(() => {
  toast.dismiss()
  cleanup()
})

describe('Toast', () => {
  it('renders project notifications and allows dismissing them', async () => {
    render(<AppToaster />)

    act(() => {
      toast.success('设置已保存', { description: '新的配置已经生效' })
    })

    const message = await screen.findByText('设置已保存')
    const notification = message.closest('[data-sonner-toast]')
    expect(notification).not.toBeNull()
    expect(screen.getByText('新的配置已经生效')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))

    await waitFor(() => expect(notification).toHaveAttribute('data-removed', 'true'))
  })

  it('shows an overflow badge when more than four notifications are active', async () => {
    render(<AppToaster />)

    const ids: Array<string | number> = []
    act(() => {
      for (let index = 1; index <= 6; index += 1) {
        ids.push(toast.info(`通知 ${index}`, { duration: Infinity }))
      }
    })

    expect(await screen.findByText('2+')).toHaveAccessibleName('还有 2 条通知未显示，当前共 6 条')

    act(() => {
      toast.dismiss(ids[0])
    })

    expect(await screen.findByText('1+')).toHaveAccessibleName('还有 1 条通知未显示，当前共 5 条')

    act(() => {
      toast.dismiss(ids[1])
    })

    await waitFor(() => expect(screen.queryByText('1+')).not.toBeInTheDocument())
  })
})
