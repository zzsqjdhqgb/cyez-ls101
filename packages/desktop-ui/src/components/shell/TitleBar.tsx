import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'
import type { WindowControlsBridge } from '@ls101/core-types'
import { appIconUrl } from '../../assets'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  sidebarCollapsed: boolean
  sidebarVisible: boolean
  closeDisabled?: boolean
  title?: string
  subtitle?: string
  icon?: string
  actions?: ReactNode
  windowControls?: WindowControlsBridge | null
}

function RestoreIcon(): JSX.Element {
  return (
    <span className={styles.restoreIcon} aria-hidden="true">
      <Square />
      <Square />
    </span>
  )
}

export function TitleBar({
  sidebarCollapsed,
  sidebarVisible,
  closeDisabled = false,
  title = '曹二听说101',
  subtitle,
  icon = appIconUrl,
  actions,
  windowControls
}: TitleBarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const controls = windowControls === undefined ? window.windowControls : windowControls

  useEffect(() => {
    if (!controls) return

    let mounted = true
    void controls.getMaximized().then((value) => {
      if (mounted) setMaximized(value)
    })

    const unsubscribe = controls.onMaximizedChange(setMaximized)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [controls])

  return (
    <header className={styles.titlebar}>
      <div
        className={styles.brand}
        data-collapsed={sidebarVisible && sidebarCollapsed ? true : undefined}
        data-sidebar-hidden={!sidebarVisible || undefined}
      >
        <img src={icon} alt="" />
        <span>{title}</span>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      <div className={styles.dragRegion} />
      {actions ? <div className={styles.titleActions}>{actions}</div> : null}
      <div className={styles.controls}>
        <button
          aria-label="最小化"
          className={styles.controlButton}
          disabled={!controls}
          title="最小化"
          type="button"
          onClick={() => void controls?.minimize()}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          aria-label={maximized ? '还原' : '最大化'}
          className={styles.controlButton}
          disabled={!controls}
          title={maximized ? '还原' : '最大化'}
          type="button"
          onClick={() => void controls?.toggleMaximize()}
        >
          {maximized ? <RestoreIcon /> : <Square aria-hidden="true" />}
        </button>
        <button
          aria-label="关闭"
          className={`${styles.controlButton} ${styles.closeButton}`}
          disabled={!controls || closeDisabled}
          title={closeDisabled ? '旧数据整理完成后可关闭' : '关闭'}
          type="button"
          onClick={() => void controls?.close()}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
