// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../app/register-placeholder-routes'
import { App } from '../app/App'

afterEach(cleanup)

describe('App', () => {
  it('renders registered navigation and switches pages', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '工作区' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
  })

  it('keeps the expand control visible after collapsing the sidebar', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
  })
})
