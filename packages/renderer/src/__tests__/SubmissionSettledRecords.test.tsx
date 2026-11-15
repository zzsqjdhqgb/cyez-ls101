// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReportExportBridge, ReportExportResult } from '@ls101/core-types'
import type {
  SubmissionLibraryEntry,
  SubmissionLibraryRecord,
  SubmissionLibraryRepository,
  SubmissionSettlementBatch
} from '@ls101/submission-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubmissionLibraryPage } from '../features/submissions/SubmissionLibraryPage'
import { SubmissionLibraryProvider } from '../features/submissions/SubmissionLibraryProvider'

afterEach(() => {
  cleanup()
  delete window.reportExport
})

/**
 * 页面内的日期筛选以“当前时间”为基准，因此夹具日期一律相对测试运行当天构造：
 * 本地中午时间保证 ISO 串回读后仍是同一天，不受测试机时区影响。
 */
const NOW = new Date()

function localNoon(daysAgo: number): Date {
  return new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 12, 0, 0)
}

function localNoonIso(daysAgo: number): string {
  return localNoon(daysAgo).toISOString()
}

function localDateKey(daysAgo: number): string {
  const date = localNoon(daysAgo)
  const pad = (value: number): string => `${value}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const BATCHES: SubmissionSettlementBatch[] = [
  {
    formatVersion: 1,
    batchId: 'batch-new',
    settledAt: localNoonIso(0),
    records: [
      { submissionId: 'new-zhang', totalScore: 8, maxScore: 10 },
      { submissionId: 'new-li', totalScore: 9, maxScore: 10 },
      { submissionId: 'new-wang', totalScore: 5, maxScore: 10 }
    ]
  },
  {
    formatVersion: 1,
    batchId: 'batch-mid',
    settledAt: localNoonIso(3),
    records: [
      { submissionId: 'mid-zhao', totalScore: 6, maxScore: 10 },
      { submissionId: 'mid-qian', totalScore: 7.5, maxScore: 10 }
    ]
  },
  {
    formatVersion: 1,
    batchId: 'batch-old',
    settledAt: localNoonIso(40),
    records: [
      { submissionId: 'old-sun', totalScore: 4, maxScore: 10 },
      { submissionId: 'old-zhou', totalScore: 9, maxScore: 10 },
      { submissionId: 'old-wu', totalScore: 10, maxScore: 10 }
    ]
  }
]

function batchSettledAt(batchId: string): string {
  const batch = BATCHES.find((item) => item.batchId === batchId)
  if (!batch) throw new Error(`夹具中不存在批次 ${batchId}`)
  return batch.settledAt
}

interface CandidateFixture {
  submissionId: string
  candidateName: string
  candidateId: string
  examTitle: string
  batchId: string
  submittedDaysAgo: number
}

const CANDIDATES: CandidateFixture[] = [
  {
    submissionId: 'new-zhang',
    candidateName: '张三',
    candidateId: 'C-0001',
    examTitle: '期末考试',
    batchId: 'batch-new',
    submittedDaysAgo: 0
  },
  {
    submissionId: 'new-li',
    candidateName: '李四',
    candidateId: 'C-0002',
    examTitle: '期末考试',
    batchId: 'batch-new',
    submittedDaysAgo: 1
  },
  {
    submissionId: 'new-wang',
    candidateName: '王五',
    candidateId: 'C-0003',
    examTitle: '期末考试',
    batchId: 'batch-new',
    submittedDaysAgo: 2
  },
  {
    submissionId: 'mid-zhao',
    candidateName: '赵六',
    candidateId: 'C-0004',
    examTitle: '英语口语',
    batchId: 'batch-mid',
    submittedDaysAgo: 3
  },
  {
    submissionId: 'mid-qian',
    candidateName: '钱七',
    candidateId: 'C-0005',
    examTitle: '英语口语',
    batchId: 'batch-mid',
    submittedDaysAgo: 4
  },
  {
    submissionId: 'old-sun',
    candidateName: '孙八',
    candidateId: 'C-0008',
    examTitle: '期末考试',
    batchId: 'batch-old',
    submittedDaysAgo: 40
  },
  {
    submissionId: 'old-zhou',
    candidateName: '周九',
    candidateId: 'C-0009',
    examTitle: '期末考试',
    batchId: 'batch-old',
    submittedDaysAgo: 41
  },
  {
    submissionId: 'old-wu',
    candidateName: '吴十',
    candidateId: 'C-0010',
    examTitle: '期末考试',
    batchId: 'batch-old',
    submittedDaysAgo: 42
  }
]

function recordOf(candidate: CandidateFixture): SubmissionLibraryRecord {
  return {
    formatVersion: 1,
    submissionId: candidate.submissionId,
    examPackageId: `exam-${candidate.examTitle}`,
    examTitle: candidate.examTitle,
    candidateId: candidate.candidateId,
    candidateName: candidate.candidateName,
    startedAt: localNoonIso(candidate.submittedDaysAgo),
    submittedAt: localNoonIso(candidate.submittedDaysAgo),
    importedAt: localNoonIso(candidate.submittedDaysAgo),
    archiveSha256: '1'.repeat(64),
    archiveBytes: 100,
    schemaUseCount: 1
  }
}

const ENTRIES: SubmissionLibraryEntry[] = CANDIDATES.map((candidate) => ({
  record: recordOf(candidate),
  grading: { status: 'ready', gradedCount: 1, totalCount: 1, totalScore: 0, maxScore: 10 },
  settlement: {
    batchId: candidate.batchId,
    settledAt: batchSettledAt(candidate.batchId)
  }
}))

const FULL_SUMMARY = '已结算 8 份 · 筛选结果 8 份 · 平均 7.3 分 · 最高 10 分'

function mockRepository(): SubmissionLibraryRepository {
  return {
    listRecords: vi.fn().mockResolvedValue([]),
    listEntries: vi.fn().mockResolvedValue(ENTRIES),
    getRecord: vi.fn().mockResolvedValue(null),
    importArchive: vi.fn(),
    exportArchive: vi.fn(),
    deleteSubmission: vi.fn(),
    resetGrading: vi.fn(),
    listSettlementBatches: vi.fn().mockResolvedValue(BATCHES),
    settleSubmissions: vi.fn(),
    startGrading: vi.fn(),
    submitGradingResult: vi.fn(),
    saveAIGradingRun: vi.fn(),
    getGradingRecord: vi.fn().mockResolvedValue(null),
    getReport: vi.fn().mockImplementation(async (submissionId: string) => ({
      markdown: `# ${submissionId} 报告\n\n正文`,
      resources: {}
    }))
  }
}

