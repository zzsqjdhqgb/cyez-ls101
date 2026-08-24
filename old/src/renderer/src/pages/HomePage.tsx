/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/pages/HomePage.tsx
import { JSX, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, BookOpen } from 'lucide-react'
import type { ExamListItem } from '../types'
import { MessageModal } from '../components/Modal'

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
    maxWidth: 960
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 700,
    marginBottom: 28,
    color: '#0f172a'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28
  },
  importBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 24px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(59,130,246,0.25)',
    transition: 'all 0.2s ease',
    outline: 'none'
  },
  examCount: {
    fontSize: 15,
    color: '#64748b',
    fontWeight: 500
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16
  },
  examCard: {
    background: '#ffffff',
    borderRadius: 14,
    padding: '22px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)',
    transition: 'box-shadow 0.2s ease'
  },
  examInfo: {
    flex: 1,
    marginRight: 24
  },
  examTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 6
  },
  examMeta: {
    fontSize: 14,
    color: '#94a3b8'
  },
  actions: {
    display: 'flex',
    gap: 12
  },
  btnPrimary: {
    padding: '8px 22px',
    fontSize: 14,
    fontWeight: 500,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#3b82f6',
    color: '#fff',
    boxShadow: '0 1px 4px rgba(59,130,246,0.2)',
    transition: 'all 0.2s ease',
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  btnSecondary: {
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
  emptyState: {
    textAlign: 'center',
    paddingTop: 80,
    color: '#94a3b8'
  },
  emptyIcon: {
    fontSize: 52,
    marginBottom: 16,
    display: 'flex',
    justifyContent: 'center'
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 500,
    color: '#64748b'
  },
  emptyHint: {
    fontSize: 15,
    marginTop: 8,
    color: '#94a3b8'
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

export default function HomePage(): JSX.Element {
  const [exams, setExams] = useState<ExamListItem[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)

  const loadList = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.electronAPI.exam.list()
      setExams(list)
    } catch (err) {
      console.error('加载考试列表失败:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    window.electronAPI.exam
      .list()
      .then((list) => setExams(list))
      .catch((err) => console.error('加载考试列表失败:', err))
      .finally(() => setLoading(false))
  }, [])

  const handleImport = async (): Promise<void> => {
    const result = await window.electronAPI.exam.import()
    if (result.success) {
      await loadList()
    } else if (result.error) {
      setMsgModal({ title: '导入失败', message: result.error, type: 'error' })
    }
  }

  const handleExport = async (examId: string): Promise<void> => {
    await window.electronAPI.exam.export(examId)
  }

  const handleDelete = async (examId: string): Promise<void> => {
    const result = await window.electronAPI.exam.delete(examId)
    if (result.success) {
      await loadList()
    }
  }

  const handleStartExam = (examId: string): void => {
    navigate(`/exam/${examId}`)
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
        <div style={styles.pageTitle}>考试管理</div>

        <div style={styles.toolbar}>
          <button
            onClick={handleImport}
            style={styles.importBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#2563eb'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,0.35)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#3b82f6'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(59,130,246,0.25)'
            }}
          >
            <Upload size={16} strokeWidth={2} />
            导入考试
          </button>
          {!loading && exams.length > 0 && (
            <span style={styles.examCount}>共 {exams.length} 套考试</span>
          )}
        </div>

        {loading ? (
          <div style={styles.loading}>加载中...</div>
        ) : exams.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <BookOpen size={52} strokeWidth={1.5} />
            </div>
            <div style={styles.emptyText}>还没有考试</div>
            <div style={styles.emptyHint}>点击“导入考试”添加第一套试卷</div>
          </div>
        ) : (
          <div style={styles.list}>
            {exams.map((exam) => (
              <div
                key={exam.id}
                style={styles.examCard}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow =
                    '0 4px 12px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow =
                    '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)'
                }}
              >
                <div style={styles.examInfo}>
                  <div style={styles.examTitle}>{exam.title}</div>
                  <div style={styles.examMeta}>
                    {exam.questionCount} 道题目 · 导入于 {formatDate(exam.importedAt)}
                  </div>
                </div>
                <div style={styles.actions}>
                  <button
                    onClick={() => handleStartExam(exam.id)}
                    style={styles.btnPrimary}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#2563eb'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#3b82f6'
                    }}
                  >
                    开始考试
                  </button>
                  <button
                    onClick={() => handleExport(exam.id)}
                    style={styles.btnSecondary}
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
                    onClick={() => handleDelete(exam.id)}
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
