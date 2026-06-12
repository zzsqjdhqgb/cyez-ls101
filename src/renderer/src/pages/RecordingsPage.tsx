/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/pages/RecordingsPage.tsx
import { JSX, useEffect, useState, useCallback } from 'react'
import { Search, Mic } from 'lucide-react'
import type { SubmissionItem } from '../types'
import { MessageModal, ConfirmModal } from '../components/Modal'

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    padding: '32px 40px'
  },
  content: { width: '100%', maxWidth: 960 },
  pageTitle: { fontSize: 28, fontWeight: 700, marginBottom: 28, color: '#0f172a' },
  toolbar: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  searchInput: {
    padding: '8px 12px',
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    outline: 'none',
    minWidth: 180
  },
  searchBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#3b82f6',
    color: '#fff',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  // 整个列表作为一个统一的卡片，有背景、圆角和阴影
  list: {
    display: 'flex',
    flexDirection: 'column',
    background: '#ffffff',
    borderRadius: 14,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)',
    padding: '12px 20px'
  },
  // 每个条目透明背景，无圆角，用底部分隔线区分
  compactCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9'
  },
  checkboxCell: { width: 36, textAlign: 'center' as const },
  compactInfo: { flex: 1, marginRight: 16 },
  compactTitle: { fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 4 },
  compactMeta: { fontSize: 13, color: '#94a3b8' },
  compactActions: { display: 'flex', gap: 8 },
  btnPrimary: {
    padding: '8px 22px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#475569',
    transition: 'all 0.2s ease',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  btnDanger: {
    padding: '8px 22px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #fecaca',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#fff5f5',
    color: '#dc2626',
    transition: 'all 0.2s ease',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  batchBtn: {
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#475569',
    outline: 'none',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s ease'
  },
  batchDangerBtn: {
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid #fecaca',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#fff5f5',
    color: '#dc2626',
    outline: 'none',
    whiteSpace: 'nowrap' as const,
    transition: 'all 0.2s ease'
  },
  emptyState: { textAlign: 'center', paddingTop: 80, color: '#94a3b8' },
  emptyIcon: { display: 'flex', justifyContent: 'center', marginBottom: 16 },
  emptyText: { fontSize: 20, fontWeight: 500, color: '#64748b' },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    fontSize: 18,
    color: '#94a3b8'
  }
}

