/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SettlementRecord } from '../types'
import { MessageModal } from '../components/Modal'

const STATUS_ORDER: Record<SettlementRecord['status'], number> = {
  canSettle: 0,
  grading: 1,
  ungraded: 2
}

const STATUS_BADGE: Record<
  SettlementRecord['status'],
  { bg: string; color: string; label: string }
> = {
  canSettle: { bg: '#dcfce7', color: '#166534', label: '可结算' },
  grading: { bg: '#fef9c3', color: '#a16207', label: '批改中' },
  ungraded: { bg: '#f1f5f9', color: '#64748b', label: '未批改' }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  loadingContainer: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: { fontSize: 28, color: '#94a3b8' },
  toolbar: {
    height: 52,
    minHeight: 52,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    borderBottom: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
  },
  title: { fontSize: 20, fontWeight: 700, color: '#0f172a' },
  btnOutline: {
    fontSize: 14,
    padding: '6px 16px',
    background: '#ffffff',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  mainContent: {
    flex: 1,
    overflowY: 'auto',
    padding: '32px 40px',
    display: 'flex',
    justifyContent: 'center'
  },
  content: { width: '100%', maxWidth: 960 },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 14
  },
  headerCell: {
    textAlign: 'left' as const,
    padding: '10px 16px',
    color: '#94a3b8',
    fontWeight: 500,
    fontSize: 13,
    borderBottom: '1px solid #e2e8f0'
  },
  cell: {
    padding: '12px 16px',
    color: '#334155',
    borderBottom: '1px solid #f1f5f9'
  },
  badge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 500
  },
  bottomBar: {
    height: 60,
    minHeight: 60,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 24px',
    borderTop: '1px solid #e2e8f0',
    boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
    gap: 12
  },
  btnSecondary: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#f1f5f9',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  btnPrimary: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    boxShadow: '0 1px 4px rgba(59,130,246,0.2)'
  },
  empty: { textAlign: 'center' as const, paddingTop: 60, color: '#94a3b8', fontSize: 15 },
  btnDisabled: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#94a3b8',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'not-allowed',
    fontWeight: 600,
    opacity: 0.6
  }
}

export default function GradingSettlementPage(): JSX.Element {
  const navigate = useNavigate()
  const [records, setRecords] = useState<SettlementRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(false)
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const result = await window.electronAPI.grading.getSettlementInfo()
        if (result.success) {
          setRecords(result.records)
        }
      } catch (err) {
        console.error('加载结算信息失败:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const handleSettleNow = async (): Promise<void> => {
    setSettling(true)
    try {
      const result = await window.electronAPI.grading.settleNow()
      if (result.success) {
        setMsgModal({
          title: '结算完成',
          message: result.batchId ? `批次号：${result.batchId}` : '批改已结算',
          type: 'success'
        })
        navigate('/grading')
      } else {
        setMsgModal({ title: '操作失败', message: '结算失败', type: 'error' })
      }
    } catch (err) {
      console.error('结算失败:', err)
      setMsgModal({ title: '操作失败', message: '结算失败', type: 'error' })
    } finally {
      setSettling(false)
    }
  }

  const handleSettleLater = async (): Promise<void> => {
    await window.electronAPI.grading.settleLater()
    navigate('/grading')
  }

  const sorted = [...records].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  const hasSettleable = sorted.some((r) => r.status === 'canSettle')

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>加载中...</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <div style={styles.title}>批改结算</div>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.content}>
          {sorted.length === 0 ? (
            <div style={styles.empty}>没有需要结算的批改记录</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.headerCell}>姓名</th>
                  <th style={styles.headerCell}>学号</th>
                  <th style={styles.headerCell}>试卷名称</th>
                  <th style={styles.headerCell}>批改进度</th>
                  <th style={styles.headerCell}>状态</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.rid}>
                    <td style={styles.cell}>{r.studentName}</td>
                    <td style={styles.cell}>{r.studentId}</td>
                    <td style={styles.cell}>{r.examTitle}</td>
                    <td style={styles.cell}>
                      {r.gradedCount}/{r.totalItems}
                    </td>
                    <td style={styles.cell}>
                      <span
                        style={{
                          ...styles.badge,
                          background: STATUS_BADGE[r.status].bg,
                          color: STATUS_BADGE[r.status].color
                        }}
                      >
                        {STATUS_BADGE[r.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={styles.bottomBar}>
        <button onClick={handleSettleLater} style={styles.btnSecondary}>
          下次结算
        </button>
        {hasSettleable ? (
          <button
            onClick={() => void handleSettleNow()}
            disabled={settling}
            style={styles.btnPrimary}
          >
            {settling ? '结算中...' : '本次结算'}
          </button>
        ) : (
          <button disabled style={styles.btnDisabled}>
            不可结算
          </button>
        )}
      </div>

      {msgModal && (
        <MessageModal
          isOpen={true}
          title={msgModal.title}
          message={msgModal.message}
          type={msgModal.type}
          onClose={() => setMsgModal(null)}
          closeLabel="确定"
        />
      )}
    </div>
  )
}
