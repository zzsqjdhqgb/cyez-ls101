import { describe, expect, it } from 'vitest'
import type { JsonValue, ScopedConfigStore } from '@ls101/config-store/renderer'
import {
  createAppearanceSettingsApplication,
  defaultAppearanceSettings
} from '../features/settings/AppearanceSettingsApplication'

function createMemoryStore(): ScopedConfigStore & { values: Map<string, JsonValue> } {
  const values = new Map<string, JsonValue>()
  const store: ScopedConfigStore & { values: Map<string, JsonValue> } = {
    values,
    scope() {
      return store
    },
    async read<T extends JsonValue>(key: string) {
      return (values.get(key) as T | undefined) ?? null
    },
    async write<T extends JsonValue>(key: string, value: T) {
      values.set(key, value)
    },
    async delete(key: string) {
      values.delete(key)
    },
    async clear() {
      values.clear()
    }
  }
  return store
}

describe('AppearanceSettingsApplication', () => {
  it('loads defaults, persists valid settings and resets them', async () => {
    const store = createMemoryStore()
    const application = createAppearanceSettingsApplication(store)

    await expect(application.load()).resolves.toEqual({ theme: 'light', reduceMotion: false })

    await application.save({ theme: 'dark', reduceMotion: true })
    await expect(application.load()).resolves.toEqual({ theme: 'dark', reduceMotion: true })

    await expect(application.reset()).resolves.toEqual({ theme: 'light', reduceMotion: false })
    await expect(application.load()).resolves.toEqual(defaultAppearanceSettings)
  })

  it('rejects invalid settings without writing them', async () => {
    const store = createMemoryStore()
    const application = createAppearanceSettingsApplication(store)

    await expect(
      application.save({ theme: 'invalid' as 'system', reduceMotion: false })
    ).rejects.toThrow('外观设置内容无效')
    expect(store.values.size).toBe(0)
  })
})
