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

/** 不同业务记录统一为工作台可展示、可跳转的最近工作条目。 */
interface RecentWorkItem {
  id: string
  title: string
  detail: string
  status: string
  path: string
  icon: typeof Play
}

/** 一次汇总加载得到的统计值与最近工作列表。 */
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

interface QuickAction {
  title: string
  detail: string
  path: string
  icon: typeof Play
  primary?: boolean
}

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
const STARTUP_QUOTE =
  WORKBENCH_QUOTES[Math.floor(Math.random() * WORKBENCH_QUOTES.length)] ?? WORKBENCH_QUOTES[0]

/** 汇总各业务库状态，展示常用入口、最近工作与作答评分进度。 */
export function WorkbenchPage(): JSX.Element {
  const navigate = useNavigate()
  const exams = useExamLibrary()
  const submissions = useSubmissionLibrary()
  const interfaces = useInterfaceApplication()
  const templates = useTemplateApplication()
  const schemas = useSchemaRepository()
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>(EMPTY_SNAPSHOT)
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true

    // 各库独立读取并行进行；任一请求失败时统一显示状态不可用提示。
    void Promise.all([
      exams.listRecords(),
      submissions.listEntries(),
      interfaces.browser.listPublished(),
      interfaces.browser.listDrafts(),
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
      .catch(() => {
        if (active) setUnavailable(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [exams, interfaces, schemas, submissions, templates])

  // 只有试卷数与待评分数会改变快捷操作说明，目标路径保持固定。
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
  const totalSubmissions = snapshot.pendingSubmissions + snapshot.completedSubmissions
  const completion = totalSubmissions
    ? Math.round((snapshot.completedSubmissions / totalSubmissions) * 100)
    : 0

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
            const Icon = action.icon
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
                  const Icon = item.icon
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

/** 加载期间用占位符替代数字，避免把初始零值误读为真实统计。 */
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
    <div className={styles.statusItem}>
      <Icon aria-hidden="true" />
      <div>
        <strong>{loading ? '–' : value}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}

/** 为最近工作和待处理区域生成与 aria-labelledby 对应的标题。 */
function SectionHeading({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <span>{detail}</span>
        <h2 id={title === '最近工作' ? 'recent-heading' : 'pending-heading'}>{title}</h2>
      </div>
    </header>
  )
}
