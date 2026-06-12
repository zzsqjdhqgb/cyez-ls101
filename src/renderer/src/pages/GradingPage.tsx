/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/pages/GradingPage.tsx
import { JSX, useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Search,
  Upload,
  ClipboardCheck,
  ChevronRight,
  ChevronDown,
  FileText,
  Download,
  Eye,
  X
} from 'lucide-react'
import type { GradingListItem, GradingBatch, GradingRecord } from '../types'
import { MessageModal, ProgressModal, ResultModal } from '../components/Modal'

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
  tabBar: {
    display: 'flex',
    gap: 0,
    marginBottom: 24,
    borderBottom: '1px solid #e2e8f0'
  },
  tab: {
    padding: '10px 24px',
    fontSize: 16,
    fontWeight: 500,
    background: 'transparent',
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    cursor: 'pointer',
    color: '#64748b',
    outline: 'none'
  },
  tabActive: {
    color: '#2563eb',
    borderBottomColor: '#2563eb'
  },
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
  btnPrimary: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#3b82f6',
    color: '#fff',
    boxShadow: '0 1px 4px rgba(59,130,246,0.2)',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  btnSecondary: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#475569',
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
    whiteSpace: 'nowrap',
    transition: 'all 0.2s ease'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
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
  card: {
    background: '#ffffff',
    borderRadius: 14,
    padding: '12px 20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)'
  },
  empty: { textAlign: 'center' as const, paddingTop: 60, color: '#94a3b8' },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    fontSize: 18,
    color: '#94a3b8'
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 500
  },
  batchItem: {
    background: '#ffffff',
    borderRadius: 12,
    marginBottom: 12,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    overflow: 'hidden'
  },
  batchHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px 20px',
    cursor: 'pointer',
    gap: 12
  },
  batchInfo: { flex: 1 },
  batchTitle: { fontSize: 15, fontWeight: 600, color: '#1e293b', marginBottom: 2 },
  batchMeta: { fontSize: 13, color: '#94a3b8' },
  batchActions: { display: 'flex', gap: 8 },
  detailTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 14
  },
  detailHeader: {
    textAlign: 'left' as const,
    padding: '8px 20px',
    color: '#94a3b8',
    fontWeight: 500,
    fontSize: 13,
    borderBottom: '1px solid #f1f5f9'
  },
  detailCell: {
    padding: '10px 20px',
    color: '#334155',
    borderBottom: '1px solid #f8fafc'
  },
  expandBody: {
    padding: '0 20px 16px'
  }
}

const STATUS_LABEL: Record<string, string> = {
  ungraded: '未批改',
  grading: '批改中',
  completed: '已完成'
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  ungraded: { bg: '#fef9c3', text: '#a16207' },
  grading: { bg: '#dbeafe', text: '#1d4ed8' },
  completed: { bg: '#dcfce7', text: '#166534' }
}

