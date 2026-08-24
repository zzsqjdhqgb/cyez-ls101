import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react'
import {
  appearanceSettingsApplication,
  type AppearanceSettings,
  type AppearanceSettingsApplication
} from './AppearanceSettingsApplication'
import { AppearanceSettingsContext } from './AppearanceSettingsContext'
import { applyAppearanceSettings } from './AppearanceSettingsRuntime'

interface AppearanceSettingsProviderProps {
  children: ReactNode
  application?: AppearanceSettingsApplication
}

export function AppearanceSettingsProvider({
  children,
  application = appearanceSettingsApplication
}: AppearanceSettingsProviderProps): JSX.Element {
  const [settings, setSettings] = useState<AppearanceSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void application
      .load()
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [application])

  useEffect(() => {
    if (settings) applyAppearanceSettings(settings)
  }, [settings])

  const persist = useCallback(
    async (next: AppearanceSettings): Promise<void> => {
      const previous = settings
      setSettings(next)
      setError(null)
      setSaving(true)
      try {
        await application.save(next)
      } catch (reason) {
        setSettings(previous)
        setError(errorMessage(reason))
      } finally {
        setSaving(false)
      }
    },
    [application, settings]
  )

  const setTheme = useCallback(
    async (theme: AppearanceSettings['theme']): Promise<void> => {
      if (!settings) return
      await persist({ ...settings, theme })
    },
    [persist, settings]
  )

  const setReduceMotion = useCallback(
    async (reduceMotion: boolean): Promise<void> => {
      if (!settings) return
      await persist({ ...settings, reduceMotion })
    },
    [persist, settings]
  )

  const reset = useCallback(async (): Promise<void> => {
    setError(null)
    setSaving(true)
    try {
      setSettings(await application.reset())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }, [application])

  return (
    <AppearanceSettingsContext.Provider
      value={{ settings, loading, saving, error, setTheme, setReduceMotion, reset }}
    >
      {children}
    </AppearanceSettingsContext.Provider>
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '外观设置操作失败'
}
