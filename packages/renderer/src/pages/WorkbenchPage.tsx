/**
 * 工作台首页：只读汇总各业务库状态，提供常用入口与最近工作跳转。
 *
 * 数据来自渲染进程经 window.fileStore IPC 桥访问主进程文件存储的各库单例
 * （试卷库、作答库、题型库、模板库、评分单元库），本页不写入任何业务数据。
 * 首屏并行拉取全部统计值，任一请求失败时保留空快照，只把提示切为
 * 「部分状态暂不可用」，不展示半份统计，以免维护者误判数据完整性。
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  ArrowRight,
  BookCheck,
  ClipboardCheck,
  FilePenLine,
  Inbox,
  LayoutTemplate,
  Play,
  Shapes
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useExamLibrary } from '../features/exams/ExamLibraryContext'
import { useInterfaceApplication } from '../features/interfaces/InterfaceApplicationContext'
import { useSchemaRepository } from '../features/schemas/SchemaApplicationContext'
import { useSubmissionLibrary } from '../features/submissions/SubmissionLibraryContext'
import { useTemplateApplication } from '../features/templates/TemplateApplicationContext'
import styles from './WorkbenchPage.module.css'

/**
 * 不同业务记录统一为工作台可展示、可跳转的最近工作条目。
 *
 * id 需跨库唯一（各库拼接时会自带前缀），path 必须是应用内路由路径，
 * 因为列表项会直接交给 react-router 的 navigate 处理。
 */
interface RecentWorkItem {
  id: string
  title: string
  detail: string
  status: string
  path: string
  icon: typeof Play
}

/**
 * 一次汇总加载得到的统计值与最近工作列表。
 *
 * 字段与 EMPTY_SNAPSHOT 完全对应：加载结束前保持全零，
 * 这些数字是否可信由 loading 标志决定。
 */
interface WorkbenchSnapshot {
  exams: number
  pendingSubmissions: number
  completedSubmissions: number
  interfaces: number
  interfaceDrafts: number
  templates: number
  schemas: number
  recent: RecentWorkItem[]
}

/**
 * 首屏占位快照，保证 snapshot 始终可读，避免在 JSX 中到处判空。
 * 它与「统计结果确实为零」在数据上无法区分，必须配合 loading 使用。
 */
const EMPTY_SNAPSHOT: WorkbenchSnapshot = {
  exams: 0,
  pendingSubmissions: 0,
  completedSubmissions: 0,
  interfaces: 0,
  interfaceDrafts: 0,
  templates: 0,
  schemas: 0,
  recent: []
}

/**
 * 快捷操作卡片配置；primary 只标记主操作，强调样式交给 CSS 决定。
 * icon 沿用 lucide 图标组件类型（typeof Play），由调用方负责传入组件本身。
 */
interface QuickAction {
  title: string
  detail: string
  path: string
  icon: typeof Play
  primary?: boolean
}

/**
 * 首页寄语候选集：纯静态文案，as const 使元素类型收窄为字面量。
 */
const WORKBENCH_QUOTES = [
  {
    text: 'Language is the dress of thought.',
    translation: '语言，是思想穿上的衣裳。',
    author: 'Samuel Johnson'
  },
  {
    text: 'The limits of my language mean the limits of my world.',
    translation: '语言的边界，也标记着世界的边界。',
    author: 'Ludwig Wittgenstein'
  },
  {
    text: 'A different language is a different vision of life.',
    translation: '换一种语言，也就换一种观看生活的方式。',
    author: 'Federico Fellini'
  },
  {
    text: 'Knowledge of languages is the doorway to wisdom.',
    translation: '懂得语言，便多了一扇通往智慧的门。',
    author: 'Roger Bacon'
  }
] as const

// 模块加载时随机选择寄语，避免组件重新渲染时反复切换。
// 索引访问用 ?? 作防御性回退；当前 tsconfig 未启用 noUncheckedIndexedAccess。
const STARTUP_QUOTE =
  WORKBENCH_QUOTES[Math.floor(Math.random() * WORKBENCH_QUOTES.length)] ?? WORKBENCH_QUOTES[0]

