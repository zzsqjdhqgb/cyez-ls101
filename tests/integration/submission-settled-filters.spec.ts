import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { encodeSubmissionPackage } from '@ls101/exam-package'
import { zipSync } from 'fflate'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTemporaryDirectory } from '../support/temporary-directory'
import { closeStartupReleaseNotes, launchIntegrationApp } from './support/electron-app'

/**
 * 端到端覆盖「作答记录 / 已结算」视图的筛选与搜索界面。
 *
 * 数据准备：一次导入 9 份纯客观题作答包（一个外层 ZIP），再分 3 批、每批 3 份结算，
 * 通过 page.clock.setFixedTime 固定每批的 settledAt（2026-01-10 / 2026-02-14 / 2026-03-20），
 * 让已结算日期预设、批次筛选、排序等断言可复现。
 */

const SCREENSHOT_DIR = path.join(process.cwd(), 'test-results', 'settled-filters')
const CONTENT_SIZE = { width: 1280, height: 800 } as const

interface SeedSubmission {
  name: string
  candidateId: string
  examTitle: string
  submittedAt: string
  maxScore: number
  correct: boolean
}

interface SeedBatch {
  /** 页内 Date 的本地时间（不带时区后缀，按运行机器时区解释）。 */
  settledAt: string
  submissions: readonly SeedSubmission[]
}

const EXAM_A = '八年级英语听说练习'
const EXAM_B = '九年级英语模拟'
const EXAM_C = '八年级英语听力'

/** 从旧到新创建；已结算列表按 settledAt 倒序展示，所以最后一批显示为「批次 3」。 */
const SEED_BATCHES: readonly SeedBatch[] = [
  {
    settledAt: '2026-01-10T10:00:00',
    submissions: [
      {
        name: '周涛',
        candidateId: '2026007',
        examTitle: EXAM_A,
        submittedAt: '2025-12-15T09:00:00Z',
        maxScore: 10,
        correct: true
      },
      {
        name: '吴敏',
        candidateId: '2026008',
        examTitle: EXAM_B,
        submittedAt: '2025-12-20T09:00:00Z',
        maxScore: 8,
        correct: true
      },
      {
        name: '郑爽',
        candidateId: '2026009',
        examTitle: EXAM_C,
        submittedAt: '2026-01-05T09:00:00Z',
        maxScore: 6,
        correct: false
      }
    ]
  },
  {
    settledAt: '2026-02-14T10:00:00',
    submissions: [
      {
        name: '赵宁',
        candidateId: '2026004',
        examTitle: EXAM_A,
        submittedAt: '2026-01-20T09:00:00Z',
        maxScore: 5,
        correct: true
      },
      {
        name: '陈晨',
        candidateId: '2026005',
        examTitle: EXAM_B,
        submittedAt: '2026-02-01T09:00:00Z',
        maxScore: 4,
        correct: false
      },
      {
        name: '孙悦',
        candidateId: '2026006',
        examTitle: EXAM_C,
        submittedAt: '2026-02-10T09:00:00Z',
        maxScore: 10,
        correct: true
      }
    ]
  },
  {
    settledAt: '2026-03-20T10:00:00',
    submissions: [
      {
        name: '张明',
        candidateId: '2026001',
        examTitle: EXAM_A,
        submittedAt: '2026-03-01T09:00:00Z',
        maxScore: 10,
        correct: true
      },
      {
        name: '李华',
        candidateId: '2026002',
        examTitle: EXAM_B,
        submittedAt: '2026-03-05T09:00:00Z',
        maxScore: 6,
        correct: false
      },
      {
        name: '王芳',
        candidateId: '2026003',
        examTitle: EXAM_C,
        submittedAt: '2026-03-15T09:00:00Z',
        maxScore: 8,
        correct: true
      }
    ]
  }
]

test.describe.configure({ timeout: 120_000 })

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let pageErrors: string[] = []

