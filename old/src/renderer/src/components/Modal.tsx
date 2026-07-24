/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'

const overlay: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000
}

const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  width: 420,
  padding: 0,
  boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  overflow: 'hidden'
}

const header: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  padding: '16px 24px',
  borderBottom: '1px solid #e2e8f0',
  color: '#1e293b'
}

const body: React.CSSProperties = {
  padding: '24px'
}

const footer: React.CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid #e2e8f0',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 12
}

const progressBarContainer: React.CSSProperties = {
  width: '100%',
  height: 8,
  background: '#f1f5f9',
  borderRadius: 4,
  overflow: 'hidden',
  marginBottom: 16
}

const stepText: React.CSSProperties = {
  fontSize: 14,
  color: '#475569',
  marginBottom: 12
}

const errorListContainer: React.CSSProperties = {
  maxHeight: 200,
  overflowY: 'auto',
  marginTop: 12
}

const errorItem: React.CSSProperties = {
  fontSize: 12,
  color: '#475569',
  padding: '4px 0',
  borderBottom: '1px solid #f1f5f9'
}

const closeBtn: React.CSSProperties = {
  padding: '8px 24px',
  fontSize: 14,
  fontWeight: 500,
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#475569',
  outline: 'none'
}

const confirmBtn: React.CSSProperties = {
  padding: '8px 24px',
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  color: '#fff',
  outline: 'none'
}

const rejectBtn: React.CSSProperties = {
  padding: '8px 24px',
  fontSize: 14,
  fontWeight: 500,
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#475569',
  outline: 'none'
}

interface MessageModalProps {
  isOpen: boolean
  title: string
  message: string
  type?: 'info' | 'success' | 'error'
  onClose: () => void
  closeLabel?: string
  actionLabel?: string
  onAction?: () => void
}

export function MessageModal({
  isOpen,
  title,
  message,
  type = 'info',
  onClose,
  closeLabel = '关闭',
  actionLabel,
  onAction
}: MessageModalProps): JSX.Element {
  if (!isOpen) return <></>

  const titleColor = type === 'error' ? '#dc2626' : type === 'success' ? '#16a34a' : '#1e293b'

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={{ ...header, color: titleColor }}>{title}</div>
        <div style={body}>
          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>{message}</div>
        </div>
        <div style={footer}>
          <button onClick={onClose} style={closeBtn}>
            {closeLabel}
          </button>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              style={{
                ...confirmBtn,
                background: '#3b82f6'
              }}
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  isOpen: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
  danger = false
}: ConfirmModalProps): JSX.Element {
  if (!isOpen) return <></>

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={header}>{title}</div>
        <div style={body}>
          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>{message}</div>
        </div>
        <div style={footer}>
          <button onClick={onCancel} style={rejectBtn}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...confirmBtn,
              background: danger ? '#dc2626' : '#3b82f6'
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ProgressError {
  name: string
  detail: string
}

interface ProgressModalProps {
  isOpen: boolean
  title: string
  progress: { current: number; total: number; step?: string }
  errors?: ProgressError[]
  onCancel?: () => void
  cancelLabel?: string
}

export function ProgressModal({
  isOpen,
  title,
  progress,
  errors = [],
  onCancel,
  cancelLabel = '取消'
}: ProgressModalProps): JSX.Element {
  if (!isOpen) return <></>

  const pct =
    progress.total > 0 ? Math.min(Math.round((progress.current / progress.total) * 100), 100) : 0

  const barColor = errors.length > 0 ? '#f59e0b' : '#3b82f6'

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={header}>{title}</div>
        <div style={body}>
          <div style={progressBarContainer}>
            <div
              style={{
                height: '100%',
                borderRadius: 4,
                transition: 'width 0.3s ease',
                width: `${pct}%`,
                background: barColor
              }}
            />
          </div>
          <div style={stepText}>
            {progress.total > 0 ? `${progress.current} / ${progress.total}` : '准备中...'}
          </div>
          {progress.step && <div style={{ fontSize: 13, color: '#64748b' }}>{progress.step}</div>}
          {errors.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#dc2626',
                  marginBottom: 6
                }}
              >
                生成失败 {errors.length} 份：
              </div>
              <div style={errorListContainer}>
                {errors.map((err, i) => (
                  <div
                    key={i}
                    style={{
                      ...errorItem,
                      borderBottom: i < errors.length - 1 ? '1px solid #f1f5f9' : 'none'
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{err.name}</span>
                    <span style={{ color: '#94a3b8' }}> — {err.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {onCancel && (
          <div style={footer}>
            <button onClick={onCancel} style={rejectBtn}>
              {cancelLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface ResultDetail {
  label: string
  value: string
}

interface ResultModalProps {
  isOpen: boolean
  title: string
  success: boolean
  message?: string
  details?: ResultDetail[]
  errors?: ProgressError[]
  onClose: () => void
  closeLabel?: string
}

export function ResultModal({
  isOpen,
  title,
  success,
  message,
  details = [],
  errors = [],
  onClose,
  closeLabel = '关闭'
}: ResultModalProps): JSX.Element {
  if (!isOpen) return <></>

  return (
    <div style={overlay}>
      <div style={card}>
        <div
          style={{
            ...header,
            color: success ? '#16a34a' : '#dc2626'
          }}
        >
          {title}
        </div>
        <div style={body}>
          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6 }}>
            {message && (
              <div
                style={{
                  fontWeight: 600,
                  marginBottom: details.length > 0 || errors.length > 0 ? 12 : 0,
                  color: success ? '#16a34a' : '#dc2626'
                }}
              >
                {message}
              </div>
            )}
            {details.length > 0 && (
              <div style={{ marginBottom: errors.length > 0 ? 12 : 0 }}>
                {details.map((d, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#64748b', padding: '2px 0' }}>
                    {d.label}: {d.value}
                  </div>
                ))}
              </div>
            )}
            {errors.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#dc2626',
                    marginBottom: 6
                  }}
                >
                  失败 {errors.length} 条：
                </div>
                <div style={errorListContainer}>
                  {errors.map((err, i) => (
                    <div
                      key={i}
                      style={{
                        ...errorItem,
                        borderBottom: i < errors.length - 1 ? '1px solid #f1f5f9' : 'none'
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{err.name}</span>
                      <span style={{ color: '#94a3b8' }}> — {err.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={footer}>
          <button onClick={onClose} style={closeBtn}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
