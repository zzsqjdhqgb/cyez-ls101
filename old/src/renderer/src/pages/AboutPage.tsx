/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// 馋猫是 zzsqjdhqgb 的常用中文昵称
// 本软件为私有且机密，保留所有权利。

import { JSX, useState, useEffect } from 'react'
import { Info, Wrench } from 'lucide-react'

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    padding: '32px 40px'
  },
  content: {
    width: '100%',
    maxWidth: 640
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 28,
    color: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  card: {
    background: '#ffffff',
    borderRadius: 14,
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)'
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 24
  },
  developerList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20
  },
  developerItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    borderRadius: 12,
    background: '#f8fafc',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.15s ease'
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 10,
    objectFit: 'cover',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
  },
  developerName: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b'
  },
  licenseSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTop: '1px solid #f1f5f9'
  },
  licenseText: {
    fontSize: 14,
    color: '#64748b',
    lineHeight: 1.6
  },
  licenseLink: {
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  devSection: {
    marginTop: 24,
    paddingTop: 24,
    borderTop: '1px solid #f1f5f9'
  },
  devToggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  devToggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 16,
    fontWeight: 500,
    color: '#1e293b'
  },
  toggle: {
    width: 48,
    height: 26,
    borderRadius: 13,
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.2s',
    outline: 'none'
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 3,
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
  },
  devOptionsBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#475569',
    outline: 'none',
    transition: 'all 0.2s ease'
  }
}

const initiator = {
  name: '上海市曹杨第二中学校长 周飞',
  avatar: 'app-resource://avatar_zhoufei.png'
}

const developers = [
  {
    // 馋猫 is the commonly used chinese nickname for zzsqjdhqgb
    name: '馋猫',
    avatar: 'app-resource://avatar_cat.png',
    url: 'https://github.com/zzsqjdhqgb'
  },
  {
    name: '上海市曹杨第二中学英语教师 邹娟',
    avatar: 'app-resource://avatar_zoujuan.png',
    url: 'https://github.com/zoujuan19900130'
  }
]

export default function AboutPage(): JSX.Element {
  const [devMode, setDevMode] = useState(() => sessionStorage.getItem('devMode') === 'true')
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setVersion)
  }, [])

  const handleOpenUrl = (url: string): void => {
    window.open(url, '_blank')
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.pageTitle}>
          <Info size={28} strokeWidth={2} />
          关于
        </div>

        <div style={styles.card}>
          <div style={styles.sectionTitle}>项目发起人</div>
          <div style={styles.developerList}>
            <div style={{ ...styles.developerItem, cursor: 'default' }} title={initiator.name}>
              <img src={initiator.avatar} alt={initiator.name} style={styles.avatar} />
              <span style={styles.developerName}>{initiator.name}</span>
            </div>
          </div>

          <div style={styles.sectionTitle}>开发者列表</div>
          <div style={styles.developerList}>
            {developers.map((dev) => (
              <div
                key={dev.url}
                style={styles.developerItem}
                onClick={() => handleOpenUrl(dev.url)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#eff6ff'
                  e.currentTarget.style.borderColor = '#bfdbfe'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f8fafc'
                  e.currentTarget.style.borderColor = 'transparent'
                }}
                title={`打开 GitHub 主页: ${dev.url}`}
              >
                <img src={dev.avatar} alt={dev.name} style={styles.avatar} />
                <span style={styles.developerName}>{dev.name}</span>
              </div>
            ))}
          </div>

          <div style={styles.devSection}>
            <div style={styles.devToggleRow}>
              <div style={styles.devToggleLabel}>
                <Wrench size={18} strokeWidth={2} />
                开发者模式
              </div>
              <button
                style={{
                  ...styles.toggle,
                  background: devMode ? '#22c55e' : '#d1d5db'
                }}
                onClick={() => {
                  const next = !devMode
                  setDevMode(next)
                  sessionStorage.setItem('devMode', String(next))
                  window.dispatchEvent(new Event('storage'))
                }}
              >
                <span
                  style={{
                    ...styles.toggleKnob,
                    left: devMode ? 25 : 3
                  }}
                />
              </button>
            </div>
          </div>

          <div style={styles.licenseSection}>
            <div style={styles.licenseText}>
              <span
                style={styles.licenseLink}
                onClick={() => handleOpenUrl('https://github.com/zzsqjdhqgb/CYEZ')}
              >
                曹二听说101
              </span>
              <br />
              Copyright (c) 2026 Haoting Ying (
              <span
                style={styles.licenseLink}
                onClick={() => handleOpenUrl('https://github.com/zzsqjdhqgb')}
              >
                zzsqjdhqgb
              </span>
              ). All rights reserved.
              {version && (
                <>
                  <br />
                  版本：{version}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
