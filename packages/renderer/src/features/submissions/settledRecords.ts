import type { SubmissionLibraryEntry, SubmissionSettlementBatch } from '@ls101/submission-library'

/**
 * 一条已结算作答。结算快照里的分数是成绩的权威值，展示和筛选都以它为准。
 */
export interface SettledRecord {
  entry: SubmissionLibraryEntry
  batch: SubmissionSettlementBatch
  /** 批次的稳定序号，最新批次数值最大，筛选前后保持不变。 */
  batchNumber: number
  submissionId: string
  totalScore: number
  maxScore: number
}

export interface SettledBatchGroup {
  batch: SubmissionSettlementBatch
  batchNumber: number
  records: SettledRecord[]
}

export interface SettledBatchOption {
  batchId: string
  batchNumber: number
  settledAt: string
  recordCount: number
}

export type SettlementDatePreset =
  | 'all'
  | 'today'
  | 'last-7-days'
  | 'last-30-days'
  | 'this-month'
  | 'custom'

export type SettledSort =
  | 'settled-desc'
  | 'settled-asc'
  | 'submitted-desc'
  | 'submitted-asc'
  | 'score-desc'
  | 'score-asc'
  | 'name-asc'

export interface SettledFilters {
  keyword: string
  settlementPreset: SettlementDatePreset
  /** yyyy-mm-dd，仅在 settlementPreset 为 custom 时参与筛选。 */
  settlementFrom: string
  settlementTo: string
  /** yyyy-mm-dd，作答日期闭区间，可为空。 */
  submittedFrom: string
  submittedTo: string
  batchIds: readonly string[]
  /** 空字符串表示全部试卷。 */
  examTitle: string
  /** 数字输入框原值，空字符串表示不限。 */
  minScore: string
  maxScore: string
  sort: SettledSort
}

export interface SettledSummary {
  count: number
  averageScore: number | null
  highestScore: number | null
}

export type SettledFilterChipKey =
  | 'keyword'
  | 'settlement-date'
  | 'submitted-date'
  | 'batch'
  | 'exam'
  | 'score'

export interface SettledFilterChip {
  key: SettledFilterChipKey
  label: string
}

export interface SettledDateRange {
  from: string | null
  to: string | null
}

export const DEFAULT_SETTLED_FILTERS: SettledFilters = {
  keyword: '',
  settlementPreset: 'all',
  settlementFrom: '',
  settlementTo: '',
  submittedFrom: '',
  submittedTo: '',
  batchIds: [],
  examTitle: '',
  minScore: '',
  maxScore: '',
  sort: 'settled-desc'
}

export const SETTLEMENT_DATE_PRESET_OPTIONS: ReadonlyArray<{
  value: SettlementDatePreset
  label: string
}> = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'last-7-days', label: '近 7 天' },
  { value: 'last-30-days', label: '近 30 天' },
  { value: 'this-month', label: '本月' },
  { value: 'custom', label: '自定义区间' }
]

export const SETTLED_SORT_OPTIONS: ReadonlyArray<{ value: SettledSort; label: string }> = [
  { value: 'settled-desc', label: '结算时间（新→旧）' },
  { value: 'settled-asc', label: '结算时间（旧→新）' },
  { value: 'submitted-desc', label: '作答时间（新→旧）' },
  { value: 'submitted-asc', label: '作答时间（旧→新）' },
  { value: 'score-desc', label: '得分（高→低）' },
  { value: 'score-asc', label: '得分（低→高）' },
  { value: 'name-asc', label: '姓名（A→Z）' }
]

/** 把结算批次和作答条目 join 成可以筛选的平铺记录，顺序为默认展示顺序。 */
export function buildSettledRecords(
  entries: readonly SubmissionLibraryEntry[],
  batches: readonly SubmissionSettlementBatch[]
): SettledRecord[] {
  const entriesById = new Map(entries.map((entry) => [entry.record.submissionId, entry]))
  const orderedBatches = [...batches].sort(compareBatchesNewest)
  const records: SettledRecord[] = []
  orderedBatches.forEach((batch, index) => {
    const batchNumber = orderedBatches.length - index
    for (const batchRecord of batch.records) {
      const entry = entriesById.get(batchRecord.submissionId)
      if (!entry) continue
      records.push({
        entry,
        batch,
        batchNumber,
        submissionId: batchRecord.submissionId,
        totalScore: batchRecord.totalScore,
        maxScore: batchRecord.maxScore
      })
    }
  })
  return records
}

