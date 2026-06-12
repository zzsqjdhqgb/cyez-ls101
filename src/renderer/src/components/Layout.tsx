/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/components/Layout.tsx
import { JSX, useState, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ScrollText, Mic, FilePlus, ClipboardCheck, Info, Wrench } from 'lucide-react'
import { useOpenFileHandler } from '../hooks/useOpenFileHandler'
import { MessageModal, ConfirmModal } from './Modal'

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100%',
    background: '#f0f2f5'
  },
  sidebar: {
    width: 240,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '1px 0 4px rgba(0,0,0,0.04)',
    flexShrink: 0,
    zIndex: 10
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '20px 20px 28px',
    borderBottom: '1px solid #f1f5f9'
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    objectFit: 'contain' as const
  },
  logoText: {
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a',
    letterSpacing: '0.2px'
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 12px',
    gap: 2
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    color: '#475569',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    outline: 'none',
    textAlign: 'left' as const,
    width: '100%'
  },
  navLinkActive: {
    background: '#eff6ff',
    color: '#2563eb',
    fontWeight: 600
  },
  content: {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column'
  }
}

export default function Layout(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const [showDevOptions, setShowDevOptions] = useState(false)
  const appIcon = new URL('../assets/app-icon.png', import.meta.url).href

  const { fileModal, clearFileModal, refreshKey } = useOpenFileHandler()

  const checkDevMode = (): void => {
    const enabled = sessionStorage.getItem('devMode') === 'true'
    setShowDevOptions(enabled)
    window.electronAPI.dev.setDevToolsEnabled(enabled).catch(() => {})
  }

  useEffect(() => {
    window.electronAPI.dev
      .isDev()
      .then((isDev) => {
        if (isDev && sessionStorage.getItem('devMode') === null) {
          sessionStorage.setItem('devMode', 'true')
          window.dispatchEvent(new Event('storage'))
        }
        checkDevMode()
      })
      .catch(() => checkDevMode())
    const onStorage = (): void => checkDevMode()
    window.addEventListener('storage', onStorage)
    const interval = setInterval(checkDevMode, 500)
    return () => {
      window.removeEventListener('storage', onStorage)
      clearInterval(interval)
    }
  }, [])

  const isActive = (path: string): boolean => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div style={styles.container}>
      <aside style={styles.sidebar}>
        <div style={styles.logoArea}>
          <img src={appIcon} alt="" style={styles.logoIcon} />
          <span style={styles.logoText}>曹二听说101</span>
        </div>
        <nav style={styles.nav}>
          <button
            onClick={() => navigate('/')}
            style={{
              ...styles.navLink,
              ...(isActive('/') ? styles.navLinkActive : {})
            }}
            onMouseEnter={(e) => {
              if (!isActive('/')) e.currentTarget.style.background = '#f8fafc'
            }}
            onMouseLeave={(e) => {
              if (!isActive('/')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <ScrollText size={18} strokeWidth={2} />
            试卷列表
          </button>
          <button
            onClick={() => navigate('/recordings')}
            style={{
              ...styles.navLink,
              ...(isActive('/recordings') ? styles.navLinkActive : {})
            }}
            onMouseEnter={(e) => {
              if (!isActive('/recordings')) e.currentTarget.style.background = '#f8fafc'
            }}
            onMouseLeave={(e) => {
              if (!isActive('/recordings')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <Mic size={18} strokeWidth={2} />
            作答列表
          </button>
          <button
            onClick={() => navigate('/create/templates')}
            style={{
              ...styles.navLink,
              ...(isActive('/create') ? styles.navLinkActive : {})
            }}
            onMouseEnter={(e) => {
              if (!isActive('/create')) e.currentTarget.style.background = '#f8fafc'
            }}
            onMouseLeave={(e) => {
              if (!isActive('/create')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <FilePlus size={18} strokeWidth={2} />
            创建试卷
          </button>
          <button
            onClick={() => navigate('/grading')}
            style={{
              ...styles.navLink,
              ...(isActive('/grading') ? styles.navLinkActive : {})
            }}
            onMouseEnter={(e) => {
              if (!isActive('/grading')) e.currentTarget.style.background = '#f8fafc'
            }}
            onMouseLeave={(e) => {
              if (!isActive('/grading')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <ClipboardCheck size={18} strokeWidth={2} />
            批改管理
          </button>
          <button
            onClick={() => navigate('/about')}
            style={{
              ...styles.navLink,
              ...(isActive('/about') ? styles.navLinkActive : {})
            }}
            onMouseEnter={(e) => {
              if (!isActive('/about')) e.currentTarget.style.background = '#f8fafc'
            }}
            onMouseLeave={(e) => {
              if (!isActive('/about')) e.currentTarget.style.background = 'transparent'
            }}
          >
            <Info size={18} strokeWidth={2} />
            关于
          </button>
          {showDevOptions && (
            <button
              onClick={() => navigate('/dev-options')}
              style={{
                ...styles.navLink,
                ...(isActive('/dev-options') ? styles.navLinkActive : {})
              }}
              onMouseEnter={(e) => {
                if (!isActive('/dev-options')) e.currentTarget.style.background = '#f8fafc'
              }}
              onMouseLeave={(e) => {
                if (!isActive('/dev-options')) e.currentTarget.style.background = 'transparent'
              }}
            >
              <Wrench size={18} strokeWidth={2} />
              开发者选项
            </button>
          )}
        </nav>
      </aside>
      <main style={styles.content}>
        <Outlet key={refreshKey} />
      </main>

      {fileModal?.type === 'alert' && (
        <MessageModal
          isOpen={true}
          title="提示"
          message={fileModal.message}
          type="info"
          onClose={clearFileModal}
          closeLabel="确定"
        />
      )}
      {fileModal?.type === 'confirm' && (
        <ConfirmModal
          isOpen={true}
          title="导入文件"
          message={fileModal.message}
          onConfirm={fileModal.onConfirm}
          onCancel={fileModal.onCancel}
          confirmLabel="导入"
          cancelLabel="取消"
        />
      )}
      {fileModal?.type === 'completion' && (
        <MessageModal
          isOpen={true}
          title="导入完成"
          message={fileModal.message}
          type="success"
          onClose={fileModal.onDone}
          closeLabel="完成"
          actionLabel="查看"
          onAction={fileModal.onView}
        />
      )}
    </div>
  )
}
