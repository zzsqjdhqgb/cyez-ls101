import type { JSX } from 'react'
import { RotateCcw } from 'lucide-react'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import type { ThemePreference } from './AppearanceSettingsApplication'
import { useAppearanceSettings } from './AppearanceSettingsContext'
import styles from './AppearanceSettingsPage.module.css'

export function AppearanceSettingsPage(): JSX.Element {
  const { settings, loading, saving, error, setTheme, setReduceMotion, reset } =
    useAppearanceSettings()

  if (!settings) {
    return (
      <div className={styles.status} role={error ? 'alert' : undefined}>
        <span>{error ?? (loading ? '正在加载外观设置...' : '外观设置不可用')}</span>
        {error ? (
          <Button disabled={saving} icon={RotateCcw} onClick={() => void reset()}>
            恢复默认设置
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <SettingsContent>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <SettingsSection title="主题" description="调整应用的整体显示方式。">
        <SettingsRow label="界面主题" description="选择浅色、深色或跟随操作系统。">
          <select
            aria-label="界面主题"
            className={styles.select}
            disabled={saving}
            onChange={(event) => void setTheme(event.target.value as ThemePreference)}
            value={settings.theme}
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
              checked={settings.reduceMotion}
              disabled={saving}
              onChange={(event) => void setReduceMotion(event.target.checked)}
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
