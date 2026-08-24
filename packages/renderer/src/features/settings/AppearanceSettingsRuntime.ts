import type { AppearanceSettings, ThemePreference } from './AppearanceSettingsApplication'

let removeSystemThemeListener: (() => void) | null = null

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyAppearanceSettings(settings: AppearanceSettings): void {
  removeSystemThemeListener?.()
  removeSystemThemeListener = null

  const root = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = (): void => root.setAttribute('data-theme', resolveTheme(settings.theme))

  applyTheme()
  root.toggleAttribute('data-reduce-motion', settings.reduceMotion)

  if (settings.theme === 'system') {
    const listener = (): void => applyTheme()
    media.addEventListener('change', listener)
    removeSystemThemeListener = () => media.removeEventListener('change', listener)
  }
}
