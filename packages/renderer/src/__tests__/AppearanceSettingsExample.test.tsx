// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSettingsExample } from '../features/settings/AppearanceSettingsExample'

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  )
})

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-reduce-motion')
  vi.unstubAllGlobals()
})

describe('AppearanceSettingsExample', () => {
  it('applies the selected theme and reduced motion preference', () => {
    render(<AppearanceSettingsExample />)

    fireEvent.change(screen.getByRole('combobox', { name: '界面主题' }), {
      target: { value: 'dark' }
    })
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    fireEvent.click(screen.getByRole('switch', { name: '减少动态效果' }))
    expect(document.documentElement).toHaveAttribute('data-reduce-motion')
  })
})