/** 批次筛选项：最新批次在前，序号与批次 header 一致。 */
export function settledBatchOptions(records: readonly SettledRecord[]): SettledBatchOption[] {
  const options = new Map<string, SettledBatchOption>()
  for (const record of records) {
    const existing = options.get(record.batch.batchId)
    if (existing) {
      existing.recordCount += 1
      continue
    }
    options.set(record.batch.batchId, {
      batchId: record.batch.batchId,
      batchNumber: record.batchNumber,
      settledAt: record.batch.settledAt,
      recordCount: 1
    })
  }
  return [...options.values()].sort((left, right) => right.batchNumber - left.batchNumber)
}

export function settledExamOptions(records: readonly SettledRecord[]): string[] {
  const titles = new Set<string>()
  for (const record of records) {
    const title = record.entry.record.examTitle.trim()
    if (title !== '') titles.add(title)
  }
  return [...titles].sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

/** 把 `yyyy-mm-dd` 归一化为合法本地日期键；非法值返回 null。 */
export function normalizeDateInput(value: string): string | null {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return trimmed
}

/** 结算日期当前生效的本地日期闭区间；`all` 时两端都为 null。 */
export function settlementDateRange(
  preset: SettlementDatePreset,
  now: Date = new Date(),
  from = '',
  to = ''
): SettledDateRange {
  switch (preset) {
    case 'today': {
      const key = localDateKeyOf(now)
      return { from: key, to: key }
    }
    case 'last-7-days':
      return { from: offsetDateKey(now, -6), to: localDateKeyOf(now) }
    case 'last-30-days':
      return { from: offsetDateKey(now, -29), to: localDateKeyOf(now) }
    case 'this-month':
      return { from: firstDayOfMonthKey(now), to: localDateKeyOf(now) }
    case 'custom':
      return { from: normalizeDateInput(from), to: normalizeDateInput(to) }
    default:
      return { from: null, to: null }
  }
}

export function filterSettledRecords(
  records: readonly SettledRecord[],
  filters: SettledFilters,
  now: Date = new Date()
): SettledRecord[] {
  const keywordTokens = normalizedKeywordTokens(filters.keyword)
  const settledRange = settlementDateRange(
    filters.settlementPreset,
    now,
    filters.settlementFrom,
    filters.settlementTo
  )
  const submittedFrom = normalizeDateInput(filters.submittedFrom)
  const submittedTo = normalizeDateInput(filters.submittedTo)
  const batchIds = new Set(filters.batchIds)
  const examTitle = filters.examTitle.trim()
  const minScore = parseScore(filters.minScore)
  const maxScore = parseScore(filters.maxScore)
  return records.filter((record) => {
    if (
      keywordTokens.length > 0 &&
      !keywordTokens.every((token) => keywordHaystack(record).includes(token))
    ) {
      return false
    }
    if (settledRange.from || settledRange.to) {
      const settledKey = localDateKey(record.batch.settledAt)
      if (!settledKey) return false
      if (settledRange.from && settledKey < settledRange.from) return false
      if (settledRange.to && settledKey > settledRange.to) return false
    }
    if (submittedFrom || submittedTo) {
      const submittedKey = localDateKey(record.entry.record.submittedAt)
      if (!submittedKey) return false
      if (submittedFrom && submittedKey < submittedFrom) return false
      if (submittedTo && submittedKey > submittedTo) return false
    }
    if (batchIds.size > 0 && !batchIds.has(record.batch.batchId)) return false
    if (examTitle !== '' && record.entry.record.examTitle.trim() !== examTitle) return false
    if (minScore !== null && record.totalScore < minScore) return false
    if (maxScore !== null && record.totalScore > maxScore) return false
    return true
  })
}

/** 平铺视图的排序；同分/同名按结算时间倒序兜底，最后用原始顺序保证稳定。 */
export function sortSettledRecords(
  records: readonly SettledRecord[],
  sort: SettledSort
): SettledRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort(
      (left, right) => compareRecords(left.record, right.record, sort) || left.index - right.index
    )
    .map((item) => item.record)
}

