import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ReportExportItem, ReportExportProgress } from '@ls101/core-types'
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
  FileDown,
  Inbox,
  Play,
  RotateCcw,
  SearchX,
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
import { SettledRecordFilterBar, type SettledViewMode } from './SettledRecordFilterBar'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { SubmissionMarkdown } from './SubmissionMarkdown'
import { buildSubmissionReportDocument, submissionReportFileName } from './submissionReportDocument'
import { submissionErrorMessage, submissionExportName } from './submissionUi'
import {
  DEFAULT_SETTLED_FILTERS,
  buildSettledRecords,
  filterSettledRecords,
  formatSettledScore,
  groupSettledRecords,
  hasActiveSettledFilters,
  removeSettledFilterChip,
  settledBatchOptions,
  settledExamOptions,
  settledFilterChips,
  sortSettledRecords,
  summarizeSettledRecords,
  type SettledBatchGroup,
  type SettledFilterChipKey,
  type SettledFilters,
  type SettledRecord
} from './settledRecords'
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
  const [collapsedBatchIds, setCollapsedBatchIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [exportingBatchId, setExportingBatchId] = useState<string | null>(null)
  const [exportingReportId, setExportingReportId] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<ReportExportProgress | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SubmissionLibraryEntry | null>(null)
  const [pendingReset, setPendingReset] = useState<SubmissionLibraryEntry | null>(null)
  const [reportTarget, setReportTarget] = useState<SubmissionLibraryEntry | null>(null)
  const [report, setReport] = useState<SubmissionReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<SettledFilters>(DEFAULT_SETTLED_FILTERS)
  const [settledView, setSettledView] = useState<SettledViewMode>('grouped')
  const [exportingFiltered, setExportingFiltered] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const reportRequestId = useRef(0)
  const loadRequestId = useRef(0)
  // loading/refreshing 按“在途请求数”收敛，避免旧请求 finally 被跳过导致标志永久卡住。
  const pendingFullLoads = useRef(0)
  const pendingSilentLoads = useRef(0)
  // 任一导出进行中都禁用其它导出入口与刷新，避免共享的导出进度/保存对话框叠加。
  const exportingAny =
    exportingFiltered ||
    exportingBatchId !== null ||
    exportingReportId !== null ||
    exportingId !== null

  const load = useCallback(
    async (silent = false): Promise<void> => {
      const requestId = ++loadRequestId.current
      if (silent) {
        pendingSilentLoads.current += 1
        setRefreshing(true)
      } else {
        pendingFullLoads.current += 1
        setLoading(true)
      }
      setError(null)
      try {
        const [nextEntries, nextBatches] = await Promise.all([
          repository.listEntries(),
          repository.listSettlementBatches()
        ])
        // 后发起的加载（如刷新）可能先返回；旧响应必须整体丢弃，不能覆盖最新状态。
        if (loadRequestId.current !== requestId) return
        setEntries(nextEntries)
        setBatches(nextBatches)
        setSelectedIds((current) => {
          const available = new Set(
            nextEntries
              .filter((entry) => !entry.settlement)
              .map((entry) => entry.record.submissionId)
          )
          return new Set([...current].filter((submissionId) => available.has(submissionId)))
        })
        setFilters((current) => {
          if (current.batchIds.length === 0) return current
          const available = new Set(nextBatches.map((batch) => batch.batchId))
          const kept = current.batchIds.filter((batchId) => available.has(batchId))
          return kept.length === current.batchIds.length ? current : { ...current, batchIds: kept }
        })
      } catch (reason) {
        if (loadRequestId.current === requestId) setError(submissionErrorMessage(reason))
      } finally {
        // 无论请求是否已过期（数据被丢弃），都必须归还自己占用的在途计数。
        if (silent) {
          pendingSilentLoads.current -= 1
          setRefreshing(pendingSilentLoads.current > 0)
        } else {
          pendingFullLoads.current -= 1
          setLoading(pendingFullLoads.current > 0)
        }
      }
    },
    [repository]
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const unsettled = useMemo(() => entries.filter((entry) => !entry.settlement), [entries])
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.record.submissionId, entry])),
    [entries]
  )
  const settledRecords = useMemo(() => buildSettledRecords(entries, batches), [entries, batches])
  const filteredRecords = useMemo(
    () => filterSettledRecords(settledRecords, filters),
    [settledRecords, filters]
  )
  const settledSummary = useMemo(() => summarizeSettledRecords(filteredRecords), [filteredRecords])
  const settledBatchOptionsValue = useMemo(
    () => settledBatchOptions(settledRecords),
    [settledRecords]
  )
  const settledExamOptionsValue = useMemo(
    () => settledExamOptions(settledRecords),
    [settledRecords]
  )
  const settledChips = useMemo(
    () => settledFilterChips(settledRecords, filters),
    [settledRecords, filters]
  )
  const filteringSettled = hasActiveSettledFilters(filters)
  const settledGroups = useMemo(
    () => groupSettledRecords(filteredRecords, filters.sort),
    [filteredRecords, filters.sort]
  )
  const flatSettledRecords = useMemo(
    () => sortSettledRecords(filteredRecords, filters.sort),
    [filteredRecords, filters.sort]
  )
  const filteredBatchIds = useMemo(
    () => settledGroups.map((group) => group.batch.batchId),
    [settledGroups]
  )
  /**
   * 筛选激活时命中的批次默认展开；用户仍可逐批收起。
   * 用渲染期派生的集合代替 effect 里 setState，避免级联渲染。
   */
  const visibleExpandedBatchIds = useMemo(() => {
    if (!filteringSettled) return expandedBatchIds
    return new Set(filteredBatchIds.filter((batchId) => !collapsedBatchIds.has(batchId)))
  }, [collapsedBatchIds, expandedBatchIds, filteredBatchIds, filteringSettled])
  const allGroupsExpanded =
    filteredBatchIds.length > 0 &&
    filteredBatchIds.every((batchId) => visibleExpandedBatchIds.has(batchId))

  const importSubmission = async (): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      const selected = await fileDialog.readBinary({
        title: '导入作答包或批量压缩包',
        filters: SUBMISSION_FILTER
      })
      if (!selected) return
      const result = await repository.importArchive(selected.data)
      await load()
      const created = result.items.filter((item) => item.status === 'created').length
      const duplicates = result.items.length - created
      if (result.kind === 'bundle') {
        if (created === 0) toast.info(`${duplicates} 份作答包都已经在作答记录中`)
        else if (duplicates === 0) toast.success(`已导入 ${created} 份作答包`)
        else toast.success(`已导入 ${created} 份作答包，${duplicates} 份已存在`)
      } else if (created === 0) {
        toast.info('该作答包已经在作答记录中')
      } else {
        toast.success(`已导入 ${result.items[0].record.candidateName} 的作答包`)
      }
    } catch (reason) {
      // 批量导入可能已经写入前面的成员，失败后仍刷新列表。
      await load()
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

  const exportBatchReports = async (batch: SubmissionSettlementBatch): Promise<void> => {
    const bridge = window.reportExport
    if (!bridge) {
      setError('报告导出不可用，请重启应用后重试。')
      return
    }
    setError(null)
    setExportingBatchId(batch.batchId)
    setExportProgress(null)
    const unsubscribe = bridge.onProgress(setExportProgress)
    try {
      const items: ReportExportItem[] = []
      for (const record of batch.records) {
        const entry = entriesById.get(record.submissionId)
        if (!entry) continue
        const report = await repository.getReport(record.submissionId)
        items.push({
          filename: submissionReportFileName(entry.record),
          html: buildSubmissionReportDocument(report)
        })
      }
      if (items.length === 0) {
        toast.info('该批次没有可导出的报告')
        return
      }

      const result = await bridge.exportBatch({ items })
      if (result.status === 'cancelled') return
      if (result.failures.length > 0) {
        toast.error(`已导出 ${result.exportedCount} 份，${result.failures.length} 份失败`)
        setError(
          `以下报告导出失败：${result.failures
            .map((failure) => `${failure.filename}（${failure.reason}）`)
            .join('；')}`
        )
      } else {
        toast.success(`已导出 ${result.exportedCount} 份作答报告`)
      }
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      unsubscribe()
      setExportingBatchId(null)
      setExportProgress(null)
    }
  }

  const exportFilteredReports = async (): Promise<void> => {
    const bridge = window.reportExport
    if (!bridge) {
      setError('报告导出不可用，请重启应用后重试。')
      return
    }
    if (filteredRecords.length === 0) return
    setError(null)
    setExportingFiltered(true)
    setExportProgress(null)
    const unsubscribe = bridge.onProgress(setExportProgress)
    try {
      const items: ReportExportItem[] = []
      for (const settledRecord of sortSettledRecords(filteredRecords, filters.sort)) {
        const report = await repository.getReport(settledRecord.submissionId)
        items.push({
          filename: submissionReportFileName(settledRecord.entry.record),
          html: buildSubmissionReportDocument(report)
        })
      }
      const result = await bridge.exportBatch({ items })
      if (result.status === 'cancelled') return
      if (result.failures.length > 0) {
        toast.error(`已导出 ${result.exportedCount} 份，${result.failures.length} 份失败`)
        setError(
          `以下报告导出失败：${result.failures
            .map((failure) => `${failure.filename}（${failure.reason}）`)
            .join('；')}`
        )
      } else {
        toast.success(`已导出 ${result.exportedCount} 份作答报告`)
      }
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      unsubscribe()
      setExportingFiltered(false)
      setExportProgress(null)
    }
  }

  const exportEntryReport = async (entry: SubmissionLibraryEntry): Promise<void> => {
    const bridge = window.reportExport
    if (!bridge) {
      setError('报告导出不可用，请重启应用后重试。')
      return
    }
    setError(null)
    setExportingReportId(entry.record.submissionId)
    try {
      const report = await repository.getReport(entry.record.submissionId)
      const result = await bridge.exportSingle({
        filename: submissionReportFileName(entry.record),
        html: buildSubmissionReportDocument(report)
      })
      if (result.status === 'cancelled') return
      if (result.status === 'failed') {
        setError(`报告导出失败：${result.reason}`)
        return
      }
      toast.success('作答报告已导出')
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setExportingReportId(null)
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

  const resetCollapsedBatches = (): void => {
    setCollapsedBatchIds((current) => (current.size === 0 ? current : new Set()))
  }

  const changeFilters = (next: Partial<SettledFilters>): void => {
    resetCollapsedBatches()
    setFilters((current) => ({ ...current, ...next }))
  }

  const removeChip = (key: SettledFilterChipKey): void => {
    resetCollapsedBatches()
    setFilters((current) => removeSettledFilterChip(current, key))
  }

  const clearFilters = (): void => {
    resetCollapsedBatches()
    setFilters(DEFAULT_SETTLED_FILTERS)
  }

  const toggleExpandAll = (): void => {
    if (allGroupsExpanded) {
      if (filteringSettled) setCollapsedBatchIds(new Set(filteredBatchIds))
      else setExpandedBatchIds(new Set())
      return
    }
    setCollapsedBatchIds(new Set())
    if (!filteringSettled) setExpandedBatchIds(new Set(filteredBatchIds))
  }

  const toggleExpandedBatch = (batchId: string): void => {
    if (filteringSettled) {
      const currentlyExpanded = visibleExpandedBatchIds.has(batchId)
      setCollapsedBatchIds((current) => {
        const next = new Set(current)
        if (currentlyExpanded) next.add(batchId)
        else next.delete(batchId)
        return next
      })
      return
    }
    setExpandedBatchIds((current) => {
      const next = new Set(current)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
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
        settledRecords.length === 0 ? (
          <EmptyState icon={Inbox} title="还没有已结算作答" />
        ) : (
          <>
            <SettledRecordFilterBar
              allExpanded={allGroupsExpanded}
              batches={settledBatchOptionsValue}
              chips={settledChips}
              exams={settledExamOptionsValue}
              exportProgress={exportProgress}
              exporting={exportingAny}
              exportingFiltered={exportingFiltered}
              filters={filters}
              refreshing={refreshing}
              summary={settledSummary}
              totalCount={settledRecords.length}
              viewMode={settledView}
              onChange={changeFilters}
              onClearFilters={clearFilters}
              onExportFiltered={() => void exportFilteredReports()}
              onRefresh={() => void load(true)}
              onRemoveChip={removeChip}
              onToggleExpandAll={toggleExpandAll}
              onViewModeChange={setSettledView}
            />
            {filteringSettled && filteredRecords.length === 0 ? (
              <div className={styles.filterEmpty} aria-label="筛选结果为空">
                <SearchX aria-hidden="true" />
                <p>没有符合条件的已结算作答。</p>
                <Button icon={X} size="small" variant="secondary" onClick={clearFilters}>
                  清除全部筛选
                </Button>
              </div>
            ) : settledView === 'flat' ? (
              <SettledRecordTable
                entries={flatSettledRecords}
                exporting={exportingAny}
                onDelete={setPendingDelete}
                onExport={(record) => void exportSubmission(record)}
                onExportReport={(entry) => void exportEntryReport(entry)}
                onReport={(entry) => void viewReport(entry)}
                onReset={setPendingReset}
              />
            ) : (
              <SettledBatches
                expandedBatchIds={visibleExpandedBatchIds}
                exporting={exportingAny}
                exportingBatchId={exportingBatchId}
                exportProgress={exportProgress}
                filtering={filteringSettled}
                groups={settledGroups}
                onDelete={setPendingDelete}
                onExport={(record) => void exportSubmission(record)}
                onExportBatch={(batch) => void exportBatchReports(batch)}
                onExportReport={(entry) => void exportEntryReport(entry)}
                onReport={(entry) => void viewReport(entry)}
                onReset={setPendingReset}
                onToggle={toggleExpandedBatch}
              />
            )}
          </>
        )
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
  groups,
  expandedBatchIds,
  exporting,
  exportingBatchId,
  exportProgress,
  filtering,
  onToggle,
  onReport,
  onReset,
  onExport,
  onExportBatch,
  onExportReport,
  onDelete
}: {
  groups: readonly SettledBatchGroup[]
  expandedBatchIds: Set<string>
  exporting: boolean
  exportingBatchId: string | null
  exportProgress: ReportExportProgress | null
  filtering: boolean
  onToggle(batchId: string): void
  onReport(entry: SubmissionLibraryEntry): void
  onReset(entry: SubmissionLibraryEntry): void
  onExport(record: SubmissionLibraryRecord): void
  onExportBatch(batch: SubmissionSettlementBatch): void
  onExportReport(entry: SubmissionLibraryEntry): void
  onDelete(entry: SubmissionLibraryEntry): void
}): JSX.Element {
  return (
    <div className={styles.batchList}>
      {groups.map((group) => {
        const expanded = expandedBatchIds.has(group.batch.batchId)
        const hiddenCount = group.batch.records.length - group.records.length
        return (
          <section
            className={styles.batch}
            key={group.batch.batchId}
            data-expanded={expanded || undefined}
          >
            <button
              aria-expanded={expanded}
              className={styles.batchHeader}
              type="button"
              onClick={() => onToggle(group.batch.batchId)}
            >
              {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              <span>
                <strong>结算于 {formatDateTime(group.batch.settledAt)}</strong>
                <small>
                  {filtering && hiddenCount > 0
                    ? `命中 ${group.records.length}/${group.batch.records.length} 条作答`
                    : `${group.batch.records.length} 条作答`}
                </small>
              </span>
              <span className={styles.batchNumber}>批次 {group.batchNumber}</span>
            </button>
            {expanded ? (
              <div className={styles.batchBody}>
                <div className={styles.batchToolbar}>
                  <Button
                    disabled={exporting}
                    icon={FileDown}
                    size="small"
                    variant="secondary"
                    onClick={() => onExportBatch(group.batch)}
                  >
                    {exportingBatchId === group.batch.batchId ? '正在生成报告' : '导出批次报告'}
                  </Button>
                  <span className={styles.batchHint}>
                    {exportingBatchId === group.batch.batchId
                      ? exportProgress
                        ? `${exportProgress.completed}/${exportProgress.total}${
                            exportProgress.current ? ` · ${exportProgress.current}` : ''
                          }`
                        : '正在准备报告...'
                      : filtering
                        ? `筛选命中本批次 ${group.records.length} 份，整批导出`
                        : 'ZIP，每份作答一个 PDF'}
                  </span>
                </div>
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
                    {group.records.map((record) => (
                      <tr key={record.submissionId}>
                        <td>
                          <strong>{record.entry.record.candidateName}</strong>
                          <span>{displayCandidateId(record.entry.record.candidateId)}</span>
                        </td>
                        <td>{record.entry.record.examTitle}</td>
                        <td>
                          <strong>{formatSettledScore(record)}</strong>
                        </td>
                        <td>{formatDateTime(record.entry.record.submittedAt)}</td>
                        <td>
                          <SettledEntryActions
                            entry={record.entry}
                            exporting={exporting}
                            onDelete={onDelete}
                            onExport={onExport}
                            onExportReport={onExportReport}
                            onReport={onReport}
                            onReset={onReset}
                          />
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

function SettledRecordTable({
  entries,
  exporting,
  onReport,
  onReset,
  onExport,
  onExportReport,
  onDelete
}: {
  entries: readonly SettledRecord[]
  exporting: boolean
  onReport(entry: SubmissionLibraryEntry): void
  onReset(entry: SubmissionLibraryEntry): void
  onExport(record: SubmissionLibraryRecord): void
  onExportReport(entry: SubmissionLibraryEntry): void
  onDelete(entry: SubmissionLibraryEntry): void
}): JSX.Element {
  return (
    <div className={`${styles.tableFrame} ${styles.settledTableFrame}`}>
      <table className={`${styles.batchTable} ${styles.flatTable}`}>
        <thead>
          <tr>
            <th>作答人</th>
            <th>试卷</th>
            <th>结算时间</th>
            <th>得分</th>
            <th>作答时间</th>
            <th aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {entries.map((record) => (
            <tr key={record.submissionId}>
              <td>
                <strong>{record.entry.record.candidateName}</strong>
                <span>{displayCandidateId(record.entry.record.candidateId)}</span>
              </td>
              <td>{record.entry.record.examTitle}</td>
              <td>
                <strong>批次 {record.batchNumber}</strong>
                <span>结算于 {formatDateTime(record.batch.settledAt)}</span>
              </td>
              <td>
                <strong>{formatSettledScore(record)}</strong>
              </td>
              <td>{formatDateTime(record.entry.record.submittedAt)}</td>
              <td>
                <SettledEntryActions
                  entry={record.entry}
                  exporting={exporting}
                  onDelete={onDelete}
                  onExport={onExport}
                  onExportReport={onExportReport}
                  onReport={onReport}
                  onReset={onReset}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SettledEntryActions({
  entry,
  exporting,
  onReport,
  onReset,
  onExport,
  onExportReport,
  onDelete
}: {
  entry: SubmissionLibraryEntry
  exporting: boolean
  onReport(entry: SubmissionLibraryEntry): void
  onReset(entry: SubmissionLibraryEntry): void
  onExport(record: SubmissionLibraryRecord): void
  onExportReport(entry: SubmissionLibraryEntry): void
  onDelete(entry: SubmissionLibraryEntry): void
}): JSX.Element {
  return (
    <div className={styles.actions}>
      <Button icon={Eye} size="small" variant="secondary" onClick={() => onReport(entry)}>
        查看报告
      </Button>
      <IconButton icon={RotateCcw} label="重新评分" onClick={() => onReset(entry)} />
      <IconButton
        disabled={exporting}
        icon={FileDown}
        label="导出报告"
        onClick={() => onExportReport(entry)}
      />
      <IconButton
        disabled={exporting}
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
