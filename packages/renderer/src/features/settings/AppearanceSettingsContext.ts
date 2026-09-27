import { createContext, useContext } from 'react'
import type { AppearanceSettings } from './AppearanceSettingsApplication'

export interface AppearanceSettingsContextValue {
  settings: AppearanceSettings | null
  loading: boolean
  saving: boolean
  error: string | null
  setTheme(theme: AppearanceSettings['theme']): Promise<void>
  setReduceMotion(reduceMotion: boolean): Promise<void>
  reset(): Promise<void>
}

export const AppearanceSettingsContext = createContext<AppearanceSettingsContextValue | null>(null)

export function useAppearanceSettings(): AppearanceSettingsContextValue {
  const value = useContext(AppearanceSettingsContext)
  if (!value) throw new Error('外观设置上下文缺失，请在应用内打开本页。')
  return value
}
