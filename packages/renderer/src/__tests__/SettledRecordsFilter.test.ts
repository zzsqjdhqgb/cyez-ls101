import type {
  SubmissionLibraryEntry,
  SubmissionLibraryRecord,
  SubmissionSettlementBatch
} from '@ls101/submission-library'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTLED_FILTERS,
  SETTLEMENT_DATE_PRESET_OPTIONS,
  SETTLED_SORT_OPTIONS,
  buildSettledRecords,
  filterSettledRecords,
  formatSettledScore,
  groupSettledRecords,
  hasActiveSettledFilters,
  normalizeDateInput,
  removeSettledFilterChip,
  settlementDateRange,
  settledBatchOptions,
  settledExamOptions,
  settledFilterChips,
  sortSettledRecords,
  summarizeSettledRecords
} from '../features/submissions/settledRecords'
import type {
  SettledFilters,
  SettledRecord,
  SettledSort,
  SettlementDatePreset
} from '../features/submissions/settledRecords'

/**
 * 夹具时间统一用“本地中午”生成：无论测试机时区如何，ISO 时间串回读后的
 * 本地日期都不会跨天，日期区间断言因此稳定。
 */
function localNoon(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

/** 固定的“当前时间”：2026-02-14 本地中午。 */
const NOW = new Date(2026, 1, 14, 12, 0, 0)

interface EntryInput {
  submissionId: string
  candidateName: string
  candidateId: string
  examTitle: string
  submittedAt: string
}

function entry(input: EntryInput): SubmissionLibraryEntry {
  const record: SubmissionLibraryRecord = {
    formatVersion: 1,
    submissionId: input.submissionId,
    examPackageId: `exam-${input.examTitle}`,
    examTitle: input.examTitle,
    candidateId: input.candidateId,
    candidateName: input.candidateName,
    startedAt: input.submittedAt,
    submittedAt: input.submittedAt,
    importedAt: input.submittedAt,
    archiveSha256: '1'.repeat(64),
    archiveBytes: 100,
    schemaUseCount: 1
  }
  return {
    record,
    // 故意与结算快照分数不同，用于锁定“以结算快照为准”。
    grading: { status: 'ready', gradedCount: 1, totalCount: 1, totalScore: 0, maxScore: 10 },
    settlement: null
  }
}

function batch(
  batchId: string,
  settledAt: string,
  scores: ReadonlyArray<{ submissionId: string; totalScore: number; maxScore?: number }>
): SubmissionSettlementBatch {
  return {
    formatVersion: 1,
    batchId,
    settledAt,
    records: scores.map((score) => ({
      submissionId: score.submissionId,
      totalScore: score.totalScore,
      maxScore: score.maxScore ?? 10
    }))
  }
}

// 批次输入故意乱序，buildSettledRecords 必须按结算时间倒序重排。
const BATCH_B1 = batch('batch-1', localNoon(2026, 1, 10), [
  { submissionId: 's1', totalScore: 8 },
  { submissionId: 's2', totalScore: 9 },
  { submissionId: 's3', totalScore: 5 }
])
const BATCH_B2 = batch('batch-2', localNoon(2026, 2, 14), [
  { submissionId: 's4', totalScore: 6 },
  { submissionId: 's5', totalScore: 7.5 },
  { submissionId: 's6', totalScore: 6 }
])
const BATCH_B3 = batch('batch-3', localNoon(2026, 3, 20), [
  { submissionId: 's7', totalScore: 9 },
  { submissionId: 's8', totalScore: 4 },
  { submissionId: 's9', totalScore: 10 }
])

const BATCHES: SubmissionSettlementBatch[] = [BATCH_B1, BATCH_B3, BATCH_B2]

const ENTRIES: SubmissionLibraryEntry[] = [
  entry({
    submissionId: 's1',
    candidateName: '张三',
    candidateId: 'C-0001',
    examTitle: '期末考试',
    submittedAt: localNoon(2026, 1, 8)
  }),
  entry({
    submissionId: 's2',
    candidateName: '李四',
    candidateId: 'C-0002',
    examTitle: '期末考试',
    submittedAt: localNoon(2026, 1, 9)
  }),
  entry({
    submissionId: 's3',
    candidateName: '王五',
    candidateId: 'C-0006',
    examTitle: '英语口语',
    submittedAt: localNoon(2026, 1, 5)
  }),
  entry({
    submissionId: 's4',
    candidateName: '赵六',
    candidateId: 'C-0004',
    examTitle: '期末补考',
    submittedAt: localNoon(2026, 2, 12)
  }),
  entry({
    submissionId: 's5',
    candidateName: '钱七',
    candidateId: 'C-0005',
    examTitle: 'English Final',
    submittedAt: localNoon(2026, 2, 13)
  }),
  entry({
    submissionId: 's6',
    candidateName: '孙八',
    candidateId: 'C-0008',
    examTitle: '期末补考',
    submittedAt: localNoon(2026, 2, 10)
  }),
  entry({
    submissionId: 's7',
    candidateName: '李四',
    candidateId: 'C-0007',
    examTitle: '期末考试',
    submittedAt: localNoon(2026, 3, 18)
  }),
  entry({
    submissionId: 's8',
    candidateName: '周九',
    candidateId: 'C-0009',
    examTitle: '英语口语',
    submittedAt: localNoon(2026, 3, 19)
  }),
  entry({
    submissionId: 's9',
    candidateName: '吴十',
    candidateId: 'C-0010',
    examTitle: 'English Final',
    submittedAt: localNoon(2026, 3, 15)
  })
]

/** 默认顺序：批次新→旧，批内保持 batch.records 顺序。 */
const RECORDS = buildSettledRecords(ENTRIES, BATCHES)
const DEFAULT_ORDER = ['s7', 's8', 's9', 's4', 's5', 's6', 's1', 's2', 's3']

function ids(records: readonly SettledRecord[]): string[] {
  return records.map((record) => record.submissionId)
}

function recordOf(submissionId: string): SettledRecord {
  const record = RECORDS.find((item) => item.submissionId === submissionId)
  if (!record) throw new Error(`夹具中不存在 ${submissionId}`)
  return record
}

function filters(overrides: Partial<SettledFilters> = {}): SettledFilters {
  return { ...DEFAULT_SETTLED_FILTERS, ...overrides }
}

function filteredIds(overrides: Partial<SettledFilters> = {}, now: Date = NOW): string[] {
  return ids(filterSettledRecords(RECORDS, filters(overrides), now))
}

describe('buildSettledRecords', () => {
  it('把批次按结算时间倒序编号后与作答条目 join', () => {
    expect(ids(RECORDS)).toEqual(DEFAULT_ORDER)
    expect(RECORDS.map((record) => record.batchNumber)).toEqual([3, 3, 3, 2, 2, 2, 1, 1, 1])
    expect(RECORDS.map((record) => record.batch.batchId)).toEqual([
      'batch-3',
      'batch-3',
      'batch-3',
      'batch-2',
      'batch-2',
      'batch-2',
      'batch-1',
      'batch-1',
      'batch-1'
    ])
  })

  it('分数取结算快照而不是评分汇总', () => {
    const record = recordOf('s1')
    expect(record.entry.grading?.totalScore).toBe(0)
    expect(record.totalScore).toBe(8)
    expect(record.maxScore).toBe(10)
  })

  it('跳过找不到作答条目的结算记录', () => {
    const sparseBatch = batch('batch-sparse', localNoon(2026, 4, 1), [
      { submissionId: 's1', totalScore: 8 }
    ])
    sparseBatch.records.push({ submissionId: 'missing', totalScore: 1, maxScore: 10 })
    expect(ids(buildSettledRecords(ENTRIES, [sparseBatch]))).toEqual(['s1'])
  })

  it('空输入返回空数组，且不修改传入数组', () => {
    expect(buildSettledRecords([], [])).toEqual([])
    expect(buildSettledRecords(ENTRIES, [])).toEqual([])
    const batches = [BATCH_B1, BATCH_B2, BATCH_B3]
    buildSettledRecords(ENTRIES, batches)
    expect(batches.map((item) => item.batchId)).toEqual(['batch-1', 'batch-2', 'batch-3'])
  })

  it('筛选后批次序号保持稳定', () => {
    const filtered = filterSettledRecords(RECORDS, filters({ batchIds: [BATCH_B1.batchId] }), NOW)
    expect(filtered.map((record) => record.batchNumber)).toEqual([1, 1, 1])
    expect(filtered.map((record) => record.batch.batchId)).toEqual([
      'batch-1',
      'batch-1',
      'batch-1'
    ])
  })
})

describe('settledBatchOptions / settledExamOptions', () => {
  it('批次选项按序号倒序，统计记录数', () => {
    expect(settledBatchOptions(RECORDS)).toEqual([
      { batchId: 'batch-3', batchNumber: 3, settledAt: BATCH_B3.settledAt, recordCount: 3 },
      { batchId: 'batch-2', batchNumber: 2, settledAt: BATCH_B2.settledAt, recordCount: 3 },
      { batchId: 'batch-1', batchNumber: 1, settledAt: BATCH_B1.settledAt, recordCount: 3 }
    ])
    expect(settledBatchOptions([])).toEqual([])
  })

  it('试卷选项去重并按 zh-CN 排序', () => {
    expect(settledExamOptions(RECORDS)).toEqual([
      '期末补考',
      '期末考试',
      '英语口语',
      'English Final'
    ])
    expect(settledExamOptions([])).toEqual([])
  })

  it('试卷选项去除首尾空白后再去重', () => {
    const entries = [
      entry({
        submissionId: 'e1',
        candidateName: '甲',
        candidateId: 'C-1',
        examTitle: '  期末考试  ',
        submittedAt: localNoon(2026, 1, 5)
      }),
      entry({
        submissionId: 'e2',
        candidateName: '乙',
        candidateId: 'C-2',
        examTitle: '期末考试',
        submittedAt: localNoon(2026, 1, 5)
      })
    ]
    const records = buildSettledRecords(entries, [
      batch('b', localNoon(2026, 1, 10), [{ submissionId: 'e1', totalScore: 1 }])
    ])
    expect(settledExamOptions(records)).toEqual(['期末考试'])
  })
})

describe('normalizeDateInput', () => {
  it('接受合法 yyyy-mm-dd 并去除首尾空白', () => {
    expect(normalizeDateInput('2026-01-01')).toBe('2026-01-01')
    expect(normalizeDateInput(' 2026-12-31 ')).toBe('2026-12-31')
    expect(normalizeDateInput('2024-02-29')).toBe('2024-02-29')
  })

  it('拒绝格式错误或日历上不存在的日期', () => {
    expect(normalizeDateInput('')).toBeNull()
    expect(normalizeDateInput('   ')).toBeNull()
    expect(normalizeDateInput('2026-1-1')).toBeNull()
    expect(normalizeDateInput('2026/01/01')).toBeNull()
    expect(normalizeDateInput('2026-01-01T00:00:00')).toBeNull()
    expect(normalizeDateInput('2026-13-01')).toBeNull()
    expect(normalizeDateInput('2026-01-32')).toBeNull()
    expect(normalizeDateInput('2026-02-29')).toBeNull()
    expect(normalizeDateInput('abc')).toBeNull()
  })
})

describe('settlementDateRange', () => {
  it('all 不限制', () => {
    expect(settlementDateRange('all', NOW)).toEqual({ from: null, to: null })
  })

  it('today 只含今天一个本地日期', () => {
    expect(settlementDateRange('today', NOW)).toEqual({
      from: '2026-02-14',
      to: '2026-02-14'
    })
  })

  it('last-7-days / last-30-days 含今天且左闭右闭', () => {
    expect(settlementDateRange('last-7-days', NOW)).toEqual({
      from: '2026-02-08',
      to: '2026-02-14'
    })
    expect(settlementDateRange('last-30-days', NOW)).toEqual({
      from: '2026-01-16',
      to: '2026-02-14'
    })
  })

  it('this-month 从本月 1 日到今天', () => {
    expect(settlementDateRange('this-month', NOW)).toEqual({
      from: '2026-02-01',
      to: '2026-02-14'
    })
    expect(settlementDateRange('this-month', new Date(2026, 2, 2, 12))).toEqual({
      from: '2026-03-01',
      to: '2026-03-02'
    })
  })

  it('跨月跨年时按本地日历平移', () => {
    expect(settlementDateRange('last-30-days', new Date(2026, 0, 2, 12))).toEqual({
      from: '2025-12-04',
      to: '2026-01-02'
    })
  })

  it('custom 归一化两端，任一可空，非法当空', () => {
    expect(settlementDateRange('custom', NOW, '2026-01-01', '2026-02-01')).toEqual({
      from: '2026-01-01',
      to: '2026-02-01'
    })
    expect(settlementDateRange('custom', NOW, '2026-01-01', '')).toEqual({
      from: '2026-01-01',
      to: null
    })
    expect(settlementDateRange('custom', NOW, '', '2026-02-01')).toEqual({
      from: null,
      to: '2026-02-01'
    })
    expect(settlementDateRange('custom', NOW, '2026-13-01', '2026-02-30')).toEqual({
      from: null,
      to: null
    })
  })
})

describe('filterSettledRecords：关键词', () => {
  it('按姓名子串匹配', () => {
    expect(filteredIds({ keyword: '张三' })).toEqual(['s1'])
    expect(filteredIds({ keyword: '李四' })).toEqual(['s7', 's2'])
  })

  it('按考生号匹配且大小写不敏感', () => {
    expect(filteredIds({ keyword: 'c-0002' })).toEqual(['s2'])
    expect(filteredIds({ keyword: 'C-0002' })).toEqual(['s2'])
  })

  it('按试卷名匹配且大小写不敏感', () => {
    expect(filteredIds({ keyword: 'english' })).toEqual(['s9', 's5'])
    expect(filteredIds({ keyword: 'ENGLISH FINAL' })).toEqual(['s9', 's5'])
  })

  it('按批次标签“批次 N”匹配', () => {
    expect(filteredIds({ keyword: '批次 3' })).toEqual(['s7', 's8', 's9'])
  })

  it('按结算日期 yyyy-mm-dd 匹配', () => {
    expect(filteredIds({ keyword: '2026-01-10' })).toEqual(['s1', 's2', 's3'])
  })

  it('多 token 为 AND 关系', () => {
    expect(filteredIds({ keyword: '李四 期末' })).toEqual(['s7', 's2'])
    expect(filteredIds({ keyword: '李四 英语' })).toEqual([])
    expect(filteredIds({ keyword: '期末 考试 C-0001' })).toEqual(['s1'])
  })

  it('空、纯空白关键词不过滤', () => {
    expect(filteredIds({ keyword: '' })).toEqual(DEFAULT_ORDER)
    expect(filteredIds({ keyword: '   ' })).toEqual(DEFAULT_ORDER)
  })

  it('关键词首尾空白与内部多空白归一化', () => {
    expect(filteredIds({ keyword: '  张三  ' })).toEqual(['s1'])
    expect(filteredIds({ keyword: '  李四    期末  ' })).toEqual(['s7', 's2'])
  })

  it('没有命中时返回空数组', () => {
    expect(filteredIds({ keyword: '不存在的考生' })).toEqual([])
  })
})

describe('filterSettledRecords：结算日期', () => {
  it('all 不限制', () => {
    expect(filteredIds({ settlementPreset: 'all' })).toEqual(DEFAULT_ORDER)
  })

  it('today 命中今天结算的批次', () => {
    expect(filteredIds({ settlementPreset: 'today' })).toEqual(['s4', 's5', 's6'])
    expect(filteredIds({ settlementPreset: 'today' }, new Date(2026, 2, 20, 12))).toEqual([
      's7',
      's8',
      's9'
    ])
  })

  it('last-7-days 命中近 7 天', () => {
    expect(filteredIds({ settlementPreset: 'last-7-days' })).toEqual(['s4', 's5', 's6'])
  })

  it('last-30-days 从 29 天前算起', () => {
    expect(filteredIds({ settlementPreset: 'last-30-days' })).toEqual(['s4', 's5', 's6'])
  })

  it('this-month 只命中本月结算', () => {
    expect(filteredIds({ settlementPreset: 'this-month' })).toEqual(['s4', 's5', 's6'])
  })

  it('custom 区间为闭区间且保留默认顺序', () => {
    expect(
      filteredIds({
        settlementPreset: 'custom',
        settlementFrom: '2026-01-10',
        settlementTo: '2026-02-14'
      })
    ).toEqual(['s4', 's5', 's6', 's1', 's2', 's3'])
  })

  it('custom 支持只填一端', () => {
    expect(filteredIds({ settlementPreset: 'custom', settlementTo: '2026-01-10' })).toEqual([
      's1',
      's2',
      's3'
    ])
    expect(filteredIds({ settlementPreset: 'custom', settlementFrom: '2026-01-11' })).toEqual([
      's7',
      's8',
      's9',
      's4',
      's5',
      's6'
    ])
  })

  it('custom 非法日期当空，非 custom 时忽略区间字段', () => {
    expect(
      filteredIds({
        settlementPreset: 'custom',
        settlementFrom: '2026-13-01',
        settlementTo: '2026-02-14'
      })
    ).toEqual(['s4', 's5', 's6', 's1', 's2', 's3'])
    expect(
      filteredIds({
        settlementPreset: 'custom',
        settlementFrom: '2026-13-01',
        settlementTo: '2026-02-30'
      })
    ).toEqual(DEFAULT_ORDER)
    expect(
      filteredIds({
        settlementPreset: 'all',
        settlementFrom: '2027-01-01',
        settlementTo: '2027-01-01'
      })
    ).toEqual(DEFAULT_ORDER)
  })
})

describe('filterSettledRecords：作答日期', () => {
  it('闭区间命中作答日期', () => {
    expect(filteredIds({ submittedFrom: '2026-01-05', submittedTo: '2026-01-09' })).toEqual([
      's1',
      's2',
      's3'
    ])
  })

  it('支持只填一端', () => {
    expect(filteredIds({ submittedFrom: '2026-03-15' })).toEqual(['s7', 's8', 's9'])
    expect(filteredIds({ submittedTo: '2026-01-08' })).toEqual(['s1', 's3'])
  })

  it('边界日期包含两端', () => {
    expect(filteredIds({ submittedFrom: '2026-01-05', submittedTo: '2026-01-05' })).toEqual(['s3'])
  })

  it('非法日期当空', () => {
    expect(filteredIds({ submittedFrom: 'abc', submittedTo: '2026-02-30' })).toEqual(DEFAULT_ORDER)
  })
})

describe('filterSettledRecords：批次 / 试卷 / 分数', () => {
  it('batchIds 多选命中任一即可并保持默认顺序', () => {
    expect(filteredIds({ batchIds: [BATCH_B1.batchId, BATCH_B3.batchId] })).toEqual([
      's7',
      's8',
      's9',
      's1',
      's2',
      's3'
    ])
    expect(filteredIds({ batchIds: [BATCH_B2.batchId] })).toEqual(['s4', 's5', 's6'])
    expect(filteredIds({ batchIds: [] })).toEqual(DEFAULT_ORDER)
    expect(filteredIds({ batchIds: ['不存在'] })).toEqual([])
  })

  it('试卷为 trim 后全等匹配，不做子串匹配', () => {
    expect(filteredIds({ examTitle: '期末考试' })).toEqual(['s7', 's1', 's2'])
    expect(filteredIds({ examTitle: '  期末考试  ' })).toEqual(['s7', 's1', 's2'])
    expect(filteredIds({ examTitle: '期末' })).toEqual([])
    expect(filteredIds({ examTitle: 'English Final' })).toEqual(['s9', 's5'])
  })

  it('最低分 / 最高分为闭区间', () => {
    expect(filteredIds({ minScore: '8' })).toEqual(['s7', 's9', 's1', 's2'])
    expect(filteredIds({ maxScore: '5' })).toEqual(['s8', 's3'])
    expect(filteredIds({ minScore: '6', maxScore: '9' })).toEqual([
      's7',
      's4',
      's5',
      's6',
      's1',
      's2'
    ])
    expect(filteredIds({ minScore: '9', maxScore: '9' })).toEqual(['s7', 's2'])
    expect(filteredIds({ minScore: '7.5' })).toEqual(['s7', 's9', 's5', 's1', 's2'])
  })

  it('空或非法分数视为不限，0 是有效下限', () => {
    expect(filteredIds({ minScore: '', maxScore: '' })).toEqual(DEFAULT_ORDER)
    expect(filteredIds({ minScore: 'abc', maxScore: '   ' })).toEqual(DEFAULT_ORDER)
    expect(filteredIds({ minScore: '0' })).toEqual(DEFAULT_ORDER)
    expect(filteredIds({ maxScore: '0' })).toEqual([])
  })

  it('多个筛选条件同时生效', () => {
    expect(
      filteredIds({
        keyword: '李四',
        submittedFrom: '2026-03-01',
        examTitle: '期末考试',
        minScore: '8'
      })
    ).toEqual(['s7'])
    expect(filteredIds({ keyword: '李四', batchIds: [BATCH_B1.batchId], minScore: '9' })).toEqual([
      's2'
    ])
  })
})

describe('sortSettledRecords', () => {
  it('settled-desc 与默认顺序一致', () => {
    expect(ids(sortSettledRecords(RECORDS, 'settled-desc'))).toEqual(DEFAULT_ORDER)
  })

  it('settled-asc 批次旧→新，批内保持原顺序', () => {
    expect(ids(sortSettledRecords(RECORDS, 'settled-asc'))).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      's8',
      's9'
    ])
  })

  it('submitted-desc 按作答时间新→旧', () => {
    expect(ids(sortSettledRecords(RECORDS, 'submitted-desc'))).toEqual([
      's8',
      's7',
      's9',
      's5',
      's4',
      's6',
      's2',
      's1',
      's3'
    ])
  })

  it('submitted-asc 按作答时间旧→新', () => {
    expect(ids(sortSettledRecords(RECORDS, 'submitted-asc'))).toEqual([
      's3',
      's1',
      's2',
      's6',
      's4',
      's5',
      's9',
      's7',
      's8'
    ])
  })

  it('score-desc 同分按结算时间倒序兜底', () => {
    expect(ids(sortSettledRecords(RECORDS, 'score-desc'))).toEqual([
      's9',
      's7',
      's2',
      's1',
      's5',
      's4',
      's6',
      's3',
      's8'
    ])
  })

  it('score-asc 同分按结算时间倒序兜底', () => {
    expect(ids(sortSettledRecords(RECORDS, 'score-asc'))).toEqual([
      's8',
      's3',
      's4',
      's6',
      's5',
      's1',
      's7',
      's2',
      's9'
    ])
  })

  it('name-asc 按 zh-CN 排序，同名按结算时间倒序兜底', () => {
    expect(ids(sortSettledRecords(RECORDS, 'name-asc'))).toEqual([
      's7',
      's2',
      's5',
      's6',
      's3',
      's9',
      's1',
      's4',
      's8'
    ])
  })

  it('所有排序都稳定：完全相同的记录保持原顺序且不修改输入数组', () => {
    const tieEntries = [
      entry({
        submissionId: 'stable-a',
        candidateName: '同名同分',
        candidateId: 'C-9001',
        examTitle: '期末考试',
        submittedAt: localNoon(2026, 4, 1)
      }),
      entry({
        submissionId: 'stable-b',
        candidateName: '同名同分',
        candidateId: 'C-9002',
        examTitle: '期末考试',
        submittedAt: localNoon(2026, 4, 1)
      })
    ]
    const tieRecords = buildSettledRecords(tieEntries, [
      batch('batch-tie', localNoon(2026, 4, 2), [
        { submissionId: 'stable-a', totalScore: 7 },
        { submissionId: 'stable-b', totalScore: 7 }
      ])
    ])
    const sorts: SettledSort[] = [
      'settled-desc',
      'settled-asc',
      'submitted-desc',
      'submitted-asc',
      'score-desc',
      'score-asc',
      'name-asc'
    ]
    for (const sort of sorts) {
      expect(ids(sortSettledRecords(tieRecords, sort))).toEqual(['stable-a', 'stable-b'])
    }

    const input = [...RECORDS]
    const sorted = sortSettledRecords(input, 'score-desc')
    expect(sorted).not.toBe(input)
    expect(ids(input)).toEqual(DEFAULT_ORDER)
    expect(ids(sorted)).not.toEqual(DEFAULT_ORDER)
  })
})

