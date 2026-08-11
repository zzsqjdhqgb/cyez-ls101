import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { ChoiceOptionLabel, PlayerChoiceMeta, ResolvedChoiceViewport } from '@ls101/core-types'
import type {
  TemplateCompileError,
  TemplateDocument,
  TemplateNode,
  TemplatePreviewData,
  TemplatePreviewPage,
  TemplatePreviewTimelineStep
} from '@ls101/template-editor'
import { ExamPageView } from '@ls101/exam-player'
import { PAGE_DESIGN_HEIGHT, PAGE_DESIGN_WIDTH } from '@ls101/page-renderer'
import { AlertCircle, FileText, Info, Layers3, Mic, RefreshCw, Timer, Volume2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tooltip } from '../../components/ui/Tooltip'
import { TemplateInspectorSection } from './TemplateInspectorSection'
import { templatePreviewResourceUrls } from './TemplatePreviewModel'
import type { TemplatePreviewSession } from './useTemplatePreview'
import styles from './TemplatePreview.module.css'

export interface TemplatePreviewSnapshot {
  id: string
  page: TemplatePreviewPage
  pageIndex: number
  step: TemplatePreviewTimelineStep
  stepIndex: number
}

interface PreviewCommonProps {
  compiling: boolean
  error: string | null
  missingInstances: boolean
  result: TemplatePreviewSession['result']
}

