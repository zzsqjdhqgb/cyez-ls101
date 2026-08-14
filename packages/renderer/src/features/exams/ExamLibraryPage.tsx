import { useCallback, useEffect, useState, type JSX } from 'react'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type { ExamLibraryRecord } from '@ls101/exam-library'
import { AlertCircle, ClipboardCheck, Play, Trash2, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useExamLibrary } from './ExamLibraryContext'
import { examErrorMessage } from './examUi'
import styles from './ExamLibraryPage.module.css'

const EXAM_FILTER = [{ name: 'LS101 试卷包', extensions: ['lsexam', 'zip'] }]

export function ExamLibraryPage(): JSX.Element {
  const repository = useExamLibrary()
  const navigate = useNavigate()
  const [records, setRecords] = useState<ExamLibraryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ExamLibraryRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setRecords(await repository.listRecords())
    } catch (reason) {
      setError(examErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    let active = true
    void repository
      .listRecords()
      .then((items) => {
        if (active) setRecords(items)
      })
      .catch((reason: unknown) => {
        if (active) setError(examErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [repository])

  const importExam = async (): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      const selected = await fileDialog.readBinary({
        title: '导入试卷包',
        filters: EXAM_FILTER
      })
      if (!selected) return
      const result = await repository.importArchive(selected.data)
      await load()
      if (result.status === 'duplicate') {
        toast.info('该试卷包已经在考试库中')
      } else {
        toast.success(`已导入试卷“${result.record.title}”`)
      }
    } catch (reason) {
      setError(examErrorMessage(reason))
    } finally {
      setImporting(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    const record = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      await repository.deleteExam(record.packageId)
      await load()
      toast.success(`已删除试卷“${record.title}”`)
    } catch (reason) {
      setError(examErrorMessage(reason))
    }
  }

  const startExam = (record: ExamLibraryRecord): void => {
    navigate(`/exams/player?packageId=${encodeURIComponent(record.packageId)}`)
  }

  return (
    <Page>
      <PageHeader
        title="试卷库"
        actions={
          <Button
            icon={Upload}
            variant="primary"
            disabled={importing}
            onClick={() => void importExam()}
          >
            {importing ? '正在导入' : '导入试卷包'}
          </Button>
        }
      />

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? <div className={styles.loading}>正在加载考试库...</div> : null}
      {!loading && records.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="暂无试卷" />
      ) : null}
      {!loading && records.length > 0 ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>试卷</th>
                <th>导入时间</th>
                <th>页面</th>
                <th>资源</th>
                <th>大小</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.packageId}>
                  <td>
                    <strong>{record.title}</strong>
                    <span title={record.packageId}>{record.packageId}</span>
                  </td>
                  <td>
                    <time dateTime={record.importedAt}>{formatDateTime(record.importedAt)}</time>
                  </td>
                  <td>{record.pageCount}</td>
                  <td>{record.resourceCount}</td>
                  <td>{formatBytes(record.archiveBytes)}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button icon={Play} size="small" onClick={() => startExam(record)}>
                        开始考试
                      </Button>
                      <IconButton
                        icon={Trash2}
                        label="删除试卷"
                        disabled={importing}
                        variant="danger"
                        onClick={() => setPendingDelete(record)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除"
        message="删除后，本地保存的原始试卷包也会一并移除。此操作无法撤销。"
        open={pendingDelete !== null}
        title={`删除试卷“${pendingDelete?.title ?? ''}”？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Page>
  )
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value))
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