describe('groupSettledRecords', () => {
  it('settled-desc 批次新→旧，组内保持原顺序', () => {
    const groups = groupSettledRecords(RECORDS, 'settled-desc')
    expect(groups.map((group) => group.batchNumber)).toEqual([3, 2, 1])
    expect(groups.map((group) => group.batch.batchId)).toEqual(['batch-3', 'batch-2', 'batch-1'])
    expect(groups.map((group) => ids(group.records))).toEqual([
      ['s7', 's8', 's9'],
      ['s4', 's5', 's6'],
      ['s1', 's2', 's3']
    ])
  })

  it('settled-asc 批次旧→新', () => {
    const groups = groupSettledRecords(RECORDS, 'settled-asc')
    expect(groups.map((group) => group.batchNumber)).toEqual([1, 2, 3])
  })

  it('组内按 submitted-desc 排序，组序仍按结算时间倒序', () => {
    const groups = groupSettledRecords(RECORDS, 'submitted-desc')
    expect(groups.map((group) => group.batchNumber)).toEqual([3, 2, 1])
    expect(groups.map((group) => ids(group.records))).toEqual([
      ['s8', 's7', 's9'],
      ['s5', 's4', 's6'],
      ['s2', 's1', 's3']
    ])
  })

  it('组内按 score-desc 排序', () => {
    const groups = groupSettledRecords(RECORDS, 'score-desc')
    expect(groups.map((group) => ids(group.records))).toEqual([
      ['s9', 's7', 's8'],
      ['s5', 's4', 's6'],
      ['s2', 's1', 's3']
    ])
  })

  it('空输入返回空分组', () => {
    expect(groupSettledRecords([], 'settled-desc')).toEqual([])
  })
})