/** 汇总各业务库状态，展示常用入口、最近工作与作答评分进度。 */
export function WorkbenchPage(): JSX.Element {
  const navigate = useNavigate()
  // 下列业务库是模块级单例（见 features/*/*Runtime.ts），由各 *Context.tsx 作为
  // createContext 默认值提供；App.tsx 中的 Provider 不传 props，因此这里拿到的始终是
  // 同一引用，汇总 effect 的依赖实际上不会变化。
  const exams = useExamLibrary()
  const submissions = useSubmissionLibrary()
  const interfaces = useInterfaceApplication()
  const templates = useTemplateApplication()
  const schemas = useSchemaRepository()
  // loading 初始为 true：首帧只能显示占位符，不能把初始零值当成真实统计。
  // unavailable 仅表示汇总失败，页面静态内容与入口按钮仍然照常渲染。
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    // active 标记本次加载是否仍然有效：卸载或依赖变化后置为 false，
    // 后续回调据此丢弃结果，避免在已卸载组件上写状态或被旧请求覆盖。
    let active = true

    // 各库独立读取并行进行；任一请求失败时统一显示状态不可用提示。
    // 六个读取互不依赖，故全部并行发起；Promise.all 为快速失败语义，
    // 任一失败都会跳过 then 直接进入 catch，成功部分不单独展示。
    void Promise.all([
      // 试卷记录：用于统计总数，并取页面数/资源数生成简介。
      exams.listRecords(),
      // 作答条目：已附带评分与结算摘要，用于区分待评分与已完成。
      submissions.listEntries(),
      // 题型库区分已发布与草稿：状态栏只统计已发布，草稿单独计数。
      interfaces.browser.listPublished(),
      interfaces.browser.listDrafts(),
      // 评分单元只取数量；模板列表还会用于生成最近工作条目。
      templates.browser.listTemplates(),
      schemas.listSchemaIds()
    ])
      .then(
        ([
          examRecords,
          submissionEntries,
          publishedInterfaces,
          interfaceDrafts,
          templateItems,
          schemaIds
        ]) => {
          // 组件卸载或依赖切换后，不再写入旧请求的结果。
          if (!active) return

          // 按各库返回顺序截取条目，再按试卷、作答、模板的顺序组合。
          // 试卷与作答列表按时间倒序返回（见 File*Repository.listRecords/listEntries），
          // 可直接截取前几条；模板列表按 UUID 排序，截取结果并不代表「最近」。
          const recentExams: RecentWorkItem[] = examRecords.slice(0, 2).map((record) => ({
            id: `exam:${record.packageId}`,
            title: record.title,
            detail: `${record.pageCount} 个页面 · ${record.resourceCount} 个资源`,
            status: '可运行',
            path: '/exams',
            icon: ClipboardCheck
          }))
          const recentSubmissions: RecentWorkItem[] = submissionEntries
            .slice(0, 2)
            .map((entry) => ({
              id: `submission:${entry.record.submissionId}`,
              title: `${entry.record.candidateName} · ${entry.record.examTitle}`,
              detail: `${entry.record.schemaUseCount} 个评分单元`,
              status: entry.settlement
                ? '已结算'
                : entry.grading?.status === 'ready'
                  ? '可结算'
                  : '待评分',
              path: entry.settlement
                ? `/submissions?view=settled&batchId=${encodeURIComponent(entry.settlement.batchId)}`
                : `/submissions/grading?submissionId=${encodeURIComponent(entry.record.submissionId)}`,
              icon: Inbox
            }))
          const recentTemplates: RecentWorkItem[] = templateItems.slice(0, 3).map((item) => ({
            id: `template:${item.templateId}`,
            title: item.name || '未命名试卷模板',
            detail: item.description || '暂无描述',
            status: '模板',
            path: `/templates/${encodeURIComponent(item.templateId)}`,
            icon: LayoutTemplate
          }))

          // 统计值取各库完整条数；最近工作只保留合并后的前 4 条，
          // 使列表长度稳定，不随数据量增长撑破面板。
          setSnapshot({
            exams: examRecords.length,
            // 已结算才计为完成，评分就绪但尚未结算的作答仍属于待处理。
            pendingSubmissions: submissionEntries.filter((entry) => !entry.settlement).length,
            completedSubmissions: submissionEntries.filter((entry) => entry.settlement).length,
            interfaces: publishedInterfaces.length,
            interfaceDrafts: interfaceDrafts.length,
            templates: templateItems.length,
            schemas: schemaIds.length,
            recent: [...recentExams, ...recentSubmissions, ...recentTemplates].slice(0, 4)
          })
        }
      )
      // 失败时保留 EMPTY_SNAPSHOT，只切换提示文案，不展示半份统计。
      .catch(() => {
        if (active) setUnavailable(true)
      })
      // 无论成功或失败都要结束加载态，否则占位符会一直停留。
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      // 只翻转标记，不尝试取消底层 IPC 读取（已发出的文件请求无法中断）。
      active = false
    }
    // 依赖数组列出全部库对象以满足 exhaustive-deps 约定。这些引用恒定，
    // 因此实际只在卸载重挂后重新汇总；本页没有可触发重新汇总的入口。
  }, [exams, interfaces, schemas, submissions, templates])

  // 只有试卷数与待评分数会改变快捷操作说明，目标路径保持固定。
  // 依赖因此只列出这两个字段，避免 snapshot 中无关字段变化引起数组重建。
  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        title: '制作试卷',
        detail: '基于模板生成听说试卷',
        path: '/templates',
        icon: FilePenLine,
        primary: true
      },
      {
        title: '进入试卷库',
        detail: `${snapshot.exams} 份试卷可以运行`,
        path: '/exams',
        icon: Play
      },
      {
        title: '处理作答记录',
        detail: `${snapshot.pendingSubmissions} 份作答等待评分`,
        path: '/submissions',
        icon: Inbox
      }
    ],
    [snapshot.exams, snapshot.pendingSubmissions]
  )

  // 无作答记录时进度为零，避免除零产生无效百分比。
  // 完成口径以结算（settlement）为准，与状态栏「待评分」保持一致。
  const totalSubmissions = snapshot.pendingSubmissions + snapshot.completedSubmissions
  const completion = totalSubmissions
    ? Math.round((snapshot.completedSubmissions / totalSubmissions) * 100)
    : 0

  // 渲染顺序：介绍区（含纯装饰波形）→ 快捷操作 → 状态栏 → 最近工作/待处理双栏。
  // 「最近工作」面板用 loading、空列表、列表三个互斥分支表达状态，
  // 分支之间没有 else，条件必须互补才能保证同时只命中一个。
  // data-workbench 是给 AppShell.module.css 的选择器用的，用于跳过路由进入动画。
  return (
    <div className={styles.page} data-workbench>
      <div className={styles.inner}>
        <section className={styles.intro} aria-labelledby="workbench-title">
          <div className={styles.introCopy}>
            <span className={styles.eyebrow}>LS101 · 英语听说工作台</span>
            <h1 id="workbench-title">工作台</h1>
            <h2>{STARTUP_QUOTE.text}</h2>
            <p className={styles.quoteMeta}>
              <span>{STARTUP_QUOTE.translation}</span>
              <cite>{STARTUP_QUOTE.author}</cite>
            </p>
          </div>
          <div className={styles.heroVisual} aria-hidden="true">
            <div className={styles.visualHeader}>
              <span>LISTEN / SPEAK</span>
              <span>LS — 101</span>
            </div>
            <div className={styles.waveform}>
              {[22, 40, 62, 34, 78, 48, 92, 55, 36, 69, 45, 82, 29, 57, 38, 74].map(
                (height, index) => (
                  <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
                )
              )}
            </div>
            <div className={styles.visualFooter}>
              <span>01</span>
              <span>听力 · 口语 · 语言运用</span>
            </div>
            <strong className={styles.visualNumber}>101</strong>
          </div>
        </section>

        <section className={styles.quickActions} aria-label="快捷操作">
          {quickActions.map((action) => {
            // lucide 图标以组件形式存放，需先取出为局部变量才能当 JSX 标签使用。
            const Icon = action.icon
            // key 用 path：三个入口路径固定且互不相同，可兼作稳定标识。
            return (
              <button
                className={styles.quickAction}
                data-primary={action.primary || undefined}
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
              >
                <span className={styles.quickIcon}>
                  <Icon aria-hidden="true" />
                </span>
                <span className={styles.quickCopy}>
                  <strong>{action.title}</strong>
                  <span>{loading ? '正在汇总' : action.detail}</span>
                </span>
                <ArrowRight aria-hidden="true" />
              </button>
            )
          })}
        </section>

        <section className={styles.statusBand} aria-label="当前状态">
          <StatusItem icon={ClipboardCheck} label="试卷" value={snapshot.exams} loading={loading} />
          <StatusItem
            icon={Inbox}
            label="待评分"
            value={snapshot.pendingSubmissions}
            loading={loading}
          />
          <StatusItem icon={Shapes} label="题型" value={snapshot.interfaces} loading={loading} />
          <StatusItem
            icon={LayoutTemplate}
            label="试卷模板"
            value={snapshot.templates}
            loading={loading}
          />
          <StatusItem
            icon={BookCheck}
            label="评分单元"
            value={snapshot.schemas}
            loading={loading}
          />
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.recentPanel} aria-labelledby="recent-heading">
            <SectionHeading
              title="最近工作"
              detail={unavailable ? '部分状态暂不可用' : '继续上次未完成的内容'}
            />
            {loading ? <div className={styles.loading}>正在汇总最近工作...</div> : null}
            {!loading && snapshot.recent.length === 0 ? (
              <div className={styles.emptyRecent}>
                <FilePenLine aria-hidden="true" />
                <div>
                  <strong>还没有最近工作</strong>
                  <span>创建试卷模板后会显示在这里</span>
                </div>
                <button type="button" onClick={() => navigate('/templates')}>
                  前往试卷模板
                  <ArrowRight aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {!loading && snapshot.recent.length > 0 ? (
              <div className={styles.recentList}>
                {snapshot.recent.map((item) => {
                  // 与快捷操作同理：图标组件必须先解构为局部变量。
                  const Icon = item.icon
                  // key 用跨库唯一的 id，保证同一次加载内不会重复。
                  return (
                    <button key={item.id} type="button" onClick={() => navigate(item.path)}>
                      <span className={styles.recentIcon}>
                        <Icon aria-hidden="true" />
                      </span>
                      <span className={styles.recentCopy}>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </span>
                      <span className={styles.recentStatus}>{item.status}</span>
                      <ArrowRight aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            ) : null}
          </section>

          <aside className={styles.pendingPanel} aria-labelledby="pending-heading">
            <SectionHeading title="待处理" detail="作答评分进度" />
            <div className={styles.pendingSummary}>
              <div>
                <strong>{loading ? '–' : snapshot.pendingSubmissions}</strong>
                <span>份等待评分</span>
              </div>
              <span>{loading ? '–' : `${completion}%`}</span>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ width: `${completion}%` }} />
            </div>
            <dl className={styles.pendingStats}>
              <div>
                <dt>全部作答</dt>
                <dd>{loading ? '–' : totalSubmissions}</dd>
              </div>
              <div>
                <dt>已完成</dt>
                <dd>{loading ? '–' : snapshot.completedSubmissions}</dd>
              </div>
            </dl>
            <button
              className={styles.pendingAction}
              type="button"
              onClick={() => navigate('/submissions')}
            >
              查看作答记录
              <ArrowRight aria-hidden="true" />
            </button>
            <div className={styles.draftSummary}>
              <span>未完成题型</span>
              <strong>{loading ? '–' : snapshot.interfaceDrafts}</strong>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

/**
 * 加载期间用占位符替代数字，避免把初始零值误读为真实统计。
 *
 * 纯展示组件，自身不持有状态；loading 由父组件统一下发，
 * 保证状态栏五个数字的加载表现完全一致。
 */
function StatusItem({
  icon: Icon,
  label,
  value,
  loading
}: {
  icon: typeof Play
  label: string
  value: number
  loading: boolean
}): JSX.Element {
  return (
    // Icon 来自参数解构时的重命名，首字母大写才能作为组件标签参与渲染。
    <div className={styles.statusItem}>
      <Icon aria-hidden="true" />
      <div>
        <strong>{loading ? '–' : value}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

/**
 * 为最近工作和待处理区域生成与 aria-labelledby 对应的标题。
 *
 * 标题 id 由 title 文案推导，是与父级 section 的隐式契约：父级写死了
 * recent-heading / pending-heading，改动标题文案时必须同步修改，
 * 否则会破坏无障碍标签关联。
 */
function SectionHeading({ title, detail }: { title: string; detail: string }): JSX.Element {
  // 以文案区分两个面板，避免为纯展示组件额外引入一个 id prop。
  return (
    <header className={styles.sectionHeading}>
      <div>
        <span>{detail}</span>
        <h2 id={title === '最近工作' ? 'recent-heading' : 'pending-heading'}>{title}</h2>
      </div>
    </header>
  )
}
