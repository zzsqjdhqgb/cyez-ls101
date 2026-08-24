import { configStore } from '@ls101/config-store/renderer'
import type { JsonValue, ScopedConfigStore } from '@ls101/config-store/renderer'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppearanceSettings {
  theme: ThemePreference
  reduceMotion: boolean
}

type AppearanceSettingsDocument = Record<string, JsonValue>

export interface AppearanceSettingsApplication {
  load(): Promise<AppearanceSettings>
  save(settings: AppearanceSettings): Promise<void>
  reset(): Promise<AppearanceSettings>
}

export const defaultAppearanceSettings: AppearanceSettings = {
  theme: 'light',
  reduceMotion: false
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function parseSettings(value: unknown): AppearanceSettings {
  if (!value || typeof value !== 'object') throw new Error('外观设置数据无效')
  const document = value as Partial<AppearanceSettingsDocument> & {
    settings?: Partial<AppearanceSettings>
  }
  const settings = document.settings
  if (
    document.version !== 1 ||
    !settings ||
    !isThemePreference(settings.theme) ||
    typeof settings.reduceMotion !== 'boolean'
  ) {
    throw new Error('外观设置数据版本或内容无效')
  }
  return { theme: settings.theme, reduceMotion: settings.reduceMotion }
}

function validateSettings(settings: AppearanceSettings): AppearanceSettings {
  if (!isThemePreference(settings.theme) || typeof settings.reduceMotion !== 'boolean') {
    throw new Error('外观设置内容无效')
  }
  return { theme: settings.theme, reduceMotion: settings.reduceMotion }
}

export function createAppearanceSettingsApplication(
  store: ScopedConfigStore = configStore.scope('appearance')
): AppearanceSettingsApplication {
  return {
    async load() {
      const document = await store.read<AppearanceSettingsDocument>('settings')
      return document ? parseSettings(document) : { ...defaultAppearanceSettings }
    },

    async save(settings) {
      const next = validateSettings(settings)
      const document: AppearanceSettingsDocument = {
        version: 1,
        settings: {
          theme: next.theme,
          reduceMotion: next.reduceMotion
        }
      }
      await store.write('settings', document)
    },

    async reset() {
      await store.delete('settings')
      return { ...defaultAppearanceSettings }
    }
  }
}

export const appearanceSettingsApplication = createAppearanceSettingsApplication()