export default function GradingPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = location.pathname.includes('/batches') ? 'batches' : 'grading'

  const [list, setList] = useState<GradingListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filterName, setFilterName] = useState('')
  const [filterId, setFilterId] = useState('')
  const [filterExam, setFilterExam] = useState('')
  const [selectedRids, setSelectedRids] = useState<Set<string>>(new Set())

  const [batches, setBatches] = useState<GradingBatch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(false)
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set())

  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [importResult, setImportResult] = useState<{
    success: boolean
    imported: number
    skipped: number
    failures: { student: string; reason: string }[]
    error?: string
  } | null>(null)
  const cancelProgressRef = useRef<(() => void) | null>(null)

  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, step: '' })
  const [pdfErrors, setPdfErrors] = useState<{ name: string; studentId: string; error: string }[]>(
    []
  )
  const [pdfResult, setPdfResult] = useState<{
    success: boolean
    error?: string
    errorCount?: number
  } | null>(null)
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)

  const [viewingHtml, setViewingHtml] = useState<string | null>(null)
  const [viewingTitle, setViewingTitle] = useState('')

  const loadList = useCallback(
    async (filters?: { studentId?: string; name?: string; examTitle?: string }): Promise<void> => {
      setLoading(true)
      try {
        const data = await window.electronAPI.grading.list(filters)
        setList(data)
      } catch (err) {
        console.error('加载批改列表失败:', err)
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const loadBatches = useCallback(async (): Promise<void> => {
    setBatchesLoading(true)
    try {
      const data = await window.electronAPI.grading.listBatches()
      setBatches(data)
    } catch (err) {
      console.error('加载批改记录失败:', err)
    } finally {
      setBatchesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'grading') {
      loadList() // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      loadBatches()
    }
  }, [activeTab, loadList, loadBatches])

  const switchTab = (tab: 'grading' | 'batches'): void => {
    navigate(tab === 'batches' ? '/grading/batches' : '/grading')
  }

  const applyFilters = (): void => {
    const filters: { studentId?: string; name?: string; examTitle?: string } = {}
    if (filterId.trim()) filters.studentId = filterId.trim()
    if (filterName.trim()) filters.name = filterName.trim()
    if (filterExam.trim()) filters.examTitle = filterExam.trim()
    setSelectedRids(new Set())
    loadList(filters)
  }

  const toggleSelect = (rid: string): void => {
    setSelectedRids((prev) => {
      const next = new Set(prev)
      if (next.has(rid)) next.delete(rid)
      else next.add(rid)
      return next
    })
  }

  const selectableItems = list.filter((i) => i.status !== 'completed')

  const toggleSelectAll = (): void => {
    if (selectedRids.size === selectableItems.length && selectableItems.length > 0) {
      setSelectedRids(new Set())
    } else {
      setSelectedRids(new Set(selectableItems.map((i) => i.rid)))
    }
  }

  const handleImportSubmissions = async (): Promise<void> => {
    setIsImporting(true)
    setImportProgress({ current: 0, total: 0 })
    setImportResult(null)

    if (cancelProgressRef.current) {
      cancelProgressRef.current()
      cancelProgressRef.current = null
    }

    cancelProgressRef.current = window.electronAPI.grading.onImportProgress(
      (progress: { current: number; total: number }) => {
        setImportProgress(progress)
      }
    )

    try {
      const result = await window.electronAPI.grading.importSubmissions()
      if (cancelProgressRef.current) {
        cancelProgressRef.current()
        cancelProgressRef.current = null
      }
      setImportResult(result)
      if (result.success) {
        loadList()
      }
    } catch (err) {
      if (cancelProgressRef.current) {
        cancelProgressRef.current()
        cancelProgressRef.current = null
      }
      setImportResult({
        success: false,
        imported: 0,
        skipped: 0,
        failures: [],
        error: String(err)
      })
    }
  }

  const handleStartGrading = async (): Promise<void> => {
    const rids = [...selectedRids]
    if (rids.length === 0) return
    try {
      const result = await window.electronAPI.grading.startGrading(rids)
      if (result.success && result.firstItem) {
        sessionStorage.setItem('gradingSessionRids', JSON.stringify(rids))
        sessionStorage.setItem('gradingSessionEid', result.eid || '')
        navigate('/grading/session')
      } else if (result.needsSettlement && result.settlementRids) {
        sessionStorage.setItem('gradingSettlementRids', JSON.stringify(result.settlementRids))
        navigate('/grading/settlement')
      } else if (result.error) {
        setMsgModal({ title: '操作失败', message: `开始批改失败: ${result.error}`, type: 'error' })
      }
    } catch (err) {
      console.error('开始批改失败:', err)
      setMsgModal({ title: '操作失败', message: '开始批改失败', type: 'error' })
    }
  }

  const handleExportCsv = async (batchId: string): Promise<void> => {
    try {
      await window.electronAPI.grading.exportCsv(batchId)
    } catch (err) {
      console.error('导出CSV失败:', err)
    }
  }

  const handleExportPdf = async (batchId: string): Promise<void> => {
    setIsExportingPdf(true)
    setPdfProgress({ current: 0, total: 0, step: '\u6B63\u5728\u5BFC\u51FA...' })
    setPdfErrors([])

    const cleanupProgress = window.electronAPI.grading.onPdfProgress(
      (progress: { current: number; total: number; step: string }) => {
        setPdfProgress(progress)
      }
    )

    const cleanupError = window.electronAPI.grading.onPdfError(
      (error: { name: string; studentId: string; error: string }) => {
        setPdfErrors((prev) => [...prev, error])
      }
    )

    try {
      const result = await window.electronAPI.grading.exportPdf(batchId)
      cleanupProgress()
      cleanupError()
      if (!result.success && result.error) {
        setPdfResult({ success: false, error: result.error })
      } else if (result.errorCount && result.errorCount > 0) {
        setPdfResult({ success: true, errorCount: result.errorCount })
      } else {
        setPdfResult({ success: true })
      }
    } catch (err) {
      console.error('\u5BFC\u51FAPDF\u5931\u8D25:', err)
      cleanupProgress()
      cleanupError()
      setPdfResult({ success: false, error: String(err) })
    }
  }

  const toggleExpandBatch = (batchId: string): void => {
    setExpandedBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }

  const handleCloseImportModal = (): void => {
    setIsImporting(false)
    setImportResult(null)
  }

  const handleViewGrading = async (rid: string, studentName: string): Promise<void> => {
    try {
      const result = await window.electronAPI.grading.getGradingHtml(rid)
      if (result.success && result.html) {
        setViewingTitle(`${studentName} - 批改详情`)
        setViewingHtml(result.html)
      } else {
        setMsgModal({
          title: '查看失败',
          message: result.error || '获取批改详情失败',
          type: 'error'
        })
      }
    } catch (err) {
      console.error('查看批改失败:', err)
      setMsgModal({ title: '查看失败', message: '获取批改详情失败', type: 'error' })
    }
  }

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.pageTitle}>批改管理</div>

        <div style={styles.tabBar}>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'grading' ? styles.tabActive : {})
            }}
            onClick={() => switchTab('grading')}
          >
            批改列表
          </button>
          <button
            style={{
              ...styles.tab,
              ...(activeTab === 'batches' ? styles.tabActive : {})
            }}
            onClick={() => switchTab('batches')}
          >
            批改记录
          </button>
        </div>

        {activeTab === 'grading' && (
          <>
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
              <button onClick={() => void handleImportSubmissions()} style={styles.btnPrimary}>
                <Upload size={16} strokeWidth={2} style={{ marginRight: 6 }} />
                导入作答包
              </button>
              {selectedRids.size > 0 && (
                <button onClick={() => void handleStartGrading()} style={styles.btnPrimary}>
                  <ClipboardCheck size={16} strokeWidth={2} style={{ marginRight: 6 }} />
                  开始批改 ({selectedRids.size})
                </button>
              )}
            </div>

            {loading ? (
              <div style={styles.loading}>加载中...</div>
            ) : list.length === 0 ? (
              <div style={styles.empty}>暂无待批改记录</div>
            ) : (
              <div style={styles.card}>
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
                    checked={
                      selectedRids.size === selectableItems.length && selectableItems.length > 0
                    }
                    onChange={toggleSelectAll}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 14, color: '#475569' }}>
                    全选 ({selectedRids.size}/{selectableItems.length})
                  </span>
                </div>

                {list.map((item, index) => (
                  <div
                    key={item.rid}
                    style={{
                      ...styles.compactCard,
                      borderBottom:
                        index === list.length - 1 ? 'none' : styles.compactCard.borderBottom
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
                        checked={selectedRids.has(item.rid)}
                        onChange={() => toggleSelect(item.rid)}
                        disabled={item.status === 'completed'}
                        style={{
                          width: 18,
                          height: 18,
                          cursor: item.status === 'completed' ? 'default' : 'pointer'
                        }}
                      />
                    </div>
                    <div style={styles.compactInfo}>
                      <div style={styles.compactTitle}>
                        {item.studentName}（{item.studentId}）- {item.examTitle}
                      </div>
                      <div style={styles.compactMeta}>
                        <span
                          style={{
                            ...styles.statusBadge,
                            background: STATUS_COLOR[item.status]?.bg ?? '#f1f5f9',
                            color: STATUS_COLOR[item.status]?.text ?? '#64748b'
                          }}
                        >
                          {STATUS_LABEL[item.status] ?? item.status}
                        </span>
                        {item.totalScore !== undefined && (
                          <span style={{ marginLeft: 8 }}>
                            得分: {item.totalScore}/{item.maxScore ?? '-'}
                          </span>
                        )}
                        {item.submittedAt && (
                          <span style={{ marginLeft: 8 }}>{formatDate(item.submittedAt)}</span>
                        )}
                      </div>
                    </div>
                    <div style={styles.compactActions}>
                      {item.status !== 'completed' && (
                        <button
                          onClick={() => {
                            setSelectedRids(new Set([item.rid]))
                            void handleStartGrading()
                          }}
                          style={styles.btnPrimary}
                        >
                          批改
                        </button>
                      )}
                      {item.status === 'completed' && (
                        <button
                          onClick={() => void handleViewGrading(item.rid, item.studentName)}
                          style={{
                            ...styles.btnSecondary,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <Eye size={16} strokeWidth={2} />
                          查看
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'batches' && (
          <>
            <div style={styles.toolbar}>
              <button onClick={() => void loadBatches()} style={styles.btnSecondary}>
                刷新
              </button>
            </div>

            {batchesLoading ? (
              <div style={styles.loading}>加载中...</div>
            ) : batches.length === 0 ? (
              <div style={styles.empty}>暂无批改记录</div>
            ) : (
              <div style={styles.list}>
                {batches.map((batch) => {
                  const isExpanded = expandedBatchIds.has(batch.batchId)
                  return (
                    <div key={batch.batchId} style={styles.batchItem}>
                      <div
                        style={styles.batchHeader}
                        onClick={() => toggleExpandBatch(batch.batchId)}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            color: '#64748b',
                            transition: 'transform 0.15s',
                            transform: isExpanded ? 'rotate(0deg)' : 'rotate(0deg)'
                          }}
                        >
                          {isExpanded ? (
                            <ChevronDown size={18} strokeWidth={2} />
                          ) : (
                            <ChevronRight size={18} strokeWidth={2} />
                          )}
                        </span>
                        <div style={styles.batchInfo}>
                          <div style={styles.batchTitle}>
                            批改时间: {formatDate(batch.gradedAt)}
                          </div>
                          <div style={styles.batchMeta}>批次数: {batch.records.length}</div>
                        </div>
                        <div style={styles.batchActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleExportCsv(batch.batchId)
                            }}
                            style={styles.batchBtn}
                          >
                            <Download size={14} strokeWidth={2} style={{ marginRight: 4 }} />
                            导出表格
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleExportPdf(batch.batchId)
                            }}
                            style={styles.batchBtn}
                          >
                            <FileText size={14} strokeWidth={2} style={{ marginRight: 4 }} />
                            导出PDF
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={styles.expandBody}>
                          <table style={styles.detailTable}>
                            <thead>
                              <tr>
                                <th style={styles.detailHeader}>姓名</th>
                                <th style={styles.detailHeader}>学号</th>
                                <th style={styles.detailHeader}>试卷名称</th>
                                <th style={styles.detailHeader}>分数</th>
                                <th style={styles.detailHeader}>作答时间</th>
                              </tr>
                            </thead>
                            <tbody>
                              {batch.records.map((record: GradingRecord) => (
                                <tr key={record.rid}>
                                  <td style={styles.detailCell}>{record.student.name}</td>
                                  <td style={styles.detailCell}>{record.student.studentId}</td>
                                  <td style={styles.detailCell}>{record.examTitle}</td>
                                  <td style={styles.detailCell}>
                                    {record.totalScore !== undefined
                                      ? `${record.totalScore}/${record.maxScore ?? '-'}`
                                      : '-'}
                                  </td>
                                  <td style={styles.detailCell}>
                                    {record.submittedAt ? formatDate(record.submittedAt) : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {isImporting && !importResult && (
          <ProgressModal isOpen={true} title="正在导入作答包" progress={importProgress} />
        )}
        {isImporting && importResult && (
          <ResultModal
            isOpen={true}
            title={importResult.success ? '导入完成' : '导入失败'}
            success={importResult.success}
            message={
              importResult.success
                ? `成功导入 ${importResult.imported} 条记录`
                : importResult.error || '导入失败'
            }
            details={
              importResult.skipped > 0
                ? [{ label: '跳过', value: `${importResult.skipped} 条重复记录` }]
                : []
            }
            errors={importResult.failures.map((f) => ({ name: f.student, detail: f.reason }))}
            onClose={handleCloseImportModal}
            closeLabel="确定"
          />
        )}

        {isExportingPdf && !pdfResult && (
          <ProgressModal
            isOpen={true}
            title="正在导出PDF"
            progress={pdfProgress}
            errors={pdfErrors.map((e) => ({
              name: `${e.name}（${e.studentId}）`,
              detail: e.error
            }))}
          />
        )}
        {isExportingPdf && pdfResult && (
          <ResultModal
            isOpen={true}
            title={pdfResult.success ? '导出完成' : '导出失败'}
            success={pdfResult.success}
            message={
              pdfResult.success
                ? pdfResult.errorCount
                  ? `PDF导出完成，但有 ${pdfResult.errorCount} 份生成失败`
                  : 'PDF导出完成'
                : pdfResult.error || '导出PDF失败'
            }
            errors={pdfErrors.map((e) => ({
              name: `${e.name}（${e.studentId}）`,
              detail: e.error
            }))}
            onClose={() => {
              setIsExportingPdf(false)
              setPdfResult(null)
            }}
            closeLabel="确定"
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

        {viewingHtml && (
          <div
            style={{
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
            }}
            onClick={() => {
              setViewingHtml(null)
              setViewingTitle('')
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 12,
                width: '90%',
                maxWidth: 900,
                height: '85%',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                overflow: 'hidden'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 20px',
                  borderBottom: '1px solid #e2e8f0',
                  flexShrink: 0
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600, color: '#1e293b' }}>
                  {viewingTitle}
                </span>
                <button
                  onClick={() => {
                    setViewingHtml(null)
                    setViewingTitle('')
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    borderRadius: 4,
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
              <iframe
                srcDoc={viewingHtml}
                style={{
                  flex: 1,
                  border: 'none',
                  width: '100%'
                }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
