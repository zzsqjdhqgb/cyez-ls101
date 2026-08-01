import { useEffect, useState, type JSX } from 'react'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import styles from './AppearanceSettingsExample.module.css'

type ThemePreference = 'system' | 'light' | 'dark'

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function AppearanceSettingsExample(): JSX.Element {
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = (): void => root.setAttribute('data-theme', resolveTheme(theme))

    applyTheme()
    if (theme === 'system') media.addEventListener('change', applyTheme)

    return () => media.removeEventListener('change', applyTheme)
  }, [theme])

  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion)
    return () => document.documentElement.removeAttribute('data-reduce-motion')
  }, [reduceMotion])

  return (
    <SettingsContent>
      <SettingsSection title="主题" description="调整应用的整体显示方式。">
        <SettingsRow label="界面主题" description="选择浅色、深色或跟随操作系统。">
          <select
            aria-label="界面主题"
            className={styles.select}
            onChange={(event) => setTheme(event.target.value as ThemePreference)}
            value={theme}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="交互" description="控制界面反馈和动态效果。">
        <SettingsRow label="减少动态效果" description="减少非必要的过渡和动画。">
          <label className={styles.switch}>
            <input
              aria-label="减少动态效果"
              checked={reduceMotion}
              onChange={(event) => setReduceMotion(event.target.checked)}
              role="switch"
              type="checkbox"
            />
            <span aria-hidden="true" className={styles.switchTrack} />
          </label>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  )
}
