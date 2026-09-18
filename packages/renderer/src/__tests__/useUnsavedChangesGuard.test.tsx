// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSX } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'

afterEach(cleanup)

describe('useUnsavedChangesGuard', () => {
  it('synchronously disarms the native unload guard for an allowed navigation', () => {
    render(
      <MemoryRouter>
        <GuardHarness />
      </MemoryRouter>
    )

    const guardedUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(guardedUnload)).toBe(false)
    expect(guardedUnload.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '允许跳转' }))

    const allowedUnload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(allowedUnload)).toBe(true)
    expect(allowedUnload.defaultPrevented).toBe(false)
  })
})

function GuardHarness(): JSX.Element {
  const guard = useUnsavedChangesGuard(true)
  return (
    <button type="button" onClick={guard.allowNextNavigation}>
      允许跳转
    </button>
  )
}
