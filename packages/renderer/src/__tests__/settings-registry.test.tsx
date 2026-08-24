import { describe, expect, it, vi } from 'vitest'
import { Cpu, Palette } from 'lucide-react'
import { SettingsPageRegistry } from '../app/settings-registry'

function TestPage() {
  return null
}

describe('SettingsPageRegistry', () => {
  it('publishes registration and idempotent removal snapshots', () => {
    const registry = new SettingsPageRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)

    const unregister = registry.register({
      id: 'ai-engine',
      title: 'AI 引擎',
      description: '配置 AI 服务',
      icon: Cpu,
      group: { id: 'intelligence', label: '智能服务', order: 10 },
      component: TestPage
    })

    expect(registry.getSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)

    unregister()
    unregister()
    expect(registry.getSnapshot()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('rejects duplicate page ids and conflicting group metadata', () => {
    const registry = new SettingsPageRegistry()
    registry.register({
      id: 'appearance',
      title: '外观',
      icon: Palette,
      group: { id: 'general', label: '通用', order: 0 },
      component: TestPage
    })

    expect(() =>
      registry.register({
        id: 'appearance',
        title: '另一个外观页面',
        icon: Palette,
        group: { id: 'other', label: '其他' },
        component: TestPage
      })
    ).toThrow('Settings page id is already registered')

    expect(() =>
      registry.register({
        id: 'language',
        title: '语言',
        icon: Palette,
        group: { id: 'general', label: '基础', order: 0 },
        component: TestPage
      })
    ).toThrow('Settings group metadata conflicts')
  })
})