describe('summarizeSettledRecords', () => {
  it('统计数量、平均分与最高分', () => {
    const summary = summarizeSettledRecords(RECORDS)
    expect(summary.count).toBe(9)
    expect(summary.averageScore).not.toBeNull()
    expect(summary.averageScore as number).toBeCloseTo(64.5 / 9, 10)
    expect(summary.highestScore).toBe(10)
  })

  it('平均分保留原值不取整', () => {
    const summary = summarizeSettledRecords(
      filterSettledRecords(RECORDS, filters({ batchIds: [BATCH_B2.batchId] }), NOW)
    )
    expect(summary).toEqual({ count: 3, averageScore: 6.5, highestScore: 7.5 })
  })

  it('空数组平均分与最高分为 null', () => {
    expect(summarizeSettledRecords([])).toEqual({
      count: 0,
      averageScore: null,
      highestScore: null
    })
  })
})

describe('formatSettledScore', () => {
  it('输出 得分/满分', () => {
    expect(formatSettledScore(recordOf('s1'))).toBe('8/10')
    expect(formatSettledScore(recordOf('s5'))).toBe('7.5/10')
  })

  it('满分不是 10 时同样输出', () => {
    const records = buildSettledRecords(
      [
        entry({
          submissionId: 'big',
          candidateName: '甲',
          candidateId: 'C-1',
          examTitle: '期末考试',
          submittedAt: localNoon(2026, 1, 5)
        })
      ],
      [batch('b', localNoon(2026, 1, 8), [{ submissionId: 'big', totalScore: 85, maxScore: 100 }])]
    )
    expect(formatSettledScore(records[0])).toBe('85/100')
  })
})

