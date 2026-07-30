import { useEffect, useState, type JSX } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { appIconUrl } from '../../assets'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  sidebarCollapsed: boolean
}

function RestoreIcon(): JSX.Element {
  return (
    <span className={styles.restoreIcon} aria-hidden="true">
      <Square />
      <Square />
    </span>
  )
}

export function TitleBar({ sidebarCollapsed }: TitleBarProps): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const controls = window.windowControls

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
      <div className={styles.brand} data-collapsed={sidebarCollapsed || undefined}>
        <img src={appIconUrl} alt="" />
        <span>曹二听说101</span>
      </div>
      <div className={styles.dragRegion} />
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
          disabled={!controls}
          title="关闭"
          type="button"
          onClick={() => void controls?.close()}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
