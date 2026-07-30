import { describe, expect, it, vi } from 'vitest'
import { PanelsTopLeft } from 'lucide-react'
import { AppRouteRegistry } from '../app/route-registry'

function TestPage() {
  return null
}

describe('AppRouteRegistry', () => {
  it('publishes registration and removal snapshots', () => {
    const registry = new AppRouteRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)

    const unregister = registry.register({
      id: 'test',
      path: '/test',
      component: TestPage,
      layout: 'focus',
      navigation: { label: '测试', icon: PanelsTopLeft }
    })

    expect(registry.getSnapshot()).toHaveLength(1)
    expect(registry.getSnapshot()[0]?.layout).toBe('focus')
    expect(listener).toHaveBeenCalledTimes(1)

    unregister()
    expect(registry.getSnapshot()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
  })

  it('rejects duplicate route ids and paths', () => {
    const registry = new AppRouteRegistry()
    registry.register({ id: 'first', path: '/first', component: TestPage })

    expect(() => registry.register({ id: 'first', path: '/second', component: TestPage })).toThrow(
      'Route id is already registered'
    )

    expect(() => registry.register({ id: 'second', path: '/first', component: TestPage })).toThrow(
      'Route path is already registered'
    )
  })
})
