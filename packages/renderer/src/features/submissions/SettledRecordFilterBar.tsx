import { useEffect, useRef, useState, type JSX } from 'react'
import type { ReportExportProgress } from '@ls101/core-types'
import { ChevronDown, FileDown, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import {
  SETTLED_SORT_OPTIONS,
  SETTLEMENT_DATE_PRESET_OPTIONS,
  type SettledBatchOption,
  type SettledFilterChip,
  type SettledFilterChipKey,
  type SettlementDatePreset,
  type SettledFilters,
  type SettledSort,
  type SettledSummary
} from './settledRecords'
import styles from './SubmissionLibraryPage.module.css'

export type SettledViewMode = 'grouped' | 'flat'

interface SettledRecordFilterBarProps {
  batches: readonly SettledBatchOption[]
  exams: readonly string[]
  filters: SettledFilters
  chips: readonly SettledFilterChip[]
  summary: SettledSummary
  totalCount: number
  viewMode: SettledViewMode
  allExpanded: boolean
  exporting: boolean
  exportProgress: ReportExportProgress | null
  refreshing: boolean
  onChange(next: Partial<SettledFilters>): void
  onRemoveChip(key: SettledFilterChipKey): void
  onClearFilters(): void
  onViewModeChange(mode: SettledViewMode): void
  onToggleExpandAll(): void
  onExportFiltered(): void
  onRefresh(): void
}

export function SettledRecordFilterBar({
  batches,
  exams,
  filters,
  chips,
  summary,
  totalCount,
  viewMode,
  allExpanded,
  exporting,
  exportProgress,
  refreshing,
  onChange,
  onRemoveChip,
  onClearFilters,
  onViewModeChange,
  onToggleExpandAll,
  onExportFiltered,
  onRefresh
}: SettledRecordFilterBarProps): JSX.Element {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const keyword = filters.keyword

  const changeSettlementPreset = (preset: SettlementDatePreset): void => {
    if (preset === 'custom') {
      setAdvancedOpen(true)
      onChange({ settlementPreset: 'custom' })
      return
    }
    onChange({ settlementPreset: preset, settlementFrom: '', settlementTo: '' })
  }

  const changeSettlementFrom = (value: string): void => {
    onChange({ settlementPreset: 'custom', settlementFrom: value })
  }

  const changeSettlementTo = (value: string): void => {
    onChange({ settlementPreset: 'custom', settlementTo: value })
  }

  return (
    <section className={styles.filterPanel} aria-label="已结算筛选">
      <div className={styles.filterPrimary}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <input
            aria-label="搜索已结算作答"
            placeholder="搜索姓名、考生号、试卷或批次"
            type="search"
            value={keyword}
            onChange={(event) => onChange({ keyword: event.target.value })}
          />
          {keyword !== '' ? (
            <button
              aria-label="清除搜索"
              className={styles.searchClear}
              type="button"
              onClick={() => onChange({ keyword: '' })}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>结算日期</span>
          <select
            aria-label="结算日期筛选"
            value={filters.settlementPreset}
            onChange={(event) => changeSettlementPreset(event.target.value as SettlementDatePreset)}
          >
            {SETTLEMENT_DATE_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <BatchFilter
          batches={batches}
          selected={filters.batchIds}
          onChange={(batchIds) => onChange({ batchIds })}
        />

        <label className={styles.filterField}>
          <span className={styles.filterLabel}>试卷</span>
          <select
            aria-label="试卷筛选"
            value={filters.examTitle}
            onChange={(event) => onChange({ examTitle: event.target.value })}
          >
            <option value="">全部试卷</option>
            {exams.map((examTitle) => (
              <option key={examTitle} value={examTitle}>
                {examTitle}
              </option>
            ))}
          </select>
        </label>

        <Button
          aria-expanded={advancedOpen}
          className={styles.advancedToggle}
          icon={SlidersHorizontal}
          size="small"
          variant="secondary"
          onClick={() => setAdvancedOpen((current) => !current)}
        >
          {advancedOpen ? '收起筛选' : '更多筛选'}
        </Button>
      </div>

      {advancedOpen ? (
        <div className={styles.filterAdvanced} aria-label="更多筛选条件">
          <fieldset className={styles.advancedGroup}>
            <legend>结算日期范围</legend>
            <div className={styles.dateRange}>
              <input
                aria-label="结算开始日期"
                type="date"
                value={filters.settlementFrom}
                onChange={(event) => changeSettlementFrom(event.target.value)}
              />
              <span aria-hidden="true">—</span>
              <input
                aria-label="结算结束日期"
                type="date"
                value={filters.settlementTo}
                onChange={(event) => changeSettlementTo(event.target.value)}
              />
            </div>
          </fieldset>
          <fieldset className={styles.advancedGroup}>
            <legend>作答日期范围</legend>
            <div className={styles.dateRange}>
              <input
                aria-label="作答开始日期"
                type="date"
                value={filters.submittedFrom}
                onChange={(event) => onChange({ submittedFrom: event.target.value })}
              />
              <span aria-hidden="true">—</span>
              <input
                aria-label="作答结束日期"
                type="date"
                value={filters.submittedTo}
                onChange={(event) => onChange({ submittedTo: event.target.value })}
              />
            </div>
          </fieldset>
          <fieldset className={styles.advancedGroup}>
            <legend>分数区间</legend>
            <div className={styles.dateRange}>
              <input
                aria-label="最低分"
                min={0}
                placeholder="不限"
                step="any"
                type="number"
                value={filters.minScore}
                onChange={(event) => onChange({ minScore: event.target.value })}
              />
              <span aria-hidden="true">—</span>
              <input
                aria-label="最高分"
                min={0}
                placeholder="不限"
                step="any"
                type="number"
                value={filters.maxScore}
                onChange={(event) => onChange({ maxScore: event.target.value })}
              />
            </div>
          </fieldset>
        </div>
      ) : null}

      {chips.length > 0 ? (
        <div className={styles.filterChips} aria-label="已启用的筛选条件">
          {chips.map((chip) => (
            <span className={styles.filterChip} key={chip.key}>
              {chip.label}
              <button
                aria-label={`移除筛选条件：${chip.label}`}
                className={styles.filterChipRemove}
                type="button"
                onClick={() => onRemoveChip(chip.key)}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
          <button className={styles.clearFilters} type="button" onClick={onClearFilters}>
            清除全部筛选
          </button>
        </div>
      ) : null}

      <div className={styles.resultBar}>
        <p aria-live="polite" className={styles.resultSummary}>
          {resultSummaryText(totalCount, summary)}
        </p>
        <div className={styles.resultActions}>
          <label className={styles.sortField}>
            <span className={styles.filterLabel}>排序</span>
            <select
              aria-label="排序方式"
              value={filters.sort}
              onChange={(event) => onChange({ sort: event.target.value as SettledSort })}
            >
              {SETTLED_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.viewToggle} role="group" aria-label="显示方式">
            <button
              aria-pressed={viewMode === 'grouped'}
              type="button"
              onClick={() => onViewModeChange('grouped')}
            >
              分组显示
            </button>
            <button
              aria-pressed={viewMode === 'flat'}
              type="button"
              onClick={() => onViewModeChange('flat')}
            >
              列表显示
            </button>
          </div>
          {viewMode === 'grouped' ? (
            <Button size="small" variant="secondary" onClick={onToggleExpandAll}>
              {allExpanded ? '收起全部' : '展开全部'}
            </Button>
          ) : null}
          <Button
            disabled={summary.count === 0 || exporting || refreshing}
            icon={FileDown}
            size="small"
            variant="secondary"
            onClick={onExportFiltered}
          >
            {exporting ? '正在生成报告' : `导出筛选报告（${summary.count}）`}
          </Button>
          <IconButton disabled={exporting} icon={RefreshCw} label="刷新列表" onClick={onRefresh} />
        </div>
        {exporting ? (
          <span className={styles.exportHint}>
            {exportProgress
              ? `${exportProgress.completed}/${exportProgress.total}${
                  exportProgress.current ? ` · ${exportProgress.current}` : ''
                }`
              : '正在准备报告...'}
          </span>
        ) : null}
      </div>
    </section>
  )
}

function BatchFilter({
  batches,
  selected,
  onChange
}: {
  batches: readonly SettledBatchOption[]
  selected: readonly string[]
  onChange(batchIds: string[]): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const label = selected.length === 0 ? '全部批次' : `批次：${selected.length} 个已选`

  const toggle = (batchId: string): void => {
    onChange(
      selected.includes(batchId)
        ? selected.filter((item) => item !== batchId)
        : [...selected, batchId]
    )
  }

  return (
    <div className={styles.batchFilter} ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="批次筛选"
        className={styles.batchTrigger}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.batchTriggerLabel}>批次</span>
        <span className={styles.batchTriggerValue}>{label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div
          aria-label="批次选项"
          aria-multiselectable="true"
          className={styles.batchPanel}
          role="listbox"
        >
          {batches.map((batch) => (
            <label className={styles.batchOption} key={batch.batchId}>
              <input
                checked={selected.includes(batch.batchId)}
                type="checkbox"
                onChange={() => toggle(batch.batchId)}
              />
              <span>
                <strong>批次 {batch.batchNumber}</strong>
                <small>
                  结算于 {formatDateTime(batch.settledAt)} · {batch.recordCount} 份作答
                </small>
              </span>
            </label>
          ))}
          {selected.length > 0 ? (
            <button className={styles.batchClear} type="button" onClick={() => onChange([])}>
              清除批次选择
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function resultSummaryText(totalCount: number, summary: SettledSummary): string {
  const average = summary.averageScore === null ? '—' : summary.averageScore.toFixed(1)
  const highest = summary.highestScore === null ? '—' : `${summary.highestScore}`
  return `已结算 ${totalCount} 份 · 筛选结果 ${summary.count} 份 · 平均 ${average} 分 · 最高 ${highest} 分`
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