export function TemplatePreviewFilmstrip({
  snapshots,
  selectedIndex,
  preview,
  onSelect,
  ...status
}: PreviewCommonProps & {
  snapshots: readonly TemplatePreviewSnapshot[]
  selectedIndex: number
  preview: TemplatePreviewData | null
  onSelect(index: number): void
}): JSX.Element {
  const resourceUrls = useMemo(() => templatePreviewResourceUrls(status.result), [status.result])

  return (
    <aside className={styles.filmstrip} aria-label="预览序列">
      <header className={styles.filmstripHeader}>
        <div>
          <h2>预览序列</h2>
          <span>{snapshots.length} 个画面</span>
        </div>
      </header>
      <div className={styles.filmstripBody}>
        <PreviewStatus snapshots={snapshots} {...status} />
        {snapshots.length > 0 ? (
          <ol className={styles.snapshotList}>
            {snapshots.map((snapshot, index) => {
              const previous = snapshots[index - 1]
              const beginsPage = !previous || previous.page.id !== snapshot.page.id
              return (
                <li key={snapshot.id}>
                  {beginsPage ? (
                    <div className={styles.pageGroupHeading}>
                      <FileText aria-hidden="true" />
                      <span>{snapshot.page.sourceNodeName || snapshot.page.sourceNodeId}</span>
                    </div>
                  ) : null}
                  <div
                    className={styles.snapshotCard}
                    data-current={index === selectedIndex || undefined}
                  >
                    <div aria-hidden="true" className={styles.thumbnailViewport} inert>
                      <div className={styles.thumbnailPage}>
                        <ExamPageView
                          choiceMeta={preview?.choiceMeta}
                          page={snapshot.page}
                          resourceUrls={resourceUrls}
                          step={snapshot.step}
                        />
                      </div>
                    </div>
                    <span aria-hidden="true" className={styles.snapshotMeta}>
                      <span className={styles.snapshotIndex}>{index + 1}</span>
                      <TimelineIcon step={snapshot.step} />
                      <span>{stepLabel(snapshot.step)}</span>
                      <small>{stepDetail(snapshot.step)}</small>
                    </span>
                    <button
                      aria-current={index === selectedIndex ? 'true' : undefined}
                      aria-label={`预览画面 ${index + 1}，${stepLabel(snapshot.step)}`}
                      className={styles.snapshotSelect}
                      type="button"
                      onClick={() => onSelect(index)}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        ) : null}
      </div>
    </aside>
  )
}

export function TemplatePreviewCanvas({
  snapshot,
  preview,
  resourceUrls,
  position,
  total
}: {
  snapshot: TemplatePreviewSnapshot | null
  preview: TemplatePreviewData | null
  resourceUrls: Readonly<Record<string, string>>
  position: number
  total: number
}): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const choiceInfoRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [choiceInfoState, setChoiceInfoState] = useState({ snapshotId: '', open: false })
  const [answerState, setAnswerState] = useState<{
    snapshotId: string
    answers: Record<number, ChoiceOptionLabel>
  }>({ snapshotId: '', answers: {} })
  const choiceViews = useMemo(
    () =>
      snapshot?.page.content.flatMap((block) =>
        block.type === 'choice-view'
          ? [
              {
                id: block.id,
                viewport: snapshot.step.choiceViewOverrides?.[block.id] ?? block.defaultViewport
              }
            ]
          : []
      ) ?? [],
    [snapshot]
  )
  const snapshotId = snapshot?.id ?? ''
  const choiceInfoOpen = choiceInfoState.snapshotId === snapshotId && choiceInfoState.open

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = (): void => {
      const horizontalRoom = Math.max(240, viewport.clientWidth - 64)
      const verticalRoom = Math.max(180, viewport.clientHeight - 64)
      setScale(Math.min(horizontalRoom / PAGE_DESIGN_WIDTH, verticalRoom / PAGE_DESIGN_HEIGHT, 1))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [snapshot?.id])

  useEffect(() => {
    if (!choiceInfoOpen) return
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!choiceInfoRef.current?.contains(event.target as Node)) {
        setChoiceInfoState({ snapshotId, open: false })
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setChoiceInfoState({ snapshotId, open: false })
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [choiceInfoOpen, snapshotId])

  if (!snapshot) {
    return (
      <section className={styles.canvas} aria-label="模板预览画面">
        <div className={styles.canvasEmpty}>
          <EmptyState icon={Layers3} title="没有可预览的画面" />
        </div>
      </section>
    )
  }

  const scaledStyle = {
    width: PAGE_DESIGN_WIDTH * scale,
    height: PAGE_DESIGN_HEIGHT * scale
  } satisfies CSSProperties
  const innerStyle = { transform: `scale(${scale})` } satisfies CSSProperties
  const answers = answerState.snapshotId === snapshot.id ? answerState.answers : {}

  return (
    <section className={styles.canvas} aria-label="模板预览画面">
      <header className={styles.canvasHeader}>
        <div className={styles.canvasHeading}>
          <strong>{snapshot.page.sourceNodeName || snapshot.page.sourceNodeId}</strong>
          <span>
            页面 {snapshot.pageIndex + 1} · Timeline {snapshot.stepIndex + 1}
          </span>
        </div>
        <div className={styles.canvasHeaderActions}>
          {choiceViews.length > 0 ? (
            <div className={styles.choiceInfoAnchor} ref={choiceInfoRef}>
              <Tooltip label="查看 ChoiceView 配置" side="bottom">
                <button
                  aria-controls="template-preview-choice-info"
                  aria-expanded={choiceInfoOpen}
                  aria-label="查看 ChoiceView 配置"
                  className={styles.choiceInfoButton}
                  type="button"
                  onClick={() =>
                    setChoiceInfoState((current) => ({
                      snapshotId,
                      open: current.snapshotId === snapshotId ? !current.open : true
                    }))
                  }
                >
                  <Info aria-hidden="true" />
                </button>
              </Tooltip>
              {choiceInfoOpen ? (
                <ChoiceViewInfoPopover choiceMeta={preview?.choiceMeta} choiceViews={choiceViews} />
              ) : null}
            </div>
          ) : null}
          <span className={styles.position}>
            {position + 1} / {total}
          </span>
        </div>
      </header>
      <div className={styles.canvasViewport} ref={viewportRef}>
        <div className={styles.scaledPreview} style={scaledStyle}>
          <div className={styles.scaledPreviewInner} style={innerStyle}>
            <ExamPageView
              key={snapshot.id}
              ariaLabel={`最终画面 ${position + 1}`}
              answers={answers}
              choiceMeta={preview?.choiceMeta}
              page={snapshot.page}
              resourceUrls={resourceUrls}
              step={snapshot.step}
              onAnswer={(choiceIndex, answer) =>
                setAnswerState((current) => ({
                  snapshotId: snapshot.id,
                  answers: {
                    ...(current.snapshotId === snapshot.id ? current.answers : {}),
                    [choiceIndex]: answer
                  }
                }))
              }
            />
          </div>
        </div>
      </div>
      <footer className={styles.stepBar}>
        <span className={styles.stepIcon}>
          <TimelineIcon step={snapshot.step} />
        </span>
        <div>
          <strong>{stepLabel(snapshot.step)}</strong>
          <span>{stepDetail(snapshot.step)}</span>
        </div>
      </footer>
    </section>
  )
}

function ChoiceViewInfoPopover({
  choiceMeta,
  choiceViews
}: {
  choiceMeta: PlayerChoiceMeta | undefined
  choiceViews: readonly { id: string; viewport: ResolvedChoiceViewport }[]
}): JSX.Element {
  return (
    <div
      aria-label="ChoiceView 配置"
      className={styles.choiceInfoPopover}
      id="template-preview-choice-info"
      role="region"
    >
      <div className={styles.choiceInfoTitle}>
        <strong>ChoiceView 配置</strong>
        <span>{choiceViews.length} 个控件</span>
      </div>
      <ol className={styles.choiceInfoList}>
        {choiceViews.map((choiceView, index) => (
          <li key={choiceView.id}>
            <div className={styles.choiceInfoItemHeading}>
              <strong>ChoiceView {index + 1}</strong>
              <span>{choiceView.id}</span>
            </div>
            <dl>
              {choiceViewportDetails(choiceView.viewport, choiceMeta).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </div>
  )
}

function choiceViewportDetails(
  viewport: ResolvedChoiceViewport,
  choiceMeta: PlayerChoiceMeta | undefined
): Array<[string, string]> {
  const pageCount = choiceMeta?.pages.length ?? 0
  if (viewport.mode === 'focus') {
    const focusedPage = choiceMeta?.pages.findIndex((page) =>
      page.questionIndices.includes(viewport.choiceIndex)
    )
    return [
      ['模式', '聚焦题目'],
      ['聚焦题', `第 ${viewport.choiceIndex + 1} 题`],
      [
        '所在页',
        focusedPage === undefined || focusedPage < 0 ? '不可用' : `第 ${focusedPage + 1} 页`
      ]
    ]
  }
  if (viewport.mode === 'range') {
    return [
      ['模式', '限制范围'],
      ['可用分页', `第 ${viewport.startPage + 1}–${viewport.endPage + 1} 页`],
      ['初始页', `第 ${(viewport.initialPage ?? viewport.startPage) + 1} 页`]
    ]
  }
  return [
    ['模式', '全部分页'],
    ['可用分页', pageCount > 0 ? `第 1–${pageCount} 页` : '暂无分页'],
    ['初始页', `第 ${(viewport.initialPage ?? 0) + 1} 页`]
  ]
}

export function TemplatePreviewInspector({
  document,
  target,
  snapshot,
  snapshotCount,
  session
}: {
  document: TemplateDocument | null
  target: TemplateNode | null
  snapshot: TemplatePreviewSnapshot | null
  snapshotCount: number
  session: TemplatePreviewSession
}): JSX.Element {
  return (
    <aside className={styles.inspector} aria-label="预览配置">
      <TemplateInspectorSection title="预览范围" headingId="preview-scope-heading">
        <dl className={styles.details}>
          <div>
            <dt>节点</dt>
            <dd>{target?.name?.trim() || (target ? nodeTypeLabel(target.type) : '不可用')}</dd>
          </div>
          <div>
            <dt>画面</dt>
            <dd>{snapshotCount}</dd>
          </div>
        </dl>
        <Button
          icon={RefreshCw}
          size="small"
          disabled={session.compiling || session.instancesLoading || session.missingInstances}
          onClick={session.refresh}
        >
          刷新预览
        </Button>
      </TemplateInspectorSection>
      <TemplatePreviewBindings document={document ?? undefined} session={session} />
      <TemplateInspectorSection title="当前 Timeline">
        {snapshot ? (
          <dl className={styles.details}>
            <div>
              <dt>类型</dt>
              <dd>{stepLabel(snapshot.step)}</dd>
            </div>
            <div>
              <dt>参数</dt>
              <dd>{stepDetail(snapshot.step)}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{snapshot.page.sourceNodeId}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.emptyValue}>暂无 Timeline 信息</p>
        )}
      </TemplateInspectorSection>
      {session.error ? (
        <TemplateInspectorSection title="预览错误">
          <div className={styles.error} role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{session.error}</span>
          </div>
        </TemplateInspectorSection>
      ) : null}
      {session.result && !session.result.success ? (
        <TemplateInspectorSection title="校验结果">
          <ol className={styles.errorList}>
            {session.result.errors.map((error, index) => (
              <li key={`${compileErrorPath(error)}-${index}`}>{formatCompileError(error)}</li>
            ))}
          </ol>
        </TemplateInspectorSection>
      ) : null}
    </aside>
  )
}

export function TemplatePreviewBindings({
  document,
  session
}: {
  document?: TemplateDocument
  session: TemplatePreviewSession
}): JSX.Element | null {
  const requirements = document?.content.interfaces ?? []
  if (requirements.length === 0) return null
  return (
    <TemplateInspectorSection title="Interface 实例">
      <div className={styles.bindings}>
        {requirements.map((requirement) => (
          <label key={requirement.alias}>
            <span>{requirement.alias}</span>
            <select
              aria-label={`预览 Interface ${requirement.alias} 实例`}
              disabled={session.instancesLoading}
              value={session.selections[requirement.alias] ?? ''}
              onChange={(event) => session.selectInstance(requirement.alias, event.target.value)}
            >
              <option value="">请选择实例</option>
              {(session.instanceOptions[requirement.alias] ?? []).map((instance) => (
                <option key={instance.instanceId} value={instance.instanceId}>
                  {instance.name || '未命名实例'}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </TemplateInspectorSection>
  )
}

function PreviewStatus({
  compiling,
  error,
  missingInstances,
  result,
  snapshots
}: PreviewCommonProps & { snapshots: readonly TemplatePreviewSnapshot[] }): JSX.Element | null {
  if (error) return <FilmstripNotice message="预览加载失败" />
  if (missingInstances) return <FilmstripNotice message="请先选择 Interface 实例" />
  if (compiling) return <FilmstripNotice message="正在生成预览..." />
  if (result && !result.success) return <FilmstripNotice message="模板未通过校验" />
  if (result?.success && snapshots.length === 0) {
    return <FilmstripNotice message="所选节点不产生页面" />
  }
  return null
}

function FilmstripNotice({ message }: { message: string }): JSX.Element {
  return <p className={styles.filmstripNotice}>{message}</p>
}

function TimelineIcon({ step }: { step: TemplatePreviewTimelineStep }): JSX.Element {
  if (step.type === 'play') return <Volume2 aria-hidden="true" />
  if (step.type === 'countdown') return <Timer aria-hidden="true" />
  return <Mic aria-hidden="true" />
}

function stepLabel(step: TemplatePreviewTimelineStep): string {
  if (step.type === 'play') return 'TTS 播放'
  if (step.type === 'countdown') return '倒计时'
  return '录音'
}

function stepDetail(step: TemplatePreviewTimelineStep): string {
  if (step.type === 'play') return step.text || '空文本'
  if (step.type === 'countdown') return `${step.seconds} 秒`
  return `${step.duration} 秒 · 录音 ${step.recordIndex + 1}`
}

function formatCompileError(error: TemplateCompileError): string {
  if (error.stage === 'validation') {
    return `${error.error.code} · ${error.error.path}`
  }
  return `${error.code} · ${error.path}`
}

function compileErrorPath(error: TemplateCompileError): string {
  return error.stage === 'validation' ? error.error.path : error.path
}

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'function') return '函数'
  return '选择题'
}