function bridgeWith(
  exportBatch: ReportExportBridge['exportBatch'],
  exportSingle: ReportExportBridge['exportSingle'] = vi.fn(),
  onProgress: ReportExportBridge['onProgress'] = () => () => undefined
): ReportExportBridge {
  return { exportBatch, exportSingle, onProgress }
}

async function renderSettledView(
  repository: SubmissionLibraryRepository = mockRepository()
): Promise<void> {
  render(
    <SubmissionLibraryProvider repository={repository}>
      <MemoryRouter initialEntries={['/submissions?view=settled']}>
        <Routes>
          <Route element={<SubmissionLibraryPage />} key="list" path="/submissions" />
        </Routes>
      </MemoryRouter>
    </SubmissionLibraryProvider>
  )
  await screen.findByLabelText('搜索已结算作答')
}

function searchInput(): HTMLInputElement {
  return screen.getByLabelText('搜索已结算作答') as HTMLInputElement
}

function summaryText(): string {
  return (
    screen.getByText(/^已结算 \d+ 份 · 筛选结果 \d+ 份 · 平均 .+ 分 · 最高 .+ 分$/).textContent ??
    ''
  )
}

function batchHeaderButtons(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /结算于/ })
}

function flatRows(): HTMLElement[] {
  const table = screen.getByRole('table')
  return within(table).getAllByRole('row').slice(1)
}