describe('hasActiveSettledFilters', () => {
  it('默认筛选为未启用', () => {
    expect(hasActiveSettledFilters(DEFAULT_SETTLED_FILTERS)).toBe(false)
  })

  it('只改排序不算启用筛选', () => {
    for (const sort of SETTLED_SORT_OPTIONS.map((option) => option.value)) {
      expect(hasActiveSettledFilters(filters({ sort }))).toBe(false)
    }
  })

  it('任一筛选条件启用即返回 true', () => {
    expect(hasActiveSettledFilters(filters({ keyword: '张三' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ settlementPreset: 'today' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ settlementPreset: 'custom' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ batchIds: [BATCH_B1.batchId] }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ examTitle: '期末考试' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ submittedFrom: '2026-01-01' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ submittedTo: '2026-01-31' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ minScore: '0' }))).toBe(true)
    expect(hasActiveSettledFilters(filters({ maxScore: '9' }))).toBe(true)
  })

  it('空白关键词 / 非法日期 / 非法分数不算启用筛选', () => {
    expect(hasActiveSettledFilters(filters({ keyword: '   ' }))).toBe(false)
    expect(hasActiveSettledFilters(filters({ examTitle: '  ' }))).toBe(false)
    expect(hasActiveSettledFilters(filters({ submittedFrom: 'abc' }))).toBe(false)
    expect(hasActiveSettledFilters(filters({ submittedTo: '2026-02-30' }))).toBe(false)
    expect(hasActiveSettledFilters(filters({ minScore: 'abc' }))).toBe(false)
    expect(hasActiveSettledFilters(filters({ maxScore: '  ' }))).toBe(false)
  })
})

