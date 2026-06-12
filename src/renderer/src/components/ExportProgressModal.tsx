/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'

interface ExportProgressModalProps {
  isOpen: boolean
  progress: {
    step: string
    current: number
    total: number
  }
  result: { success: boolean; error?: string } | null
  onClose: () => void
}

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
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
  },
  modal: {
    background: '#fff',
    borderRadius: 12,
    width: 400,
    padding: 0,
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    overflow: 'hidden'
  },
  header: {
    fontSize: 18,
    fontWeight: 600,
    padding: '16px 24px',
    borderBottom: '1px solid #e2e8f0',
    color: '#1e293b'
  },
  body: {
    padding: '24px'
  },
  progressBarContainer: {
    width: '100%',
    height: 8,
    background: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16
  },
  progressBar: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease'
  },
  stepText: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12
  },
  errorText: {
    fontSize: 14,
    color: '#dc2626',
    marginTop: 8,
    wordBreak: 'break-word'
  },
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid #e2e8f0',
    display: 'flex',
    justifyContent: 'flex-end'
  },
  closeBtn: {
    padding: '8px 24px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#fff',
    color: '#475569'
  }
}

export default function ExportProgressModal({
  isOpen,
  progress,
  result,
  onClose
}: ExportProgressModalProps): JSX.Element {
  if (!isOpen) return <></>

  const progressPercent = Math.min(Math.round((progress.current / progress.total) * 100), 100)

  return (
    <div style={modalStyles.overlay}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.header}>
          {result ? (result.success ? '导出成功' : '导出失败') : '正在导出试卷'}
        </div>
        <div style={modalStyles.body}>
          <div style={modalStyles.progressBarContainer}>
            <div
              style={{
                ...modalStyles.progressBar,
                width: `${progressPercent}%`,
                background: result ? (result.success ? '#22c55e' : '#ef4444') : '#3b82f6'
              }}
            />
          </div>
          <div style={modalStyles.stepText}>{progress.step}</div>
          {result && !result.success && <div style={modalStyles.errorText}>{result.error}</div>}
        </div>
        {result && (
          <div style={modalStyles.footer}>
            <button onClick={onClose} style={modalStyles.closeBtn}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