/** 分组视图：批次顺序按结算时间（升序排序时正序，其余倒序），组内按当前排序规则。 */
export function groupSettledRecords(
  records: readonly SettledRecord[],
  sort: SettledSort
): SettledBatchGroup[] {
  const groups = new Map<string, SettledBatchGroup>()
  for (const record of sortSettledRecords(records, sort)) {
    const existing = groups.get(record.batch.batchId)
    if (existing) {
      existing.records.push(record)
      continue
    }
    groups.set(record.batch.batchId, {
      batch: record.batch,
      batchNumber: record.batchNumber,
      records: [record]
    })
  }
  const result = [...groups.values()]
  const direction = sort === 'settled-asc' ? 1 : -1
  result.sort(
    (left, right) =>
      direction * compareTimestamps(left.batch.settledAt, right.batch.settledAt) ||
      right.batchNumber - left.batchNumber
  )
  return result
}

export function summarizeSettledRecords(records: readonly SettledRecord[]): SettledSummary {
  if (records.length === 0) return { count: 0, averageScore: null, highestScore: null }
  let total = 0
  let highest = records[0].totalScore
  for (const record of records) {
    total += record.totalScore
    if (record.totalScore > highest) highest = record.totalScore
  }
  return { count: records.length, averageScore: total / records.length, highestScore: highest }
}

/** 只有真正的筛选条件（不含排序）会触发该判断。 */
export function hasActiveSettledFilters(filters: SettledFilters): boolean {
  return (
    filters.keyword.trim() !== '' ||
    filters.settlementPreset !== 'all' ||
    filters.batchIds.length > 0 ||
    filters.examTitle.trim() !== '' ||
    normalizeDateInput(filters.submittedFrom) !== null ||
    normalizeDateInput(filters.submittedTo) !== null ||
    parseScore(filters.minScore) !== null ||
    parseScore(filters.maxScore) !== null
  )
}

export function formatSettledScore(record: SettledRecord): string {
  return `${record.totalScore}/${record.maxScore}`
}

/** 按当前筛选状态生成条件 chips；records 传入未筛选的全量数据用于批次序号。 */
export function settledFilterChips(
  records: readonly SettledRecord[],
  filters: SettledFilters
): SettledFilterChip[] {
  const chips: SettledFilterChip[] = []
  const keyword = filters.keyword.trim()
  if (keyword !== '') chips.push({ key: 'keyword', label: `搜索“${keyword}”` })

  const settledChip = settlementDateChipLabel(filters)
  if (settledChip !== null) chips.push({ key: 'settlement-date', label: settledChip })

  const submittedChip = dateRangeChipLabel(
    '作答日期',
    normalizeDateInput(filters.submittedFrom),
    normalizeDateInput(filters.submittedTo)
  )
  if (submittedChip !== null) chips.push({ key: 'submitted-date', label: submittedChip })

  if (filters.batchIds.length > 0) {
    const numbers = new Map<string, number>()
    for (const record of records) {
      if (!numbers.has(record.batch.batchId)) numbers.set(record.batch.batchId, record.batchNumber)
    }
    const selected = filters.batchIds.flatMap((batchId) => {
      const batchNumber = numbers.get(batchId)
      return batchNumber === undefined ? [] : [`批次 ${batchNumber}`]
    })
    chips.push({
      key: 'batch',
      label:
        selected.length > 2
          ? `批次：${selected.length} 个批次`
          : `批次：${selected.join('、') || `${filters.batchIds.length} 个批次`}`
    })
  }

  const examTitle = filters.examTitle.trim()
  if (examTitle !== '') chips.push({ key: 'exam', label: `试卷：${examTitle}` })

  const minScore = parseScore(filters.minScore)
  const maxScore = parseScore(filters.maxScore)
  if (minScore !== null && maxScore !== null) {
    chips.push({ key: 'score', label: `分数：${minScore}–${maxScore}` })
  } else if (minScore !== null) {
    chips.push({ key: 'score', label: `分数：≥ ${minScore}` })
  } else if (maxScore !== null) {
    chips.push({ key: 'score', label: `分数：≤ ${maxScore}` })
  }
  return chips
}

