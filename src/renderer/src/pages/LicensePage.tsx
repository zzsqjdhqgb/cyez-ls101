/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useState, useEffect } from 'react'

interface LicensePageProps {
  onActivated: () => void
}

export default function LicensePage({ onActivated }: LicensePageProps): JSX.Element {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    window.electronAPI.license
      .isExpired()
      .then((expired) => {
        setExpired(expired)
        if (expired) return
        return window.electronAPI.license.hasStoredLicense()
      })
      .then((hasStored) => {
        if (hasStored) {
          onActivated()
        }
      })
      .catch(() => {
        setError('初始化失败，请重启软件')
      })
      .finally(() => {
        setChecking(false)
      })
  }, [onActivated])

  const handleSubmit = async (): Promise<void> => {
    const trimmed = code.trim()
    if (!trimmed) {
      setError('请输入邀请码')
      return
    }

    setError('')
    setChecking(true)

    try {
      const hasStored = await window.electronAPI.license.hasStoredLicense()

      if (hasStored) {
        const valid = await window.electronAPI.license.verifyStored(trimmed)
        if (valid) {
          onActivated()
        } else {
          setError('邀请码不正确')
        }
      } else {
        const valid = await window.electronAPI.license.validateCode(trimmed)
        if (valid) {
          await window.electronAPI.license.activate(trimmed)
          onActivated()
        } else {
          setError('邀请码不正确')
        }
      }
    } catch {
      setError('验证失败，请稍后重试')
    } finally {
      setChecking(false)
    }
  }

  if (expired) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc'
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16, color: '#dc2626' }}>!</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
          试用期已到期
        </div>
        <div style={{ fontSize: 14, color: '#64748b' }}>
          软件试用期已于 2026年7月1日 到期，如需继续使用请联系开发者。
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc'
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 40,
          width: 360,
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>
          曹二听说101
        </div>
        <div style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
          请输入邀请码以激活软件
        </div>

        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit()
          }}
          placeholder="邀请码"
          disabled={checking}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: 15,
            border: `1px solid ${error ? '#dc2626' : '#e2e8f0'}`,
            borderRadius: 8,
            outline: 'none',
            boxSizing: 'border-box',
            textAlign: 'center',
            letterSpacing: 2,
            color: '#1e293b',
            background: checking ? '#f1f5f9' : '#fff'
          }}
        />

        {error && (
          <div style={{ fontSize: 13, color: '#dc2626', marginTop: 8, marginBottom: -4 }}>
            {error}
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={checking}
          style={{
            width: '100%',
            marginTop: 16,
            padding: '10px 0',
            fontSize: 15,
            fontWeight: 600,
            color: '#fff',
            background: checking ? '#93c5fd' : '#3b82f6',
            border: 'none',
            borderRadius: 8,
            cursor: checking ? 'not-allowed' : 'pointer'
          }}
        >
          {checking ? '验证中...' : '激活'}
        </button>

        <div
          style={{
            marginTop: 20,
            padding: '10px 12px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 6,
            fontSize: 12,
            color: '#92400e',
            lineHeight: 1.6
          }}
        >
          此邀请码将于 <b>2026年7月1日</b> 到期，届时软件将无法启动。
        </div>
      </div>
    </div>
  )
}
