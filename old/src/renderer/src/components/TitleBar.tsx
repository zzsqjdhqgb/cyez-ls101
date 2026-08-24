/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/components/TitleBar.tsx
import { JSX, useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Minus, Square, X } from 'lucide-react'

const TITLE_BAR_HEIGHT = 32

const styles = {
  bar: {
    height: TITLE_BAR_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    userSelect: 'none',
    flexShrink: 0,
    WebkitAppRegion: 'drag'
  } as React.CSSProperties,
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10
  } as React.CSSProperties,
  icon: {
    width: 16,
    height: 16,
    borderRadius: 3,
    objectFit: 'contain'
  } as React.CSSProperties,
  title: {
    fontSize: 12,
    fontWeight: 500
  } as React.CSSProperties,
  controls: {
    display: 'flex',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties,
  btn: {
    width: 46,
    height: TITLE_BAR_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    outline: 'none',
    borderRadius: 0,
    transition: 'background 0.15s, color 0.15s',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties,
  restoreIcon: {
    position: 'relative' as const,
    display: 'inline-flex',
    width: 12,
    height: 12
  },
  restoreSquare1: {
    position: 'absolute' as const,
    top: -1,
    left: 3
  },
  restoreSquare2: {
    position: 'absolute' as const,
    top: 1,
    left: -1
  }
}

function RestoreIcon(): JSX.Element {
  return (
    <span style={styles.restoreIcon}>
      <span style={styles.restoreSquare1}>
        <Square size={10} strokeWidth={2.5} />
      </span>
      <span style={styles.restoreSquare2}>
        <Square size={10} strokeWidth={2.5} />
      </span>
    </span>
  )
}

export default function TitleBar(): JSX.Element {
  const location = useLocation()
  const isExam = location.pathname.startsWith('/exam/')
  const [maximized, setMaximized] = useState(false)
  const appIcon = new URL('../assets/app-icon.png', import.meta.url).href

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setMaximized)
    const cleanup = window.electronAPI.window.onMaximizeChange(setMaximized)
    return cleanup
  }, [])

  const handleMinimize = useCallback(() => {
    window.electronAPI.window.minimize()
  }, [])

  const handleMaximize = useCallback(() => {
    window.electronAPI.window.maximize()
  }, [])

  const handleClose = useCallback(() => {
    window.electronAPI.window.close()
  }, [])

  const lightColors = {
    bg: '#ffffff',
    borderColor: '#e2e8f0',
    textColor: '#64748b',
    btnColor: '#64748b',
    btnHoverBg: '#f1f5f9',
    closeHoverBg: '#dc2626',
    closeHoverColor: '#ffffff'
  }

  const darkColors = {
    bg: '#1a1a1a',
    borderColor: '#333333',
    textColor: '#888888',
    btnColor: '#999999',
    btnHoverBg: '#333333',
    closeHoverBg: '#dc2626',
    closeHoverColor: '#ffffff'
  }

  const c = isExam ? darkColors : lightColors

  const barStyle: React.CSSProperties = isExam
    ? {
        ...styles.bar,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        background: 'transparent'
      }
    : {
        ...styles.bar,
        background: c.bg,
        borderBottom: `1px solid ${c.borderColor}`
      }

  const btnStyle = (): React.CSSProperties => ({
    ...styles.btn,
    color: c.btnColor
  })

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>, isClose: boolean): void => {
    if (isClose) {
      e.currentTarget.style.background = c.closeHoverBg
      e.currentTarget.style.color = c.closeHoverColor
    } else {
      e.currentTarget.style.background = c.btnHoverBg
      e.currentTarget.style.color = c.btnColor
    }
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.currentTarget.style.background = 'transparent'
    e.currentTarget.style.color = isExam ? darkColors.btnColor : lightColors.btnColor
  }

  return (
    <div style={barStyle}>
      <div style={styles.left}>
        <img src={appIcon} alt="" style={styles.icon} />
        <span style={{ ...styles.title, color: c.textColor }}>曹二听说101</span>
      </div>
      <div style={styles.controls}>
        <button
          onClick={handleMinimize}
          style={btnStyle()}
          onMouseEnter={(e) => handleMouseEnter(e, false)}
          onMouseLeave={(e) => handleMouseLeave(e)}
        >
          <Minus size={16} strokeWidth={2} />
        </button>
        <button
          onClick={handleMaximize}
          style={btnStyle()}
          onMouseEnter={(e) => handleMouseEnter(e, false)}
          onMouseLeave={(e) => handleMouseLeave(e)}
        >
          {maximized ? <RestoreIcon /> : <Square size={13} strokeWidth={2} />}
        </button>
        <button
          onClick={handleClose}
          style={btnStyle()}
          onMouseEnter={(e) => handleMouseEnter(e, true)}
          onMouseLeave={(e) => handleMouseLeave(e)}
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
