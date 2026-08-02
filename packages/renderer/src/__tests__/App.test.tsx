// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '../app/register-placeholder-routes'
import { App } from '../app/App'
import { appRouteRegistry } from '../app/route-registry'

afterEach(() => {
  cleanup()
})

describe('App', () => {
  it('renders workbench, interface and footer navigation registrations', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '工作台' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '工作台' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '题型' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '题型' }))
    expect(screen.getByRole('heading', { name: '题型' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
  })

  it('opens the interface list from the workbench', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '打开题型' }))
    expect(screen.getByRole('heading', { name: '题型' })).toBeInTheDocument()
  })

  it('registers list and details as standard and both editors as focus', () => {
    const routes = new Map(appRouteRegistry.getSnapshot().map((route) => [route.id, route]))
    expect(routes.get('interfaces')?.layout).toBe('standard')
    expect(routes.get('interface-drafts')?.layout).toBe('standard')
    expect(routes.get('interface-details')?.layout).toBe('standard')
    expect(routes.get('interface-draft-editor')?.layout).toBe('focus')
    expect(routes.get('interface-instance-editor')?.layout).toBe('focus')
    expect(routes.get('interface-drafts')?.navigation).toBeUndefined()
  })

  it('keeps the expand control visible after collapsing the sidebar', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
  })
})