test.beforeEach(async () => {
  pageErrors = []
  userDataDir = await createTemporaryDirectory('ls101-settled-filters-')
  electronApp = await launchIntegrationApp(userDataDir, {
    contentSize: CONTENT_SIZE,
    deviceScaleFactor: 1,
    extraArgs: ['--disable-gpu'],
    randomSeed: 1
  })
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await closeStartupReleaseNotes(page)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  await mkdir(SCREENSHOT_DIR, { recursive: true })
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test('已结算视图：导入 9 份客观题、结算三个批次并验证筛选与搜索界面', async () => {
  await page.getByRole('link', { name: '作答记录' }).click()

  const bundlePath = path.join(userDataDir, 'settled-bundle.zip')
  await writeFile(bundlePath, await encodeSeedBundle())
  await installOpenDialog([bundlePath])

  await page.getByRole('button', { name: '导入作答包' }).click()
  await expect(page.getByRole('checkbox', { name: /^选择 .+ 的作答$/ })).toHaveCount(9)
  await expect(page.getByRole('tab', { name: /未结算/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: /未结算/ })).toHaveText(/未结算\s*9/)

  for (const [index, batch] of SEED_BATCHES.entries()) {
    await settleBatch(batch, index)
  }

  // 三个批次全部落在「已结算」视图。
  await expect(page.getByRole('tab', { name: /已结算/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: /已结算/ })).toHaveText(/已结算\s*9/)

  const headers = page.getByRole('button', { name: /结算于 .+ 3 条作答 批次 \d/ })
  await expect(headers).toHaveCount(3)

  // 最新的批次 3 由结算后跳转自动展开，保持既有批次头/行内操作文案不变。
  const [latest] = [...SEED_BATCHES].reverse()
  await expect(
    page.getByRole('button', {
      name: settlementHeaderPattern(3, latest!.settledAt)
    })
  ).toBeVisible()
  await expect(page.getByText('批次 1', { exact: true })).toBeVisible()
  await expect(page.getByText('批次 2', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: '导出批次报告' })).toBeVisible()
  for (const submission of latest!.submissions) {
    await expect(page.getByRole('row').filter({ hasText: submission.name })).toHaveCount(1)
  }
  await expect(page.getByRole('button', { name: '查看报告', exact: true })).toHaveCount(3)
  await expect(page.getByRole('button', { name: '重新评分', exact: true })).toHaveCount(3)
  await expect(page.getByRole('button', { name: '导出报告', exact: true })).toHaveCount(3)
  await expect(page.getByRole('button', { name: '导出作答包', exact: true })).toHaveCount(3)
  await expect(page.getByRole('button', { name: '删除作答记录', exact: true })).toHaveCount(3)

  await takeScreenshot('phase1-settled.png')

  // ---------- 阶段 2：已结算筛选与搜索界面 ----------
  // 三相结算把页面时钟留在 2026-03-20；这里固定为 2026-04-10 作为「今天」，
  // 使「近 30 天」命中批次 3、「近 7 天」为空，统计断言可复现。
  const filterBar = page.locator('section[aria-label="已结算筛选"]')
  const chipBar = page.locator('[aria-label="已启用的筛选条件"]')
  const searchInput = page.getByLabel('搜索已结算作答')
  const settlementPreset = page.getByLabel('结算日期筛选')
  const viewToggle = page.getByRole('group', { name: '显示方式' })

  // 总览：筛选栏默认值、统计文案与结果条按钮
  await expect(filterBar).toBeVisible()
  await expect(searchInput).toHaveAttribute('placeholder', '搜索姓名、考生号、试卷或批次')
  await expect(searchInput).toHaveValue('')
  await expect(settlementPreset).toHaveValue('all')
  await expect(page.getByLabel('试卷筛选')).toHaveValue('')
  await expect(page.getByLabel('排序方式')).toHaveValue('settled-desc')
  await expect(page.getByRole('button', { name: '批次筛选' })).toContainText('全部批次')
  await expect(page.getByRole('button', { name: '更多筛选' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(viewToggle.getByRole('button', { name: '分组显示' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(viewToggle.getByRole('button', { name: '列表显示' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await expect(page.getByRole('button', { name: '展开全部', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '导出筛选报告（9）' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '刷新列表' })).toBeVisible()
  await expect(chipBar).toHaveCount(0)
  await expectSummary(9, '5.7', '10')
  await expect(page.getByRole('tab', { name: /已结算/ })).toHaveText(/已结算\s*9/)
  await takeScreenshot('overview-filter-bar.png')

  // 关键词：姓名（命中 1 份，批次 3 自动展开并显示命中数）
  await searchInput.fill('张明')
  await expectSummary(1, '10.0', '10')
  await expect(chipBar).toContainText('搜索“张明”')
  await expect(page.getByRole('button', { name: '清除搜索' })).toBeVisible()
  await expect(
    page.getByRole('button', {
      name: settledHeaderMatcher(3, latest!.settledAt, '命中 1/3 条作答')
    })
  ).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(1)
  await expect(page.getByText('李华', { exact: true })).toHaveCount(0)
  await takeScreenshot('keyword-search.png')

  // 关键词：试卷名（三批各命中 1 份，三个批次都自动展开）
  await searchInput.fill('九年级')
  await expectSummary(3, '2.7', '8')
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  for (const name of ['李华', '陈晨', '吴敏']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expect(searchInput).toHaveValue('')
  await expectSummary(9, '5.7', '10')
  await expect(chipBar).toHaveCount(0)

  // 结算日期预设：以 2026-04-10 为「今天」，「近 30 天」命中批次 3
  await page.clock.setFixedTime(new Date('2026-04-10T10:00:00'))
  await settlementPreset.selectOption('last-30-days')
  await expectSummary(3, '6.0', '10')
  await expect(chipBar).toContainText('结算日期：近 30 天')
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  await expect(
    page.getByRole('button', { name: settledHeaderMatcher(3, latest!.settledAt, '3 条作答') })
  ).toBeVisible()
  await takeScreenshot('settlement-date-preset.png')

  // 筛选空态：「近 7 天」无命中，chips 行与空态各有一个「清除全部筛选」
  await settlementPreset.selectOption('last-7-days')
  await expectSummary(0, '—', '—')
  await expect(page.getByText('没有符合条件的已结算作答。')).toBeVisible()
  await expect(page.locator('[aria-label="筛选结果为空"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '清除全部筛选' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: '导出筛选报告（0）' })).toBeDisabled()
  await expect(page.locator('table')).toHaveCount(0)
  await takeScreenshot('filtered-empty.png')
  await page
    .locator('[aria-label="筛选结果为空"]')
    .getByRole('button', { name: '清除全部筛选' })
    .click()
  await expectSummary(9, '5.7', '10')
  await expect(chipBar).toHaveCount(0)
  await expect(settlementPreset).toHaveValue('all')

  // 更多筛选：自定义结算日期区间 → 批次 1+2（6 份），preset 自动切到 custom
  await page.getByRole('button', { name: '更多筛选' }).click()
  await expect(page.getByRole('button', { name: '收起筛选' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  const advanced = page.locator('[aria-label="更多筛选条件"]')
  await expect(advanced).toBeVisible()
  for (const heading of ['结算日期范围', '作答日期范围', '分数区间']) {
    await expect(advanced.getByText(heading, { exact: true })).toBeVisible()
  }
  for (const label of [
    '结算开始日期',
    '结算结束日期',
    '作答开始日期',
    '作答结束日期',
    '最低分',
    '最高分'
  ]) {
    await expect(page.getByLabel(label)).toBeVisible()
  }
  await page.getByLabel('结算开始日期').fill('2026-01-01')
  await page.getByLabel('结算结束日期').fill('2026-02-28')
  await expect(settlementPreset).toHaveValue('custom')
  await expectSummary(6, '5.5', '10')
  await expect(chipBar).toContainText('结算日期：2026-01-01 至 2026-02-28')
  await expect(page.locator('table tbody tr')).toHaveCount(6)

  // 追加作答日期区间：陈晨、孙悦共 2 份，两个 chip 同时生效
  await page.getByLabel('作答开始日期').fill('2026-02-01')
  await page.getByLabel('作答结束日期').fill('2026-02-28')
  await expectSummary(2, '5.0', '10')
  await expect(chipBar).toContainText('作答日期：2026-02-01 至 2026-02-28')
  await takeScreenshot('chips.png')

  // 移除单个 chip 只清除对应条件
  await page
    .getByRole('button', { name: '移除筛选条件：结算日期：2026-01-01 至 2026-02-28' })
    .click()
  await expect(page.getByLabel('结算开始日期')).toHaveValue('')
  await expect(page.getByLabel('作答开始日期')).toHaveValue('2026-02-01')
  await expect(chipBar).toContainText('作答日期：2026-02-01 至 2026-02-28')
  await expect(chipBar).not.toContainText('结算日期：')
  await expectSummary(2, '5.0', '10')
  await chipBar.getByRole('button', { name: '清除全部筛选' }).click()
  await expectSummary(9, '5.7', '10')
  await expect(chipBar).toHaveCount(0)

  // 分数区间（高级面板）：≥6 → 5 份；6–9 → 2 份
  await page.getByLabel('最低分').fill('6')
  await expectSummary(5, '9.2', '10')
  await expect(chipBar).toContainText('分数：≥ 6')
  await page.getByLabel('最高分').fill('9')
  await expectSummary(2, '8.0', '8')
  await expect(chipBar).toContainText('分数：6–9')
  await expect(
    page.getByRole('button', {
      name: settledHeaderMatcher(3, latest!.settledAt, '命中 1/3 条作答')
    })
  ).toBeVisible()
  await expect(page.getByText('王芳', { exact: true })).toBeVisible()
  await takeScreenshot('score-filter.png')
  await page.getByRole('button', { name: '移除筛选条件：分数：6–9' }).click()
  await expectSummary(9, '5.7', '10')
  await expect(page.getByLabel('最低分')).toHaveValue('')
  await page.getByRole('button', { name: '收起筛选' }).click()
  await expect(advanced).toHaveCount(0)

  // 批次多选：批次 2 → 3 份；再加批次 1 → 6 份
  await page.getByRole('button', { name: '批次筛选' }).click()
  const batchListbox = page.getByRole('listbox', { name: '批次选项' })
  await expect(batchListbox).toBeVisible()
  await expect(batchListbox).toHaveAttribute('aria-multiselectable', 'true')
  await expect(batchListbox.getByRole('checkbox')).toHaveCount(3)
  await expect(
    batchListbox.getByRole('checkbox', {
      name: /批次 3.*结算于 2026\/03\/20 10:00.*3 份作答/
    })
  ).toBeVisible()
  await batchListbox.getByRole('checkbox', { name: /批次 2/ }).check()
  await expectSummary(3, '5.0', '10')
  await expect(page.getByRole('button', { name: '批次筛选' })).toContainText('批次：1 个已选')
  await expect(chipBar).toContainText('批次：批次 2')
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '清除批次选择' })).toBeVisible()
  await takeScreenshot('batch-filter.png')
  await batchListbox.getByRole('checkbox', { name: /批次 1/ }).check()
  await expectSummary(6, '5.5', '10')
  await expect(chipBar).toContainText('批次：批次 2、批次 1')
  await expect(page.getByRole('button', { name: '批次筛选' })).toContainText('批次：2 个已选')
  await page.getByRole('button', { name: '清除批次选择' }).click()
  await expectSummary(9, '5.7', '10')
  await expect(page.getByRole('button', { name: '批次筛选' })).toContainText('全部批次')
  await page.keyboard.press('Escape')
  await expect(batchListbox).toHaveCount(0)

  // 试卷筛选：九年级英语模拟 → 3 份（李华、陈晨、吴敏）
  await page.getByLabel('试卷筛选').selectOption('九年级英语模拟')
  await expectSummary(3, '2.7', '8')
  await expect(chipBar).toContainText('试卷：九年级英语模拟')
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  await expect(
    page.getByRole('button', {
      name: settledHeaderMatcher(3, latest!.settledAt, '命中 1/3 条作答')
    })
  ).toBeVisible()
  await takeScreenshot('exam-filter.png')
  await chipBar.getByRole('button', { name: '清除全部筛选' }).click()
  await expectSummary(9, '5.7', '10')
  await expect(chipBar).toHaveCount(0)

  // 列表视图 + 排序：平铺 9 行，结算时间列含批次与时间两行
  await viewToggle.getByRole('button', { name: '列表显示' }).click()
  await expect(viewToggle.getByRole('button', { name: '列表显示' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.getByRole('button', { name: '展开全部', exact: true })).toHaveCount(0)
  const flatRows = page.locator('table tbody tr')
  await expect(flatRows).toHaveCount(9)
  const flatHeader = page.locator('table thead tr')
  for (const column of ['作答人', '试卷', '结算时间', '得分', '作答时间']) {
    await expect(flatHeader).toContainText(column)
  }
  await expect(page.locator('table thead th[aria-label="操作"]')).toHaveCount(1)
  await expect(flatRows.first()).toContainText('张明')
  await expect(flatRows.first()).toContainText('批次 3')
  await expect(flatRows.first()).toContainText(`结算于 ${formatDateTime(latest!.settledAt)}`)
  await expect(flatRows.first()).toContainText('10/10')
  await page.getByLabel('排序方式').selectOption('score-desc')
  await expect(flatRows.first()).toContainText('张明')
  await expect(flatRows.first()).toContainText('10/10')
  await takeScreenshot('list-view-sort.png')
  await page.getByLabel('排序方式').selectOption('score-asc')
  await expect(flatRows.first()).toContainText('李华')
  await expect(flatRows.first()).toContainText('0/6')
  await viewToggle.getByRole('button', { name: '分组显示' }).click()
  await page.getByLabel('排序方式').selectOption('settled-desc')
  await expect(viewToggle.getByRole('button', { name: '分组显示' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  // 展开全部 / 收起全部（无筛选、分组视图）
  await expect(page.locator('table tbody tr')).toHaveCount(3)
  await page.getByRole('button', { name: '展开全部', exact: true }).click()
  await expect(page.getByRole('button', { name: '收起全部', exact: true })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(9)
  await page.getByRole('button', { name: '收起全部', exact: true }).click()
  await expect(page.locator('table tbody tr')).toHaveCount(0)

  // 刷新列表：保留当前筛选条件
  await searchInput.fill('王芳')
  await expectSummary(1, '8.0', '8')
  await page.getByRole('button', { name: '刷新列表' }).click()
  await expectSummary(1, '8.0', '8')
  await expect(chipBar).toContainText('搜索“王芳”')
  await page.getByRole('button', { name: '清除搜索' }).click()
  await expectSummary(9, '5.7', '10')

  // 既有批次头/行内操作文案保持不变
  await expect(page.getByText('批次 1', { exact: true })).toBeVisible()
  await expect(page.getByText('批次 2', { exact: true })).toBeVisible()
  const batch2Header = page.getByRole('button', {
    name: settledHeaderMatcher(2, SEED_BATCHES[1].settledAt, '3 条作答')
  })
  await batch2Header.click()
  await expect(page.getByRole('button', { name: '导出批次报告' })).toBeVisible()
  const chenChenRow = page.getByRole('row').filter({ hasText: '陈晨' })
  for (const action of ['查看报告', '重新评分', '导出报告', '导出作答包', '删除作答记录']) {
    await expect(chenChenRow.getByRole('button', { name: action, exact: true })).toBeVisible()
  }
  await batch2Header.click()
  await expect(page.locator('table')).toHaveCount(0)

  // 不把内部 batchId 原始值暴露在界面上
  await expect(
    page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  ).toHaveCount(0)
})

/** 页面区块有入场动画（opacity 0 起步），截图前等动画结束，避免拍到空白快照。 */
async function waitForUiAnimations(): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined))
    )
  })
}

async function takeScreenshot(name: string): Promise<void> {
  await waitForUiAnimations()
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, name), fullPage: true })
}

/** 结果条统计文案：已结算 {total} 份 · 筛选结果 {filtered} 份 · 平均 {avg} 分 · 最高 {max} 分 */
async function expectSummary(count: number, average: string, highest: string): Promise<void> {
  await expect(
    page.getByText(`已结算 9 份 · 筛选结果 ${count} 份 · 平均 ${average} 分 · 最高 ${highest} 分`, {
      exact: true
    })
  ).toBeVisible()
}

/** 批次 header 按钮的 accessible name：结算于 {时间} {N 条作答|命中 m/N 条作答} 批次 {n} */
function settledHeaderMatcher(batchNumber: number, settledAt: string, recordText: string): RegExp {
  return new RegExp(
    `结算于 ${escapeRegExp(formatDateTime(settledAt))} ${escapeRegExp(recordText)} 批次 ${batchNumber}`
  )
}

async function settleBatch(batch: SeedBatch, batchIndex: number): Promise<void> {
  await page.getByRole('tab', { name: /未结算/ }).click()
  for (const submission of batch.submissions) {
    await page.getByRole('checkbox', { name: `选择 ${submission.name} 的作答` }).check()
  }

  const gradeButton = page.getByRole('button', {
    name: `开始评分（${batch.submissions.length}）`
  })
  await expect(gradeButton).toBeEnabled()
  await gradeButton.click()

  // 纯客观题作答在 preflight 阶段就会自动完成评分并跳转到结算页。
  await expect(page.getByRole('heading', { name: '评分结算' })).toBeVisible({ timeout: 20_000 })

  const settleButton = page.getByRole('button', {
    name: `本次结算（${batch.submissions.length}）`
  })
  await expect(settleButton).toBeEnabled()
  await page.clock.setFixedTime(new Date(batch.settledAt))
  await settleButton.click()

  await expect(page.getByRole('tab', { name: /已结算/ })).toHaveAttribute('aria-selected', 'true')
  await expect(
    page.getByRole('button', {
      name: settlementHeaderPattern(batchIndex + 1, batch.settledAt)
    })
  ).toBeVisible({ timeout: 20_000 })
}

async function installOpenDialog(filePaths: string[]): Promise<void> {
  await electronApp.evaluate(({ dialog }, paths) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({
        canceled: false,
        filePaths: [paths[0]]
      })
    })
  }, filePaths)
}

function settlementHeaderPattern(batchNumber: number, settledAt: string): RegExp {
  return settledHeaderMatcher(batchNumber, settledAt, '3 条作答')
}

/** 与 SubmissionLibraryPage 内 formatDateTime 相同的格式化规则。 */
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function encodeSeedBundle(): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  let index = 0
  for (const batch of SEED_BATCHES) {
    for (const submission of batch.submissions) {
      index += 1
      const pkg = buildSubmissionPackage(submission, index)
      files[`${pkg.meta.submissionId}.lssubmission`] = await encodeSubmissionPackage(pkg, {})
    }
  }
  return zipSync(files)
}

function buildSubmissionPackage(submission: SeedSubmission, index: number): SubmissionPackage {
  const submissionId = `submission-settled-${submission.candidateId}`
  const answerIndex = submission.correct ? 0 : 1
  return {
    format: 'ls101-submission',
    formatVersion: 1,
    meta: {
      submissionId,
      examPackageId: 'exam-settled-filters-e2e',
      examTitle: submission.examTitle,
      candidate: { candidateId: submission.candidateId, displayName: submission.name },
      startedAt: new Date(Date.parse(submission.submittedAt) - 20 * 60 * 1000).toISOString(),
      submittedAt: submission.submittedAt
    },
    answers: { strings: ['A', 'B'], audios: [] },
    schemaUses: [
      {
        instanceId: 'objective-use',
        schema: objectiveSchema(submission, index),
        inputs: [
          { inputId: 'question-description', type: 'text', value: '请选择正确答案。' },
          { inputId: 'correct-answer', type: 'text', value: 'A' },
          { inputId: 'analysis', type: 'text', value: '正确答案为 A。' }
        ],
        answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: answerIndex }]
      }
    ],
    resources: {}
  }
}

function objectiveSchema(submission: SeedSubmission, index: number): SchemaDefinition {
  return {
    formatVersion: 2,
    schemaId: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sourceDraftId: `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    structureHash: `sha256:${String(index).padStart(2, '0').repeat(32)}`,
    revision: 0,
    structure: {
      questionType: 'objective',
      answerFormat: [{ answerId: 'answer', type: 'text' }],
      templateInputs: [
        { inputId: 'question-description', type: 'text', required: true },
        { inputId: 'correct-answer', type: 'text', required: true },
        { inputId: 'analysis', type: 'text', required: false }
      ]
    },
    data: {
      name: `${submission.name}的客观题`,
      description: '客观题评分',
      maxScore: submission.maxScore,
      answerDescriptions: { answer: '选择答案' },
      inputDescriptions: {},
      rubricMarkdown: ''
    }
  }
}