export default function RecordingsPage(): JSX.Element {
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterName, setFilterName] = useState('')
  const [filterId, setFilterId] = useState('')
  const [filterExam, setFilterExam] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string } | null>(null)
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)

  const loadList = useCallback(
    async (filters?: { studentId?: string; name?: string; examTitle?: string }): Promise<void> => {
      setLoading(true)
      try {
        const list = await window.electronAPI.submission.list(filters)
        setSubmissions(list)
      } catch (err) {
        console.error('加载作答列表失败:', err)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect((): void => {
    loadList() // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadList])

  const applyFilters = (): void => {
    const filters: { studentId?: string; name?: string; examTitle?: string } = {}
    if (filterId.trim()) filters.studentId = filterId.trim()
    if (filterName.trim()) filters.name = filterName.trim()
    if (filterExam.trim()) filters.examTitle = filterExam.trim()
    setSelectedIds(new Set()) // 筛选后清空选中
    loadList(filters)
  }

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = (): void => {
    if (selectedIds.size === submissions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(submissions.map((s) => s.id)))
    }
  }

  const handleExport = async (submissionId: string): Promise<void> => {
    await window.electronAPI.submission.export(submissionId)
  }

  const handleBatchExport = async (): Promise<void> => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await window.electronAPI.submission.exportMultiple(ids)
  }

  const doDelete = async (submissionId: string): Promise<void> => {
    try {
      const result = await window.electronAPI.submission.delete(submissionId)
      if (result.success) {
        loadList()
      }
    } catch (err) {
      console.error('删除失败:', err)
      setMsgModal({ title: '操作失败', message: '删除失败', type: 'error' })
    }
  }

  const handleDelete = async (submissionId: string): Promise<void> => {
    setConfirmDelete({ id: submissionId })
  }

  const doBatchDelete = async (): Promise<void> => {
    const ids = [...selectedIds]
    try {
      const result = await window.electronAPI.submission.deleteMultiple(ids)
      if (result.success) {
        setSelectedIds(new Set())
        loadList()
      } else {
        setMsgModal({ title: '操作失败', message: '部分记录删除失败', type: 'error' })
        loadList()
      }
    } catch (err) {
      console.error('批量删除失败:', err)
      setMsgModal({ title: '操作失败', message: '批量删除失败', type: 'error' })
    }
  }

  const handleBatchDelete = async (): Promise<void> => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setConfirmBatchDelete(true)
  }

  const formatDate = (isoString: string): string => {
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.pageTitle}>作答列表</div>

        <div style={styles.toolbar}>
          <input
            style={styles.searchInput}
            placeholder="姓名"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
          />
          <input
            style={styles.searchInput}
            placeholder="学号"
            value={filterId}
            onChange={(e) => setFilterId(e.target.value)}
          />
          <input
            style={styles.searchInput}
            placeholder="试卷名称"
            value={filterExam}
            onChange={(e) => setFilterExam(e.target.value)}
          />
          <button onClick={applyFilters} style={styles.searchBtn}>
            <Search size={16} strokeWidth={2} />
            搜索
          </button>
          {selectedIds.size > 0 && (
            <>
              <button onClick={handleBatchExport} style={styles.batchBtn}>
                批量导出 ({selectedIds.size})
              </button>
              <button onClick={handleBatchDelete} style={styles.batchDangerBtn}>
                批量删除 ({selectedIds.size})
              </button>
            </>
          )}
        </div>

        {loading ? (
          <div style={styles.loading}>加载中...</div>
        ) : submissions.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <Mic size={52} strokeWidth={1.5} />
            </div>
            <div style={styles.emptyText}>还没有作答记录</div>
          </div>
        ) : (
          <div style={styles.list}>
            {/* 全选控制栏 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 0 12px',
                borderBottom: '1px solid #f1f5f9'
              }}
            >
              <input
                type="checkbox"
                checked={selectedIds.size === submissions.length && submissions.length > 0}
                onChange={toggleSelectAll}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span style={{ fontSize: 14, color: '#475569' }}>
                全选 ({selectedIds.size}/{submissions.length})
              </span>
            </div>

            {submissions.map((sub, index) => (
              <div
                key={sub.id}
                style={{
                  ...styles.compactCard,
                  borderBottom:
                    index === submissions.length - 1 ? 'none' : styles.compactCard.borderBottom
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#fafbfc'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <div style={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(sub.id)}
                    onChange={() => toggleSelect(sub.id)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                </div>
                <div style={styles.compactInfo}>
                  <div style={styles.compactTitle}>
                    {sub.student.name}（{sub.student.studentId}）- {sub.examTitle}
                  </div>
                  <div style={styles.compactMeta}>
                    {sub.recordingCount} 条录音 · 提交于 {formatDate(sub.submittedAt)}
                  </div>
                </div>
                <div style={styles.compactActions}>
                  <button
                    onClick={() => handleExport(sub.id)}
                    style={styles.btnPrimary}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc'
                      e.currentTarget.style.borderColor = '#cbd5e1'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#ffffff'
                      e.currentTarget.style.borderColor = '#e2e8f0'
                    }}
                  >
                    导出
                  </button>
                  <button
                    onClick={() => handleDelete(sub.id)}
                    style={styles.btnDanger}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#fef2f2'
                      e.currentTarget.style.borderColor = '#fca5a5'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#fff5f5'
                      e.currentTarget.style.borderColor = '#fecaca'
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmModal
          isOpen={true}
          title="确认删除"
          message="确定删除该作答记录吗？此操作不可恢复。"
          confirmLabel="删除"
          onConfirm={() => {
            const id = confirmDelete.id
            setConfirmDelete(null)
            doDelete(id)
          }}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
      {confirmBatchDelete && (
        <ConfirmModal
          isOpen={true}
          title="批量删除"
          message={`确定删除选中的 ${selectedIds.size} 条记录吗？此操作不可恢复。`}
          confirmLabel="删除"
          onConfirm={() => {
            setConfirmBatchDelete(false)
            doBatchDelete()
          }}
          onCancel={() => setConfirmBatchDelete(false)}
          danger
        />
      )}
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