describe('settledFilterChips', () => {
  it('默认筛选没有 chips', () => {
    expect(settledFilterChips(RECORDS, DEFAULT_SETTLED_FILTERS)).toEqual([])
  })

  it('关键词 chip 使用 trim 后的文案', () => {
    expect(settledFilterChips(RECORDS, filters({ keyword: '  张三  ' }))).toEqual([
      { key: 'keyword', label: '搜索“张三”' }
    ])
  })

  it('结算日期预设 chip', () => {
    expect(settledFilterChips(RECORDS, filters({ settlementPreset: 'today' }))).toEqual([
      { key: 'settlement-date', label: '结算日期：今天' }
    ])
    expect(settledFilterChips(RECORDS, filters({ settlementPreset: 'last-7-days' }))).toEqual([
      { key: 'settlement-date', label: '结算日期：近 7 天' }
    ])
    expect(settledFilterChips(RECORDS, filters({ settlementPreset: 'this-month' }))).toEqual([
      { key: 'settlement-date', label: '结算日期：本月' }
    ])
  })

  it('自定义结算日期 chip 支持整段与单端', () => {
    expect(
      settledFilterChips(
        RECORDS,
        filters({
          settlementPreset: 'custom',
          settlementFrom: '2026-01-01',
          settlementTo: '2026-02-01'
        })
      )
    ).toEqual([{ key: 'settlement-date', label: '结算日期：2026-01-01 至 2026-02-01' }])
    expect(
      settledFilterChips(
        RECORDS,
        filters({ settlementPreset: 'custom', settlementFrom: '2026-01-01' })
      )
    ).toEqual([{ key: 'settlement-date', label: '结算日期：2026-01-01 起' }])
    expect(
      settledFilterChips(
        RECORDS,
        filters({ settlementPreset: 'custom', settlementTo: '2026-02-01' })
      )
    ).toEqual([{ key: 'settlement-date', label: '结算日期：截至 2026-02-01' }])
  })

  it('作答日期 chip', () => {
    expect(
      settledFilterChips(
        RECORDS,
        filters({ submittedFrom: '2026-01-01', submittedTo: '2026-01-31' })
      )
    ).toEqual([{ key: 'submitted-date', label: '作答日期：2026-01-01 至 2026-01-31' }])
    expect(settledFilterChips(RECORDS, filters({ submittedFrom: '2026-01-01' }))).toEqual([
      { key: 'submitted-date', label: '作答日期：2026-01-01 起' }
    ])
    expect(settledFilterChips(RECORDS, filters({ submittedTo: '2026-01-31' }))).toEqual([
      { key: 'submitted-date', label: '作答日期：截至 2026-01-31' }
    ])
  })

  it('批次 chip 展示批次序号，超过 2 个折叠为数量', () => {
    expect(
      settledFilterChips(RECORDS, filters({ batchIds: [BATCH_B3.batchId, BATCH_B2.batchId] }))
    ).toEqual([{ key: 'batch', label: '批次：批次 3、批次 2' }])
    expect(settledFilterChips(RECORDS, filters({ batchIds: [BATCH_B1.batchId] }))).toEqual([
      { key: 'batch', label: '批次：批次 1' }
    ])
    expect(
      settledFilterChips(
        RECORDS,
        filters({ batchIds: [BATCH_B3.batchId, BATCH_B2.batchId, BATCH_B1.batchId] })
      )
    ).toEqual([{ key: 'batch', label: '批次：3 个批次' }])
  })

  it('试卷 chip', () => {
    expect(settledFilterChips(RECORDS, filters({ examTitle: '期末考试' }))).toEqual([
      { key: 'exam', label: '试卷：期末考试' }
    ])
  })

  it('分数 chip 支持下限、上限和区间', () => {
    expect(settledFilterChips(RECORDS, filters({ minScore: '5' }))).toEqual([
      { key: 'score', label: '分数：≥ 5' }
    ])
    expect(settledFilterChips(RECORDS, filters({ maxScore: '9' }))).toEqual([
      { key: 'score', label: '分数：≤ 9' }
    ])
    expect(settledFilterChips(RECORDS, filters({ minScore: '5', maxScore: '9' }))).toEqual([
      { key: 'score', label: '分数：5–9' }
    ])
  })

  it('多个条件按固定顺序输出', () => {
    const chips = settledFilterChips(
      RECORDS,
      filters({
        keyword: '张',
        settlementPreset: 'today',
        submittedFrom: '2026-01-01',
        batchIds: [BATCH_B3.batchId],
        examTitle: '期末考试',
        minScore: '5'
      })
    )
    expect(chips.map((chip) => chip.key)).toEqual([
      'keyword',
      'settlement-date',
      'submitted-date',
      'batch',
      'exam',
      'score'
    ])
    expect(chips.map((chip) => chip.label)).toEqual([
      '搜索“张”',
      '结算日期：今天',
      '作答日期：2026-01-01 起',
      '批次：批次 3',
      '试卷：期末考试',
      '分数：≥ 5'
    ])
  })
})

