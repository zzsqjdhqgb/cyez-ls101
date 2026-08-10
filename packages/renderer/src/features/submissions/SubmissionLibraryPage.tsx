import { useCallback, useEffect, useState, type JSX } from 'react'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type { SubmissionLibraryRecord } from '@ls101/submission-library'
import { AlertCircle, Download, Inbox, Trash2, Upload } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { submissionErrorMessage, submissionExportName } from './submissionUi'
import styles from './SubmissionLibraryPage.module.css'

const SUBMISSION_FILTER = [{ name: 'LS101 作答包', extensions: ['lssubmission', 'zip'] }]

export function SubmissionLibraryPage(): JSX.Element {
  const repository = useSubmissionLibrary()
  const [records, setRecords] = useState<SubmissionLibraryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SubmissionLibraryRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRecords(await repository.listRecords())
    } catch (reason) {
      setError(submissionErrorMessage(reason))
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
        if (active) setError(submissionErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [repository])

  const importSubmission = async (): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      const selected = await fileDialog.readBinary({
        title: '导入作答包',
        filters: SUBMISSION_FILTER
      })
      if (!selected) return
      const result = await repository.importArchive(selected.data)
      await load()
      if (result.status === 'duplicate') {
        toast.info('该作答包已经在收卷库中')
      } else {
        toast.success(`已导入 ${result.record.candidateName} 的作答包`)
      }
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setImporting(false)
    }
  }

  const exportSubmission = async (record: SubmissionLibraryRecord): Promise<void> => {
    setExportingId(record.submissionId)
    setError(null)
    try {
      const data = await repository.exportArchive(record.submissionId)
      const written = await fileDialog.writeBinary(data, {
        title: '导出作答包',
        defaultName: submissionExportName(record.candidateId, record.submittedAt),
        filters: SUBMISSION_FILTER
      })
      if (written) toast.success('作答包已导出')
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setExportingId(null)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    const record = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      await repository.deleteSubmission(record.submissionId)
      await load()
      toast.success(`已删除 ${record.candidateName} 的作答包`)
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    }
  }

  return (
    <Page>
      <PageHeader
        title="收卷"
        actions={
          <Button
            icon={Upload}
            variant="primary"
            disabled={importing}
            onClick={() => void importSubmission()}
          >
            {importing ? '正在导入' : '导入作答包'}
          </Button>
        }
      />

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? <div className={styles.loading}>正在加载收卷库...</div> : null}
      {!loading && records.length === 0 ? <EmptyState icon={Inbox} title="暂无作答包" /> : null}
      {!loading && records.length > 0 ? (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>考生</th>
                <th>考试</th>
                <th>提交时间</th>
                <th>评分单元</th>
                <th>大小</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.submissionId}>
                  <td>
                    <strong>{record.candidateName}</strong>
                    <span>{record.candidateId}</span>
                  </td>
                  <td>
                    <strong>{record.examTitle}</strong>
                    <span title={record.examPackageId}>{record.examPackageId}</span>
                  </td>
                  <td>
                    <time dateTime={record.submittedAt}>{formatDateTime(record.submittedAt)}</time>
                  </td>
                  <td>{record.schemaUseCount}</td>
                  <td>{formatBytes(record.archiveBytes)}</td>
                  <td>
                    <div className={styles.actions}>
                      <IconButton
                        icon={Download}
                        label="导出作答包"
                        disabled={exportingId !== null}
                        onClick={() => void exportSubmission(record)}
                      />
                      <IconButton
                        icon={Trash2}
                        label="删除作答包"
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
        message="删除后，本地保存的原始作答包也会一并移除。此操作无法撤销。"
        open={pendingDelete !== null}
        title={`删除 ${pendingDelete?.candidateName ?? ''} 的作答包？`}
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