export function removeSettledFilterChip(
  filters: SettledFilters,
  key: SettledFilterChipKey
): SettledFilters {
  switch (key) {
    case 'keyword':
      return { ...filters, keyword: '' }
    case 'settlement-date':
      return { ...filters, settlementPreset: 'all', settlementFrom: '', settlementTo: '' }
    case 'submitted-date':
      return { ...filters, submittedFrom: '', submittedTo: '' }
    case 'batch':
      return { ...filters, batchIds: [] }
    case 'exam':
      return { ...filters, examTitle: '' }
    case 'score':
      return { ...filters, minScore: '', maxScore: '' }
  }
}

function settlementDateChipLabel(filters: SettledFilters): string | null {
  if (filters.settlementPreset === 'custom') {
    const range = dateRangeChipLabel(
      '结算日期',
      normalizeDateInput(filters.settlementFrom),
      normalizeDateInput(filters.settlementTo)
    )
    return range ?? '结算日期：自定义区间'
  }
  if (filters.settlementPreset === 'all') return null
  const option = SETTLEMENT_DATE_PRESET_OPTIONS.find(
    (item) => item.value === filters.settlementPreset
  )
  return `结算日期：${option?.label ?? '自定义区间'}`
}

function dateRangeChipLabel(prefix: string, from: string | null, to: string | null): string | null {
  if (from && to) return `${prefix}：${from} 至 ${to}`
  if (from) return `${prefix}：${from} 起`
  if (to) return `${prefix}：截至 ${to}`
  return null
}

function keywordHaystack(record: SettledRecord): string {
  const { candidateId, candidateName, examTitle } = record.entry.record
  const candidateIdText = candidateId.startsWith('auto:') ? '考生号未填写' : candidateId
  const settledDate = localDateKey(record.batch.settledAt) ?? ''
  return [
    candidateName,
    candidateId,
    candidateIdText,
    examTitle,
    `批次 ${record.batchNumber}`,
    settledDate
  ]
    .join(' ')
    .toLocaleLowerCase('zh-CN')
}

function normalizedKeywordTokens(keyword: string): string[] {
  return keyword
    .trim()
    .toLocaleLowerCase('zh-CN')
    .split(/\s+/)
    .filter((token) => token !== '')
}

function parseScore(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function compareBatchesNewest(
  left: SubmissionSettlementBatch,
  right: SubmissionSettlementBatch
): number {
  return (
    compareTimestamps(right.settledAt, left.settledAt) || right.batchId.localeCompare(left.batchId)
  )
}

function compareRecords(left: SettledRecord, right: SettledRecord, sort: SettledSort): number {
  switch (sort) {
    case 'settled-desc':
      return compareTimestamps(right.batch.settledAt, left.batch.settledAt)
    case 'settled-asc':
      return compareTimestamps(left.batch.settledAt, right.batch.settledAt)
    case 'submitted-desc':
      return (
        compareTimestamps(right.entry.record.submittedAt, left.entry.record.submittedAt) ||
        compareTimestamps(right.batch.settledAt, left.batch.settledAt)
      )
    case 'submitted-asc':
      return (
        compareTimestamps(left.entry.record.submittedAt, right.entry.record.submittedAt) ||
        compareTimestamps(right.batch.settledAt, left.batch.settledAt)
      )
    case 'score-desc':
      return (
        right.totalScore - left.totalScore ||
        compareTimestamps(right.batch.settledAt, left.batch.settledAt)
      )
    case 'score-asc':
      return (
        left.totalScore - right.totalScore ||
        compareTimestamps(right.batch.settledAt, left.batch.settledAt)
      )
    case 'name-asc':
      return (
        left.entry.record.candidateName.localeCompare(right.entry.record.candidateName, 'zh-CN') ||
        compareTimestamps(right.batch.settledAt, left.batch.settledAt)
      )
  }
}

function compareTimestamps(left: string, right: string): number {
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return 0
  return leftTime - rightTime
}

function localDateKey(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return localDateKeyOf(date)
}

function localDateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function offsetDateKey(now: Date, days: number): string {
  return localDateKeyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}

function firstDayOfMonthKey(now: Date): string {
  return localDateKeyOf(new Date(now.getFullYear(), now.getMonth(), 1))
}

function pad2(value: number): string {
  return `${value}`.padStart(2, '0')
}
