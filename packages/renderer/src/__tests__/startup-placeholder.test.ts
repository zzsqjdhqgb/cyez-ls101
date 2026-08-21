import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyStartupLogoMotion,
  applyStartupPlaceholderIcon,
  showStartupProgress,
  waitForStartupLogoAnimation
} from '../startup-placeholder'

afterEach(() => {
  document.body.replaceChildren()
  document.head.querySelector('[data-startup-logo-motion]')?.remove()
})

describe('startup placeholder', () => {
  it('replaces the source HTML path with the Vite-resolved icon URL', () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="../../resources/icon.png" data-startup-icon>'

    applyStartupPlaceholderIcon(root, '/assets/icon-resolved.png')

    expect(root.querySelector('img')).toHaveAttribute('src', '/assets/icon-resolved.png')
  })

  it('injects the animated SVG and its motion CSS', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-startup-logo></div>'

    applyStartupLogoMotion(root, {
      logoMarkup: '<svg xmlns="http://www.w3.org/2000/svg"><g id="logo-lockup" /></svg>',
      motionCss: '#logo-lockup { animation: startup 1s; }'
    })

    expect(root.querySelector('svg #logo-lockup')).not.toBeNull()
    expect(document.head.querySelector('[data-startup-logo-motion]')).toHaveTextContent(
      '#logo-lockup { animation: startup 1s; }'
    )
  })

  it('waits for the logo animation end signal', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<svg><g id="logo-lockup"><g id="leaf" /></g></svg>'
    const completed = vi.fn()

    void waitForStartupLogoAnimation(root).then(completed)
    expect(completed).not.toHaveBeenCalled()

    root.querySelector('#leaf')?.dispatchEvent(new Event('animationend', { bubbles: true }))
    await Promise.resolve()
    expect(completed).not.toHaveBeenCalled()

    root.querySelector('#logo-lockup')?.dispatchEvent(new Event('animationend'))
    await Promise.resolve()
    expect(completed).toHaveBeenCalledOnce()
  })

  it('shows the loading bar while startup work is pending', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div data-startup-progress hidden></div>'

    showStartupProgress(root)

    expect(root.querySelector('[data-startup-progress]')).not.toHaveAttribute('hidden')
  })
})
