// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../app/register-placeholder-routes'
import { App } from '../app/App'

afterEach(cleanup)

describe('App', () => {
  it('renders main, grouped and footer navigation registrations', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument()
    expect(screen.getByText('示例分组')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '分组页面' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '分组页面' }))
    expect(screen.getByRole('heading', { name: '分组页面' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
  })

  it('registers a route without adding it to the sidebar', () => {
    render(<App />)

    expect(screen.queryByRole('link', { name: '隐藏页面' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '打开隐藏页面' }))
    expect(screen.getByRole('heading', { name: '隐藏页面' })).toBeInTheDocument()
  })

  it('keeps the expand control visible after collapsing the sidebar', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
  })
})
