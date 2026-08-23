// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LicenseStatus } from '@ls101/core-types'
import { LicenseActivationPage } from '../features/license/LicenseActivationPage'

const expiresAt = '2026-10-01T15:59:59.999Z'
const notActivated: LicenseStatus = { state: 'not-activated', expiresAt }

afterEach(() => {
  cleanup()
  delete window.license
  delete window.windowControls
})

describe('LicenseActivationPage', () => {
  it('shows invalid-code feedback without opening the application', async () => {
    const onActivated = vi.fn()
    const activate = vi.fn().mockResolvedValue({
      activated: false,
      reason: 'invalid-code',
      status: notActivated
    })
    window.license = {
      getStatus: vi.fn(),
      activate,
      deactivate: vi.fn(),
      openActivationGuide: vi.fn()
    }

    render(<LicenseActivationPage initialStatus={notActivated} onActivated={onActivated} />)
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '激活并进入' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('邀请码不正确')
    expect(activate).toHaveBeenCalledWith('wrong')
    expect(onActivated).not.toHaveBeenCalled()
  })

  it('opens the application after successful activation', async () => {
    const onActivated = vi.fn().mockResolvedValue(undefined)
    window.license = {
      getStatus: vi.fn(),
      activate: vi.fn().mockResolvedValue({
        activated: true,
        status: {
          state: 'active',
          expiresAt,
          activatedAt: '2026-08-23T08:00:00.000Z'
        }
      }),
      deactivate: vi.fn(),
      openActivationGuide: vi.fn()
    }

    render(<LicenseActivationPage initialStatus={notActivated} onActivated={onActivated} />)
    fireEvent.change(screen.getByLabelText('邀请码'), { target: { value: 'valid-code' } })
    fireEvent.submit(screen.getByLabelText('邀请码').closest('form') as HTMLFormElement)

    await waitFor(() => expect(onActivated).toHaveBeenCalledOnce())
  })

  it('shows a terminal expired state without an activation form', () => {
    render(
      <LicenseActivationPage
        initialStatus={{ state: 'expired', expiresAt }}
        onActivated={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: '使用权限已到期' })).toBeInTheDocument()
    expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument()
    expect(screen.getByText(/2026年10月1日 23:59/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '参与激活方式意见征集' })).toBeInTheDocument()
  })

  it('opens the bundled activation guide', async () => {
    const openActivationGuide = vi.fn().mockResolvedValue(undefined)
    window.license = {
      getStatus: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
      openActivationGuide
    }

    render(<LicenseActivationPage initialStatus={notActivated} onActivated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '参与激活方式意见征集' }))

    await waitFor(() => expect(openActivationGuide).toHaveBeenCalledOnce())
  })
})
