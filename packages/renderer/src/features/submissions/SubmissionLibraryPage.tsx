import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type {
  SubmissionLibraryEntry,
  SubmissionLibraryRecord,
  SubmissionReport
} from '@ls101/submission-library'
import { AlertCircle, ClipboardCheck, Download, Eye, Inbox, Trash2, Upload, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Modal, ModalClose, ModalTitle } from '../../components/ui/Modal'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { SubmissionMarkdown } from './SubmissionMarkdown'
import { submissionErrorMessage, submissionExportName } from './submissionUi'
import styles from './SubmissionLibraryPage.module.css'

const SUBMISSION_FILTER = [{ name: 'LS101 作答包', extensions: ['lssubmission', 'zip'] }]

export function SubmissionLibraryPage(): JSX.Element {
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const [entries, setEntries] = useState<SubmissionLibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SubmissionLibraryRecord | null>(null)
  const [reportTarget, setReportTarget] = useState<SubmissionLibraryEntry | null>(null)
  const [report, setReport] = useState<SubmissionReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reportRequestId = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setEntries(await repository.listEntries())
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    let active = true
    void repository
      .listEntries()
      .then((items) => {
        if (active) setEntries(items)
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
      if (result.status === 'duplicate') toast.info('该作答包已经在收卷库中')
      else toast.success(`已导入 ${result.record.candidateName} 的作答包`)
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

  const viewReport = async (entry: SubmissionLibraryEntry): Promise<void> => {
    const requestId = ++reportRequestId.current
    setReportTarget(entry)
    setReport(null)
    setReportError(null)
    try {
      const next = await repository.getReport(entry.record.submissionId)
      if (reportRequestId.current === requestId) setReport(next)
    } catch (reason) {
      if (reportRequestId.current === requestId) {
        setReportError(submissionErrorMessage(reason))
      }
    }
  }

  const closeReport = (): void => {
    reportRequestId.current += 1
    setReportTarget(null)
    setReport(null)
    setReportError(null)
  }

  const pending = entries.filter((entry) => entry.grading?.status !== 'completed')
  const completed = entries.filter((entry) => entry.grading?.status === 'completed')

  return (
    <Page>
      <PageHeader
        title="作答记录"
        actions={
          <Button
            disabled={importing}
            icon={Upload}
            variant="primary"
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
      {!loading && entries.length === 0 ? <EmptyState icon={Inbox} title="暂无作答包" /> : null}
      {!loading && entries.length > 0 ? (
        <div className={styles.sections}>
          <SubmissionSection
            emptyText="没有待批改作答"
            entries={pending}
            title="未批改"
            onDelete={(record) => setPendingDelete(record)}
            onExport={(record) => void exportSubmission(record)}
            onGrade={(record) =>
              navigate(`/submissions/${encodeURIComponent(record.submissionId)}/grade`)
            }
            exportingId={exportingId}
            importing={importing}
          />
          <SubmissionSection
            completed
            emptyText="还没有已批改作答"
            entries={completed}
            title="已批改"
            onExport={(record) => void exportSubmission(record)}
            onReport={(entry) => void viewReport(entry)}
            exportingId={exportingId}
            importing={importing}
          />
        </div>
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除"
        message="删除后，本地保存的原始作答包和未完成评分都会一并移除。此操作无法撤销。"
        open={pendingDelete !== null}
        title={`删除 ${pendingDelete?.candidateName ?? ''} 的作答包？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <Modal
        open={reportTarget !== null}
        overlayClassName={styles.reportBackdrop}
        onOpenChange={closeReport}
      >
        <section className={styles.reportDialog}>
          <header className={styles.reportHeader}>
            <div>
              <ModalTitle asChild>
                <h2>考试报告</h2>
              </ModalTitle>
              <span>
                {reportTarget?.record.candidateName} · {reportTarget?.record.examTitle}
              </span>
            </div>
            <ModalClose asChild>
              <IconButton icon={X} label="关闭报告" variant="ghost" />
            </ModalClose>
          </header>
          <div className={styles.reportBody}>
            {!report && !reportError ? (
              <div className={styles.reportLoading}>正在生成报告...</div>
            ) : null}
            {reportError ? (
              <div className={styles.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{reportError}</span>
              </div>
            ) : null}
            {report ? (
              <SubmissionMarkdown content={report.markdown} resources={report.resources} />
            ) : null}
          </div>
        </section>
      </Modal>
    </Page>
  )
}

interface SubmissionSectionProps {
  title: string
  emptyText: string
  entries: SubmissionLibraryEntry[]
  completed?: boolean
  importing: boolean
  exportingId: string | null
  onGrade?(record: SubmissionLibraryRecord): void
  onReport?(entry: SubmissionLibraryEntry): void
  onExport(record: SubmissionLibraryRecord): void
  onDelete?(record: SubmissionLibraryRecord): void
}

function SubmissionSection({
  title,
  emptyText,
  entries,
  completed = false,
  importing,
  exportingId,
  onGrade,
  onReport,
  onExport,
  onDelete
}: SubmissionSectionProps): JSX.Element {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span>{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className={styles.sectionEmpty}>{emptyText}</div>
      ) : (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>考生</th>
                <th>考试</th>
                <th>提交时间</th>
                <th>{completed ? '成绩' : '进度'}</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const record = entry.record
                const grading = entry.grading
                return (
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
                      <time dateTime={record.submittedAt}>
                        {formatDateTime(record.submittedAt)}
                      </time>
                    </td>
                    <td>
                      {completed && grading
                        ? `${grading.totalScore}/${grading.maxScore}`
                        : `${grading?.gradedCount ?? 0}/${grading?.totalCount ?? record.schemaUseCount}`}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        {completed ? (
                          <Button icon={Eye} size="small" onClick={() => onReport?.(entry)}>
                            查看报告
                          </Button>
                        ) : (
                          <Button
                            icon={ClipboardCheck}
                            size="small"
                            variant="primary"
                            onClick={() => onGrade?.(record)}
                          >
                            {grading ? '继续批改' : '开始批改'}
                          </Button>
                        )}
                        <IconButton
                          disabled={exportingId !== null}
                          icon={Download}
                          label="导出作答包"
                          onClick={() => onExport(record)}
                        />
                        {!completed ? (
                          <IconButton
                            disabled={importing || exportingId !== null}
                            icon={Trash2}
                            label="删除作答包"
                            variant="danger"
                            onClick={() => onDelete?.(record)}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
