/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/pages/DraftEditPage.tsx
import { JSX, useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, FileText, Pencil } from 'lucide-react'
import type { DraftView } from '../types'
import { MessageModal, ProgressModal, ResultModal } from '../components/Modal'
import EditableFormItem from './draft/EditableFormItem'

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#f0f2f5'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 32px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: 'transparent',
    color: '#475569',
    outline: 'none',
    transition: 'background 0.2s',
    flexShrink: 0
  },
  titleArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0
  },
  titleText: {
    fontSize: 24,
    fontWeight: 600,
    color: '#1e293b',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    border: '1px solid transparent',
    padding: '4px 8px',
    borderRadius: 6
  },
  titleInput: {
    fontSize: 24,
    fontWeight: 600,
    color: '#1e293b',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    padding: '4px 8px',
    background: '#fff',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box'
  },
  editIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: 'transparent',
    color: '#94a3b8',
    outline: 'none',
    transition: 'background 0.2s, color 0.2s',
    flexShrink: 0
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    flexShrink: 0
  },
  iconBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#fff',
    color: '#475569',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '8px 16px',
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
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '32px 40px'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    fontSize: 18,
    color: '#94a3b8'
  }
}

export default function DraftEditPage(): JSX.Element {
  const { draftId } = useParams<{ draftId: string }>()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<DraftView | null>(null)
  const [loading, setLoading] = useState(true)
  const [title, setTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

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
  const [collapsedPreviews, setCollapsedPreviews] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!draftId) return
    window.electronAPI.draft
      .load(draftId)
      .then((data) => {
        setDraft(data)
        setTitle(data.title)
      })
      .catch((err) => {
        console.error('加载草稿失败:', err)
        setMsgModal({ title: '加载失败', message: '无法加载草稿', type: 'error' })
      })
      .finally(() => setLoading(false))
  }, [draftId])

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  const handleTextChange = async (id: string, value: string): Promise<void> => {
    if (!draftId) return
    await window.electronAPI.draft.updateText(draftId, id, value)
    setDraft((prev) => (prev ? { ...prev, textValues: { ...prev.textValues, [id]: value } } : prev))
  }

  const handleTitleSave = async (): Promise<void> => {
    if (!draftId || !draft) return
    const newTitle = title.trim()
    if (newTitle === draft.title) {
      setIsEditingTitle(false)
      return
    }
    await window.electronAPI.draft.updateTitle(draftId, newTitle)
    const updated = await window.electronAPI.draft.load(draftId)
    setDraft(updated)
    setTitle(updated.title)
    setIsEditingTitle(false)
  }

  const handleFileUpload = async (id: string): Promise<void> => {
    if (!draftId) return
    await window.electronAPI.draft.uploadFile(draftId, id)
    const updated = await window.electronAPI.draft.load(draftId)
    setDraft(updated)
    setCollapsedPreviews((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handlePasteFromClipboard = async (id: string): Promise<void> => {
    if (!draftId) return
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const clipboardItem of clipboardItems) {
        for (const type of clipboardItem.types) {
          if (type.startsWith('image/')) {
            const blob = await clipboardItem.getType(type)
            const ext = type.split('/')[1] || 'png'
            const reader = new FileReader()
            const base64 = await new Promise<string>((resolve) => {
              reader.onload = () => resolve((reader.result as string).split(',')[1])
              reader.readAsDataURL(blob)
            })
            await window.electronAPI.draft.uploadClipboardImage(draftId, id, base64, ext)
            const updated = await window.electronAPI.draft.load(draftId)
            setDraft(updated)
            setCollapsedPreviews((prev) => {
              const next = { ...prev }
              delete next[id]
              return next
            })
            return
          }
        }
      }
    } catch {
      setMsgModal({ title: '粘贴失败', message: '剪贴板中没有图片', type: 'error' })
    }
  }

  const handleRemoveFile = async (id: string): Promise<void> => {
    if (!draftId) return
    await window.electronAPI.draft.removeFile(draftId, id)
    const updated = await window.electronAPI.draft.load(draftId)
    setDraft(updated)
  }

  const handleTogglePreview = (id: string): void => {
    setCollapsedPreviews((prev) => {
      const next = { ...prev }
      if (next[id]) {
        delete next[id]
      } else {
        next[id] = true
      }
      return next
    })
  }

  const handleExportExam = useCallback(() => {
    if (!draftId) return
    // 清理上次的监听器
    if (cancelExportListenerRef.current) {
      cancelExportListenerRef.current()
      cancelExportListenerRef.current = null
    }

    setIsExporting(true)
    setExportProgress({ step: '正在准备导出...', current: 0, total: 100 })
    setExportResult(null)

    // 注册进度监听
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
  }, [draftId])

  const handleExportDraft = (): void => {
    if (!draftId) return
    void window.electronAPI.draft.exportDraft(draftId)
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>加载草稿...</div>
      </div>
    )
  }

  if (!draft) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.loading, color: '#dc2626' }}>草稿不存在</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button
            onClick={() => navigate('/create/drafts')}
            style={styles.backBtn}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="返回草稿列表"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>

          <div style={styles.titleArea}>
            {isEditingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleTitleSave()
                  }
                  if (e.key === 'Escape') {
                    setTitle(draft.title)
                    setIsEditingTitle(false)
                  }
                }}
                style={styles.titleInput}
                placeholder="未命名试卷"
              />
            ) : (
              <span style={styles.titleText}>{title}</span>
            )}
            <button
              onClick={() => {
                if (!isEditingTitle) {
                  setIsEditingTitle(true)
                }
              }}
              style={styles.editIcon}
              title="编辑标题"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f1f5f9'
                e.currentTarget.style.color = '#475569'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#94a3b8'
              }}
            >
              <Pencil size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button onClick={handleExportDraft} style={styles.iconBtn} title="导出草稿包">
            <Download size={18} strokeWidth={2} />
            导出草稿
          </button>
          <button onClick={handleExportExam} style={styles.primaryBtn} title="导出试卷包">
            <FileText size={18} strokeWidth={2} />
            导出试卷
          </button>
        </div>
      </div>
      <div style={styles.content}>
        {draft.editableItems.map((item) => (
          <EditableFormItem
            key={item.id}
            item={item}
            draftId={draftId!}
            textValue={draft.textValues[item.id] ?? ''}
            fileValue={draft.fileValues[item.id] || ''}
            fileOriginalName={draft.fileOriginalNames[item.id] || ''}
            previewCollapsed={!!collapsedPreviews[item.id]}
            onTextChange={handleTextChange}
            onFileUpload={handleFileUpload}
            onClipboardPaste={handlePasteFromClipboard}
            onRemoveFile={handleRemoveFile}
            onTogglePreview={handleTogglePreview}
          />
        ))}
      </div>

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
    </div>
  )
}