describe('removeSettledFilterChip', () => {
  const FULL = filters({
    keyword: '张三',
    settlementPreset: 'custom',
    settlementFrom: '2026-01-01',
    settlementTo: '2026-02-01',
    submittedFrom: '2026-01-01',
    submittedTo: '2026-01-31',
    batchIds: [BATCH_B3.batchId, BATCH_B2.batchId],
    examTitle: '期末考试',
    minScore: '5',
    maxScore: '9',
    sort: 'score-desc'
  })

  it('keyword chip 只清除关键词并保留其它条件', () => {
    const next = removeSettledFilterChip(FULL, 'keyword')
    expect(next).toEqual({ ...FULL, keyword: '' })
    expect(next.sort).toBe('score-desc')
  })

  it('settlement-date chip 清除预设与自定义区间', () => {
    expect(removeSettledFilterChip(FULL, 'settlement-date')).toEqual({
      ...FULL,
      settlementPreset: 'all',
      settlementFrom: '',
      settlementTo: ''
    })
  })

  it('submitted-date chip 清除两端作答日期', () => {
    expect(removeSettledFilterChip(FULL, 'submitted-date')).toEqual({
      ...FULL,
      submittedFrom: '',
      submittedTo: ''
    })
  })

  it('batch chip 清除批次多选', () => {
    expect(removeSettledFilterChip(FULL, 'batch')).toEqual({ ...FULL, batchIds: [] })
  })

  it('exam chip 清除试卷', () => {
    expect(removeSettledFilterChip(FULL, 'exam')).toEqual({ ...FULL, examTitle: '' })
  })

  it('score chip 同时清除最低分与最高分', () => {
    expect(removeSettledFilterChip(FULL, 'score')).toEqual({
      ...FULL,
      minScore: '',
      maxScore: ''
    })
    expect(removeSettledFilterChip(filters({ minScore: '5' }), 'score')).toEqual(
      filters({ minScore: '' })
    )
  })

  it('不修改原筛选对象', () => {
    removeSettledFilterChip(FULL, 'keyword')
    expect(FULL.keyword).toBe('张三')
    expect(FULL.batchIds).toEqual([BATCH_B3.batchId, BATCH_B2.batchId])
  })
})

