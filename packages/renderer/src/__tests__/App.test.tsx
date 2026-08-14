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
    expect(screen.getByRole('link', { name: '题型库' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '评分单元' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '试卷库' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '作答记录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '试卷模板' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '设置' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '题型库' }))
    expect(screen.getByRole('heading', { name: '题型库' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument()
  })

  it('opens the interface list from the workbench', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('link', { name: '题型库' }))
    expect(screen.getByRole('heading', { name: '题型库' })).toBeInTheDocument()
  })

  it('opens the template list from the workbench', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /制作试卷/ }))
    expect(screen.getByRole('heading', { name: '试卷模板' })).toBeInTheDocument()
  })

  it('registers list and details as standard and both editors as focus', () => {
    const routes = new Map(appRouteRegistry.getSnapshot().map((route) => [route.id, route]))
    expect(routes.get('interfaces')?.layout).toBe('standard')
    expect(routes.get('interface-drafts')?.layout).toBe('standard')
    expect(routes.get('interface-details')?.layout).toBe('standard')
    expect(routes.get('interface-draft-editor')?.layout).toBe('focus')
    expect(routes.get('interface-instance-editor')?.layout).toBe('focus')
    expect(routes.get('templates')?.layout).toBe('standard')
    expect(routes.get('template-editor')?.layout).toBe('focus')
    expect(routes.get('exams')?.layout).toBe('standard')
    expect(routes.get('exam-player')?.layout).toBe('immersive')
    expect(routes.get('schemas')?.layout).toBe('standard')
    expect(routes.get('schema-draft-library')?.layout).toBe('standard')
    expect(routes.get('schema-draft-editor')?.layout).toBe('focus')
    expect(routes.get('schema-definition-editor')?.layout).toBe('focus')
    expect(routes.get('submission-grading')?.layout).toBe('focus')
    expect(routes.get('interface-drafts')?.navigation).toBeUndefined()
  })

  it('keeps the expand control visible after collapsing the sidebar', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
    expect(screen.getByRole('link', { name: '工作台' }).className).not.toContain('=>')

    fireEvent.click(screen.getByRole('link', { name: '设置' }))
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
  })
})
