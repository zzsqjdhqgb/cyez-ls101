/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/pages/CreateExamPage.tsx
import { JSX, useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TemplateListItem, DraftListItem } from '../types'
import { MessageModal, ConfirmModal, ProgressModal, ResultModal } from '../components/Modal'

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: '32px 40px'
  },
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
  actions: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
    alignItems: 'center'
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
    outline: 'none'
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
    outline: 'none'
  },
  btnDanger: {
    padding: '8px 18px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #fecaca',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#fff5f5',
    color: '#dc2626',
    outline: 'none'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  card: {
    background: '#ffffff',
    borderRadius: 12,
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    transition: 'box-shadow 0.2s'
  },
  cardDev: {
    background: '#fffbe6',
    borderRadius: 12,
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    transition: 'box-shadow 0.2s'
  },
  cardInfo: {
    flex: 1,
    marginRight: 24
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 4
  },
  cardMeta: {
    fontSize: 13,
    color: '#94a3b8'
  },
  cardActions: {
    display: 'flex',
    gap: 8
  },
  empty: {
    textAlign: 'center',
    paddingTop: 60,
    color: '#94a3b8'
  }
}

export default function CreateExamPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = location.pathname.includes('/drafts') ? 'drafts' : 'templates'

  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [drafts, setDrafts] = useState<DraftListItem[]>([])
  const [loading, setLoading] = useState(false)

  // 导出进度相关状态
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({
    step: '',
    current: 0,
    total: 100
  })
  const [exportResult, setExportResult] = useState<{
    success: boolean
    error?: string
  } | null>(null)
  const cancelExportListenerRef = useRef<(() => void) | null>(null)
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'template' | 'draft'
    id: string
  } | null>(null)

  const loadTemplates = async (): Promise<void> => {
    setLoading(true)
    try {
      const devMode = sessionStorage.getItem('devMode') === 'true'
      const list = await window.electronAPI.template.list(devMode)
      list.sort((a, b) => {
        if (a.dev && !b.dev) return 1
        if (!a.dev && b.dev) return -1
        return 0
      })
      setTemplates(list)
    } catch (err) {
      console.error('加载模板列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const loadDrafts = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.electronAPI.draft.list()
      setDrafts(list)
    } catch (err) {
      console.error('加载草稿列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'templates') {
      loadTemplates() // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      loadDrafts()
    }
  }, [activeTab])

  const switchTab = (tab: 'templates' | 'drafts'): void => {
    navigate(tab === 'templates' ? '/create/templates' : '/create/drafts')
  }

  const handleImportTemplate = async (): Promise<void> => {
    const result = await window.electronAPI.template.import()
    if (result.success) {
      loadTemplates()
    } else if (result.error) {
      setMsgModal({ title: '导入失败', message: result.error, type: 'error' })
    }
  }

  const handleCreateDraft = async (templateId: string): Promise<void> => {
    try {
      const draftId = await window.electronAPI.draft.create(templateId)
      navigate(`/draft/${draftId}`)
    } catch (err) {
      console.error('创建草稿失败:', err)
      setMsgModal({ title: '操作失败', message: '创建草稿失败', type: 'error' })
    }
  }

  const handleExportTemplate = (id: string): void => {
    void window.electronAPI.template.export(id)
  }

  const handleDeleteTemplate = (id: string): void => {
    setDeleteTarget({ type: 'template', id })
  }

  const handleEditDraft = (draftId: string): void => {
    navigate(`/draft/${draftId}`)
  }

  const handleExportDraft = (draftId: string): void => {
    void window.electronAPI.draft.exportDraft(draftId)
  }

  // 新增：带进度监听的导出试卷
  const handleExportExam = (draftId: string): void => {
    if (cancelExportListenerRef.current) {
      cancelExportListenerRef.current()
      cancelExportListenerRef.current = null
    }

    setIsExporting(true)
    setExportProgress({ step: '正在准备导出...', current: 0, total: 100 })
    setExportResult(null)

    cancelExportListenerRef.current = window.electronAPI.draft.onExportProgress((progress) => {
      setExportProgress(progress)
    })

    window.electronAPI.draft
      .exportExam(draftId)
      .then((result) => {
        if (cancelExportListenerRef.current) {
          cancelExportListenerRef.current()
          cancelExportListenerRef.current = null
        }
        setExportResult(result)
      })
      .catch((err) => {
        if (cancelExportListenerRef.current) {
          cancelExportListenerRef.current()
          cancelExportListenerRef.current = null
        }
        setExportResult({ success: false, error: String(err) })
      })
  }

  const handleDeleteDraft = (draftId: string): void => {
    setDeleteTarget({ type: 'draft', id: draftId })
  }

  const handleImportDraft = async (): Promise<void> => {
    await window.electronAPI.draft.importDraft()
    loadDrafts()
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
      <div style={styles.tabBar}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'templates' ? styles.tabActive : {})
          }}
          onClick={() => switchTab('templates')}
        >
          试卷模板
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'drafts' ? styles.tabActive : {})
          }}
          onClick={() => switchTab('drafts')}
        >
          试卷草稿
        </button>
      </div>

      {activeTab === 'templates' && (
        <>
          <div style={styles.actions}>
            <button
              onClick={() => {
                void handleImportTemplate()
              }}
              style={styles.btnPrimary}
            >
              导入模板
            </button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: '#94a3b8' }}>加载中...</div>
          ) : templates.length === 0 ? (
            <div style={styles.empty}>暂无模板</div>
          ) : (
            <div style={styles.list}>
              {templates.map((t) => (
                <div key={t.id} style={t.dev ? styles.cardDev : styles.card}>
                  <div style={styles.cardInfo}>
                    <div style={styles.cardTitle}>{t.title}</div>
                    <div style={styles.cardMeta}>创建于 {formatDate(t.createdAt)}</div>
                  </div>
                  <div style={styles.cardActions}>
                    <button
                      onClick={() => {
                        void handleCreateDraft(t.id)
                      }}
                      style={styles.btnPrimary}
                    >
                      新建试卷
                    </button>
                    <button onClick={() => handleExportTemplate(t.id)} style={styles.btnSecondary}>
                      导出
                    </button>
                    <button
                      onClick={() => {
                        handleDeleteTemplate(t.id)
                      }}
                      style={styles.btnDanger}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'drafts' && (
        <>
          <div style={styles.actions}>
            <button
              onClick={() => {
                void handleImportDraft()
              }}
              style={styles.btnSecondary}
            >
              导入草稿
            </button>
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: '#94a3b8' }}>加载中...</div>
          ) : drafts.length === 0 ? (
            <div style={styles.empty}>暂无草稿</div>
          ) : (
            <div style={styles.list}>
              {drafts.map((d) => (
                <div key={d.id} style={styles.card}>
                  <div style={styles.cardInfo}>
                    <div style={styles.cardTitle}>{d.title}</div>
                    <div style={styles.cardMeta}>最后更新 {formatDate(d.updatedAt)}</div>
                  </div>
                  <div style={styles.cardActions}>
                    <button onClick={() => handleEditDraft(d.id)} style={styles.btnPrimary}>
                      编辑
                    </button>
                    <button onClick={() => handleExportExam(d.id)} style={styles.btnSecondary}>
                      导出试卷
                    </button>
                    <button onClick={() => handleExportDraft(d.id)} style={styles.btnSecondary}>
                      导出草稿
                    </button>
                    <button
                      onClick={() => {
                        handleDeleteDraft(d.id)
                      }}
                      style={styles.btnDanger}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isExporting && !exportResult && (
        <ProgressModal isOpen={true} title="正在导出试卷" progress={exportProgress} />
      )}
      {isExporting && exportResult && (
        <ResultModal
          isOpen={true}
          title={exportResult.success ? '导出成功' : '导出失败'}
          success={exportResult.success}
          message={exportResult.success ? undefined : exportResult.error || '导出失败'}
          onClose={() => {
            setIsExporting(false)
            setExportResult(null)
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
      {deleteTarget && (
        <ConfirmModal
          isOpen={true}
          title="确认删除"
          message={deleteTarget.type === 'template' ? '确定删除此模板？' : '确定删除此草稿？'}
          confirmLabel="删除"
          cancelLabel="取消"
          danger
          onConfirm={() => {
            const target = deleteTarget
            setDeleteTarget(null)
            if (target.type === 'template') {
              window.electronAPI.template.delete(target.id).then((result) => {
                if (result.success) loadTemplates()
              })
            } else {
              window.electronAPI.draft.delete(target.id).then((result) => {
                if (result.success) loadDrafts()
              })
            }
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