describe('默认值与选项常量', () => {
  it('DEFAULT_SETTLED_FILTERS 全部为默认值', () => {
    expect(DEFAULT_SETTLED_FILTERS).toEqual({
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
    })
  })

  it('结算日期预设选项顺序与文案', () => {
    expect(SETTLEMENT_DATE_PRESET_OPTIONS).toEqual([
      { value: 'all', label: '全部时间' },
      { value: 'today', label: '今天' },
      { value: 'last-7-days', label: '近 7 天' },
      { value: 'last-30-days', label: '近 30 天' },
      { value: 'this-month', label: '本月' },
      { value: 'custom', label: '自定义区间' }
    ])
    const presets: SettlementDatePreset[] = SETTLEMENT_DATE_PRESET_OPTIONS.map(
      (option) => option.value
    )
    expect(presets).toEqual(['all', 'today', 'last-7-days', 'last-30-days', 'this-month', 'custom'])
  })

  it('排序选项覆盖 7 种排序且文案固定', () => {
    expect(SETTLED_SORT_OPTIONS).toEqual([
      { value: 'settled-desc', label: '结算时间（新→旧）' },
      { value: 'settled-asc', label: '结算时间（旧→新）' },
      { value: 'submitted-desc', label: '作答时间（新→旧）' },
      { value: 'submitted-asc', label: '作答时间（旧→新）' },
      { value: 'score-desc', label: '得分（高→低）' },
      { value: 'score-asc', label: '得分（低→高）' },
      { value: 'name-asc', label: '姓名（A→Z）' }
    ])
  })
})
