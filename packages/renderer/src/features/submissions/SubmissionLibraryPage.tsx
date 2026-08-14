import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type {
  SubmissionLibraryEntry,
  SubmissionLibraryRecord,
  SubmissionReport,
  SubmissionSettlementBatch
} from '@ls101/submission-library'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  Inbox,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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

type LibraryView = 'unsettled' | 'settled'

export function SubmissionLibraryPage(): JSX.Element {
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: LibraryView = searchParams.get('view') === 'settled' ? 'settled' : 'unsettled'
  const highlightedBatchId = searchParams.get('batchId')
  const [entries, setEntries] = useState<SubmissionLibraryEntry[]>([])
  const [batches, setBatches] = useState<SubmissionSettlementBatch[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(
    () => new Set(highlightedBatchId ? [highlightedBatchId] : [])
  )
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SubmissionLibraryEntry | null>(null)
  const [pendingReset, setPendingReset] = useState<SubmissionLibraryEntry | null>(null)
  const [reportTarget, setReportTarget] = useState<SubmissionLibraryEntry | null>(null)
  const [report, setReport] = useState<SubmissionReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reportRequestId = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [nextEntries, nextBatches] = await Promise.all([
        repository.listEntries(),
        repository.listSettlementBatches()
      ])
      setEntries(nextEntries)
      setBatches(nextBatches)
      setSelectedIds((current) => {
        const available = new Set(
          nextEntries.filter((entry) => !entry.settlement).map((entry) => entry.record.submissionId)
        )
        return new Set([...current].filter((submissionId) => available.has(submissionId)))
      })
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const unsettled = useMemo(() => entries.filter((entry) => !entry.settlement), [entries])
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.record.submissionId, entry])),
    [entries]
  )

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
      if (result.status === 'duplicate') toast.info('该作答包已经在作答记录中')
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
    const target = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      await repository.deleteSubmission(target.record.submissionId)
      await load()
      toast.success(`已删除 ${target.record.candidateName} 的作答记录`)
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    }
  }

  const confirmReset = async (): Promise<void> => {
    if (!pendingReset) return
    const target = pendingReset
    setPendingReset(null)
    setError(null)
    try {
      await repository.resetGrading(target.record.submissionId)
      await load()
      setSearchParams({ view: 'unsettled' })
      toast.success(`已将 ${target.record.candidateName} 的作答移回未评分列表`)
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
      if (reportRequestId.current === requestId) setReportError(submissionErrorMessage(reason))
    }
  }

  const closeReport = (): void => {
    reportRequestId.current += 1
    setReportTarget(null)
    setReport(null)
    setReportError(null)
  }

  const switchView = (next: LibraryView): void => {
    setSearchParams({ view: next })
  }

  const toggleSelected = (submissionId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(submissionId)) next.delete(submissionId)
      else next.add(submissionId)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelectedIds((current) =>
      current.size === unsettled.length && unsettled.length > 0
        ? new Set()
        : new Set(unsettled.map((entry) => entry.record.submissionId))
    )
  }

  const startGrading = (submissionIds: readonly string[]): void => {
    navigate(gradingSessionUrl(submissionIds))
  }

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

      <div className={styles.tabs} role="tablist" aria-label="作答记录状态">
        <button
          aria-selected={view === 'unsettled'}
          role="tab"
          type="button"
          onClick={() => switchView('unsettled')}
        >
          未结算 <span>{unsettled.length}</span>
        </button>
        <button
          aria-selected={view === 'settled'}
          role="tab"
          type="button"
          onClick={() => switchView('settled')}
        >
          已结算 <span>{entries.length - unsettled.length}</span>
        </button>
      </div>

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? <div className={styles.loading}>正在加载作答记录...</div> : null}
      {!loading && view === 'unsettled' ? (
        <UnsettledList
          entries={unsettled}
          exportingId={exportingId}
          selectedIds={selectedIds}
          onDelete={setPendingDelete}
          onExport={(record) => void exportSubmission(record)}
          onGrade={(entry) => startGrading([entry.record.submissionId])}
          onGradeSelected={() => startGrading([...selectedIds])}
          onToggle={toggleSelected}
          onToggleAll={toggleAll}
        />
      ) : null}
      {!loading && view === 'settled' ? (
        <SettledBatches
          batches={batches}
          entriesById={entriesById}
          expandedBatchIds={expandedBatchIds}
          exportingId={exportingId}
          onDelete={setPendingDelete}
          onExport={(record) => void exportSubmission(record)}
          onReport={(entry) => void viewReport(entry)}
          onReset={setPendingReset}
          onToggle={(batchId) =>
            setExpandedBatchIds((current) => {
              const next = new Set(current)
              if (next.has(batchId)) next.delete(batchId)
              else next.add(batchId)
              return next
            })
          }
        />
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除"
        message={
          pendingDelete?.settlement
            ? '删除后，原始作答包、评分结果和报告都会被移除。此操作无法撤销。'
            : '删除后，原始作答包和已有评分进度都会被移除。此操作无法撤销。'
        }
        open={pendingDelete !== null}
        title={`删除 ${pendingDelete?.record.candidateName ?? ''} 的作答记录？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      <ConfirmModal
        danger
        confirmLabel="删除评分并重新开始"
        message="现有评分、结算结果和报告将被删除，原始作答会作为未评分记录重新加入未结算列表。"
        open={pendingReset !== null}
        title={`重新评分 ${pendingReset?.record.candidateName ?? ''} 的作答？`}
        onCancel={() => setPendingReset(null)}
        onConfirm={() => void confirmReset()}
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
                <h2>评分报告</h2>
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

function UnsettledList({
  entries,
  selectedIds,
  exportingId,
  onToggle,
  onToggleAll,
  onGrade,
  onGradeSelected,
  onExport,
  onDelete
}: {
  entries: SubmissionLibraryEntry[]
  selectedIds: Set<string>
  exportingId: string | null
  onToggle(submissionId: string): void
  onToggleAll(): void
  onGrade(entry: SubmissionLibraryEntry): void
  onGradeSelected(): void
  onExport(record: SubmissionLibraryRecord): void
  onDelete(entry: SubmissionLibraryEntry): void
}): JSX.Element {
  if (entries.length === 0) return <EmptyState icon={Inbox} title="没有未结算作答" />
  return (
    <section aria-label="未结算作答">
      <div className={styles.selectionBar}>
        <label>
          <input
            checked={selectedIds.size === entries.length}
            type="checkbox"
            onChange={onToggleAll}
          />
          <span>全选</span>
        </label>
        <span>已选择 {selectedIds.size} 条</span>
        <Button
          disabled={selectedIds.size === 0}
          icon={Play}
          size="small"
          variant="primary"
          onClick={onGradeSelected}
        >
          开始评分（{selectedIds.size}）
        </Button>
      </div>
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th aria-label="选择" />
              <th>作答人</th>
              <th>试卷</th>
              <th>作答时间</th>
              <th>评分进度</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const { record, grading } = entry
              return (
                <tr key={record.submissionId}>
                  <td>
                    <input
                      aria-label={`选择 ${record.candidateName} 的作答`}
                      checked={selectedIds.has(record.submissionId)}
                      type="checkbox"
                      onChange={() => onToggle(record.submissionId)}
                    />
                  </td>
                  <td>
                    <strong>{record.candidateName}</strong>
                    <span>{displayCandidateId(record.candidateId)}</span>
                  </td>
                  <td>{record.examTitle}</td>
                  <td>{formatDateTime(record.submittedAt)}</td>
                  <td>
                    <strong className={grading?.status === 'ready' ? styles.ready : undefined}>
                      {gradingStatus(entry)}
                    </strong>
                    <span>
                      {grading
                        ? `${grading.gradedCount}/${grading.totalCount} 个评分单元`
                        : '尚未开始'}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <Button
                        icon={Play}
                        size="small"
                        variant="primary"
                        onClick={() => onGrade(entry)}
                      >
                        {grading?.status === 'ready'
                          ? '进入结算'
                          : grading
                            ? '继续评分'
                            : '开始评分'}
                      </Button>
                      <IconButton
                        disabled={exportingId !== null}
                        icon={Download}
                        label="导出作答包"
                        onClick={() => onExport(record)}
                      />
                      <IconButton
                        icon={Trash2}
                        label="删除作答记录"
                        variant="danger"
                        onClick={() => onDelete(entry)}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SettledBatches({
  batches,
  entriesById,
  expandedBatchIds,
  exportingId,
  onToggle,
  onReport,
  onReset,
  onExport,
  onDelete
}: {
  batches: SubmissionSettlementBatch[]
  entriesById: Map<string, SubmissionLibraryEntry>
  expandedBatchIds: Set<string>
  exportingId: string | null
  onToggle(batchId: string): void
  onReport(entry: SubmissionLibraryEntry): void
  onReset(entry: SubmissionLibraryEntry): void
  onExport(record: SubmissionLibraryRecord): void
  onDelete(entry: SubmissionLibraryEntry): void
}): JSX.Element {
  if (batches.length === 0) return <EmptyState icon={Inbox} title="还没有已结算作答" />
  return (
    <div className={styles.batchList}>
      {batches.map((batch) => {
        const expanded = expandedBatchIds.has(batch.batchId)
        const batchEntries = batch.records.flatMap((record) => {
          const entry = entriesById.get(record.submissionId)
          return entry ? [entry] : []
        })
        return (
          <section
            className={styles.batch}
            key={batch.batchId}
            data-expanded={expanded || undefined}
          >
            <button
              aria-expanded={expanded}
              className={styles.batchHeader}
              type="button"
              onClick={() => onToggle(batch.batchId)}
            >
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              <span>
                <strong>结算于 {formatDateTime(batch.settledAt)}</strong>
                <small>{batch.records.length} 条作答</small>
              </span>
              <code>{batch.batchId.slice(0, 8)}</code>
            </button>
            {expanded ? (
              <div className={styles.batchBody}>
                <table className={styles.batchTable}>
                  <thead>
                    <tr>
                      <th>作答人</th>
                      <th>试卷</th>
                      <th>分数</th>
                      <th>作答时间</th>
                      <th aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {batchEntries.map((entry) => (
                      <tr key={entry.record.submissionId}>
                        <td>
                          <strong>{entry.record.candidateName}</strong>
                          <span>{displayCandidateId(entry.record.candidateId)}</span>
                        </td>
                        <td>{entry.record.examTitle}</td>
                        <td>
                          <strong>
                            {entry.grading
                              ? `${entry.grading.totalScore}/${entry.grading.maxScore}`
                              : '-'}
                          </strong>
                        </td>
                        <td>{formatDateTime(entry.record.submittedAt)}</td>
                        <td>
                          <div className={styles.actions}>
                            <Button
                              icon={Eye}
                              size="small"
                              variant="secondary"
                              onClick={() => onReport(entry)}
                            >
                              查看报告
                            </Button>
                            <IconButton
                              icon={RotateCcw}
                              label="重新评分"
                              onClick={() => onReset(entry)}
                            />
                            <IconButton
                              disabled={exportingId !== null}
                              icon={Download}
                              label="导出作答包"
                              onClick={() => onExport(entry.record)}
                            />
                            <IconButton
                              icon={Trash2}
                              label="删除作答记录"
                              variant="danger"
                              onClick={() => onDelete(entry)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function gradingSessionUrl(submissionIds: readonly string[]): string {
  const params = new URLSearchParams()
  submissionIds.forEach((submissionId) => params.append('submissionId', submissionId))
  return `/submissions/grading?${params.toString()}`
}

function gradingStatus(entry: SubmissionLibraryEntry): string {
  if (!entry.grading) return '未评分'
  return entry.grading.status === 'ready' ? '可结算' : '评分中'
}

function displayCandidateId(candidateId: string): string {
  return candidateId.startsWith('auto:') ? '考生号未填写' : candidateId
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