function flatCandidateNames(): string[] {
  return flatRows().map((row) => row.querySelector('td strong')?.textContent ?? '')
}

function openAdvancedFilters(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: '更多筛选' }))
  return screen.getByLabelText('更多筛选条件')
}

describe('已结算视图：初始状态与统计', () => {
  it('渲染筛选工具条、统计文本和默认分组视图', async () => {
    await renderSettledView()

    expect(screen.getByLabelText('搜索已结算作答')).toHaveAttribute(
      'placeholder',
      '搜索姓名、考生号、试卷或批次'
    )
    expect(screen.getByLabelText('结算日期筛选')).toHaveValue('all')
    expect(screen.getByLabelText('试卷筛选')).toHaveValue('')
    const batchTrigger = screen.getByRole('button', { name: '批次筛选' })
    expect(batchTrigger).toHaveTextContent('全部批次')
    expect(batchTrigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(screen.getByRole('button', { name: '更多筛选' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(screen.queryByLabelText('更多筛选条件')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('已启用的筛选条件')).not.toBeInTheDocument()

    expect(summaryText()).toBe(FULL_SUMMARY)
    expect(screen.getByLabelText('排序方式')).toHaveValue('settled-desc')
    expect(screen.getByRole('button', { name: '分组显示' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '列表显示' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: '导出筛选报告（8）' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '刷新列表' })).toBeEnabled()

    // 默认分组且全部收起：三个批次 header 可见，作答行不可见。
    const headers = batchHeaderButtons()
    expect(headers).toHaveLength(3)
    expect(headers.every((header) => header.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(screen.queryAllByRole('table')).toHaveLength(0)
    expect(screen.queryByText('张三')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开全部' })).toBeInTheDocument()
  })
})

describe('已结算视图：关键词搜索', () => {
  it('输入关键词即时过滤并显示清除按钮与 chip', async () => {
    await renderSettledView()

    fireEvent.change(searchInput(), { target: { value: '  张三  ' } })

    expect(
      screen.getByText('已结算 8 份 · 筛选结果 1 份 · 平均 8.0 分 · 最高 8 分')
    ).toBeInTheDocument()
    expect(screen.getByText('张三')).toBeInTheDocument()
    expect(screen.queryByText('李四')).not.toBeInTheDocument()
    expect(screen.getByText('搜索“张三”')).toBeInTheDocument()
    expect(screen.getByLabelText('已启用的筛选条件')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))

    expect(screen.getByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByLabelText('已启用的筛选条件')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除搜索' })).not.toBeInTheDocument()
  })

  it('无命中时显示空态、禁用导出并允许清除全部筛选', async () => {
    await renderSettledView()

    fireEvent.change(searchInput(), { target: { value: '不存在的考生' } })

    expect(await screen.findByText('没有符合条件的已结算作答。')).toBeInTheDocument()
    expect(
      screen.getByText('已结算 8 份 · 筛选结果 0 份 · 平均 — 分 · 最高 — 分')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出筛选报告（0）' })).toBeDisabled()

    // chips 行与空态区各有一个“清除全部筛选”。
    expect(screen.getAllByRole('button', { name: '清除全部筛选' })).toHaveLength(2)
    const emptyState = screen.getByLabelText('筛选结果为空')
    fireEvent.click(within(emptyState).getByRole('button', { name: '清除全部筛选' }))

    expect(await screen.findByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByText('没有符合条件的已结算作答。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出筛选报告（8）' })).toBeEnabled()
  })
})

describe('已结算视图：结算日期筛选', () => {
  it('预设与自定义区间生效，custom 自动展开更多筛选', async () => {
    await renderSettledView()

    fireEvent.change(screen.getByLabelText('结算日期筛选'), { target: { value: 'today' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 3 份 · 平均 7.3 分 · 最高 9 分')
    ).toBeInTheDocument()
    expect(screen.getByText('结算日期：今天')).toBeInTheDocument()
    expect(batchHeaderButtons()).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('结算日期筛选'), { target: { value: 'last-7-days' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 5 份 · 平均 7.1 分 · 最高 9 分')
    ).toBeInTheDocument()
    expect(screen.getByText('结算日期：近 7 天')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('结算日期筛选'), { target: { value: 'custom' } })
    // 选自定义区间时高级面板自动展开。
    expect(await screen.findByLabelText('更多筛选条件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起筛选' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('结算开始日期'), {
      target: { value: localDateKey(3) }
    })
    fireEvent.change(screen.getByLabelText('结算结束日期'), {
      target: { value: localDateKey(0) }
    })
    expect(
      await screen.findByText(`已结算 8 份 · 筛选结果 5 份 · 平均 7.1 分 · 最高 9 分`)
    ).toBeInTheDocument()
    expect(
      screen.getByText(`结算日期：${localDateKey(3)} 至 ${localDateKey(0)}`)
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('结算日期筛选'), { target: { value: 'all' } })
    expect(await screen.findByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByText(/^结算日期：/)).not.toBeInTheDocument()
  })
})

describe('已结算视图：批次多选与试卷筛选', () => {
  it('批次面板只按需渲染，多选即时过滤并支持清除选择', async () => {
    await renderSettledView()

    expect(screen.queryByRole('listbox', { name: '批次选项' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批次筛选' }))
    const listbox = await screen.findByRole('listbox', { name: '批次选项' })
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true')
    expect(within(listbox).getAllByRole('checkbox')).toHaveLength(3)

    fireEvent.click(within(listbox).getByRole('checkbox', { name: /批次 2/ }))
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 2 份 · 平均 6.8 分 · 最高 7.5 分')
    ).toBeInTheDocument()
    expect(screen.getByText('批次：批次 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批次筛选' })).toHaveTextContent('批次：1 个已选')
    // 筛选激活后命中批次自动展开，行内容可见。
    const expandedHeader = batchHeaderButtons()[0]
    expect(expandedHeader).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('赵六')).toBeInTheDocument()
    expect(screen.queryByText('张三')).not.toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole('listbox', { name: '批次选项' })).getByRole('checkbox', {
        name: /批次 1/
      })
    )
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 5 份 · 平均 7.3 分 · 最高 10 分')
    ).toBeInTheDocument()
    expect(screen.getByText('批次：批次 2、批次 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批次筛选' })).toHaveTextContent('批次：2 个已选')

    fireEvent.click(screen.getByRole('button', { name: '清除批次选择' }))
    expect(await screen.findByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批次筛选' })).toHaveTextContent('全部批次')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('listbox', { name: '批次选项' })).not.toBeInTheDocument()
    )
  })

  it('试卷下拉列出全部试卷选项并按试卷全等过滤', async () => {
    await renderSettledView()

    const examSelect = screen.getByLabelText('试卷筛选')
    expect(
      within(examSelect)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['全部试卷', '期末考试', '英语口语'])

    fireEvent.change(examSelect, { target: { value: '英语口语' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 2 份 · 平均 6.8 分 · 最高 7.5 分')
    ).toBeInTheDocument()
    expect(screen.getByText('试卷：英语口语')).toBeInTheDocument()
    expect(screen.getByText('赵六')).toBeInTheDocument()
    expect(screen.queryByText('张三')).not.toBeInTheDocument()
  })
})

describe('已结算视图：更多筛选条件', () => {
  it('作答日期范围按闭区间过滤', async () => {
    await renderSettledView()
    const panel = openAdvancedFilters()
    expect(screen.getByRole('button', { name: '收起筛选' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(within(panel).getByText('结算日期范围')).toBeInTheDocument()
    expect(within(panel).getByText('作答日期范围')).toBeInTheDocument()
    expect(within(panel).getByText('分数区间')).toBeInTheDocument()

    fireEvent.change(within(panel).getByLabelText('作答开始日期'), {
      target: { value: localDateKey(4) }
    })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 5 份 · 平均 7.1 分 · 最高 9 分')
    ).toBeInTheDocument()

    fireEvent.change(within(panel).getByLabelText('作答结束日期'), {
      target: { value: localDateKey(0) }
    })
    expect(
      screen.getByText(`作答日期：${localDateKey(4)} 至 ${localDateKey(0)}`)
    ).toBeInTheDocument()

    fireEvent.change(within(panel).getByLabelText('作答开始日期'), {
      target: { value: localDateKey(0) }
    })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 1 份 · 平均 8.0 分 · 最高 8 分')
    ).toBeInTheDocument()
    expect(screen.getByText('张三')).toBeInTheDocument()
    expect(screen.queryByText('李四')).not.toBeInTheDocument()
  })

  it('分数区间过滤并在 chip 中区分下限、上限和区间', async () => {
    await renderSettledView()
    const panel = openAdvancedFilters()

    const minScore = within(panel).getByLabelText('最低分')
    const maxScore = within(panel).getByLabelText('最高分')
    expect(minScore).toHaveAttribute('placeholder', '不限')
    expect(minScore).toHaveAttribute('type', 'number')
    expect(maxScore).toHaveAttribute('placeholder', '不限')

    fireEvent.change(minScore, { target: { value: '8' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 4 份 · 平均 9.0 分 · 最高 10 分')
    ).toBeInTheDocument()
    expect(screen.getByText('分数：≥ 8')).toBeInTheDocument()

    fireEvent.change(maxScore, { target: { value: '9' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 3 份 · 平均 8.7 分 · 最高 9 分')
    ).toBeInTheDocument()
    expect(screen.getByText('分数：8–9')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移除筛选条件：分数：8–9' }))
    expect(await screen.findByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByLabelText('已启用的筛选条件')).not.toBeInTheDocument()
  })
})

describe('已结算视图：条件 chips 与清除', () => {
  it('逐项移除 chip 只清除对应条件，清除全部筛选恢复默认', async () => {
    await renderSettledView()
    fireEvent.change(screen.getByLabelText('试卷筛选'), { target: { value: '英语口语' } })
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 2 份 · 平均 6.8 分 · 最高 7.5 分')
    ).toBeInTheDocument()

    const panel = openAdvancedFilters()
    fireEvent.change(within(panel).getByLabelText('最低分'), { target: { value: '6' } })
    expect(await screen.findByText('试卷：英语口语')).toBeInTheDocument()
    expect(screen.getByText('分数：≥ 6')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移除筛选条件：试卷：英语口语' }))
    expect(
      await screen.findByText('已结算 8 份 · 筛选结果 6 份 · 平均 8.3 分 · 最高 10 分')
    ).toBeInTheDocument()
    expect(screen.queryByText('试卷：英语口语')).not.toBeInTheDocument()
    expect(screen.getByText('分数：≥ 6')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '清除全部筛选' }))
    expect(await screen.findByText(FULL_SUMMARY)).toBeInTheDocument()
    expect(screen.queryByLabelText('已启用的筛选条件')).not.toBeInTheDocument()
    expect(screen.getByLabelText('试卷筛选')).toHaveValue('')
  })
})

describe('已结算视图：排序与分组/列表视图', () => {
  it('分组与列表视图切换，列表视图可排序', async () => {
    await renderSettledView()

    fireEvent.click(screen.getByRole('button', { name: '列表显示' }))
    expect(screen.getByRole('button', { name: '分组显示' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: '列表显示' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('columnheader', { name: '作答人' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '结算时间' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '得分' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /结算于/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '展开全部' })).not.toBeInTheDocument()

    expect(flatCandidateNames()).toEqual([
      '张三',
      '李四',
      '王五',
      '赵六',
      '钱七',
      '孙八',
      '周九',
      '吴十'
    ])

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'score-desc' } })
    expect(flatCandidateNames()).toEqual([
      '吴十',
      '李四',
      '周九',
      '张三',
      '钱七',
      '赵六',
      '王五',
      '孙八'
    ])

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'score-asc' } })
    expect(flatCandidateNames()).toEqual([
      '孙八',
      '王五',
      '赵六',
      '钱七',
      '张三',
      '李四',
      '周九',
      '吴十'
    ])

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'name-asc' } })
    expect(flatCandidateNames()).toEqual([
      '李四',
      '钱七',
      '孙八',
      '王五',
      '吴十',
      '张三',
      '赵六',
      '周九'
    ])

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'settled-asc' } })
    expect(flatCandidateNames()).toEqual([
      '孙八',
      '周九',
      '吴十',
      '赵六',
      '钱七',
      '张三',
      '李四',
      '王五'
    ])

    fireEvent.click(screen.getByRole('button', { name: '分组显示' }))
    expect(batchHeaderButtons()).toHaveLength(3)
    expect(screen.getByRole('button', { name: '分组显示' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('已结算视图：批次展开与筛选联动', () => {
  it('展开全部/收起全部作用于当前结果，筛选时命中批次自动展开', async () => {
    await renderSettledView()

    fireEvent.click(screen.getByRole('button', { name: '展开全部' }))
    expect(
      batchHeaderButtons().every((header) => header.getAttribute('aria-expanded') === 'true')
    ).toBe(true)
    expect(screen.getAllByRole('table')).toHaveLength(3)
    expect(screen.getAllByRole('row')).toHaveLength(11)
    expect(screen.getByRole('button', { name: '收起全部' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '收起全部' }))
    expect(screen.queryAllByRole('table')).toHaveLength(0)
    expect(screen.getByRole('button', { name: '展开全部' })).toBeInTheDocument()

    fireEvent.change(searchInput(), { target: { value: '张三' } })
    const headers = batchHeaderButtons()
    expect(headers).toHaveLength(1)
    expect(headers[0]).toHaveAttribute('aria-expanded', 'true')
    expect(headers[0]).toHaveTextContent('命中 1/3 条作答')
    expect(headers[0]).toHaveTextContent('批次 3')
    expect(headers[0]).toHaveTextContent('结算于')

    // 既有展开后的批次工具条与行内操作保持不变。
    expect(screen.getByRole('button', { name: '导出批次报告' })).toBeInTheDocument()
    for (const actionName of ['查看报告', '重新评分', '导出报告', '导出作答包', '删除作答记录']) {
      expect(screen.getByRole('button', { name: actionName })).toBeInTheDocument()
    }
  })
})

describe('已结算视图：导出筛选报告', () => {
  it('按当前筛选结果批量导出报告', async () => {
    const exportBatch = vi.fn().mockResolvedValue({
      status: 'exported',
      exportedCount: 2,
      failures: []
    } satisfies ReportExportResult)
    window.reportExport = bridgeWith(exportBatch)
    await renderSettledView()

    fireEvent.change(screen.getByLabelText('试卷筛选'), { target: { value: '英语口语' } })
    const exportButton = await screen.findByRole('button', { name: '导出筛选报告（2）' })
    expect(exportButton).toBeEnabled()
    fireEvent.click(exportButton)

    await waitFor(() => expect(exportBatch).toHaveBeenCalledOnce())
    const request = exportBatch.mock.calls[0][0] as {
      items: Array<{ filename: string; html: string }>
    }
    expect(request.items.map((item) => item.filename)).toEqual([
      '赵六-C-0004-报告.pdf',
      '钱七-C-0005-报告.pdf'
    ])
    expect(request.items[0].html).toContain('mid-zhao')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '导出筛选报告（2）' })).toBeEnabled()
  })
})
