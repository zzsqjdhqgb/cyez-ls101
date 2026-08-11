import { useCallback, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChoiceOptionLabel,
  ExamPage,
  PlayerChoiceMeta,
  ResolvedChoiceViewport
} from '@ls101/core-types'
import { ChoiceView } from './ChoiceView'
import { resourceKey } from './loading'
import rendererCss from './ExamPageView.css?inline'

const STYLE_MARKER = 'exam-page-view-styles'

export interface ExamPageVisualStep {
  choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
}

export interface ExamPageViewProps {
  page: Pick<ExamPage, 'content'>
  step: ExamPageVisualStep
  resourceUrls: Readonly<Record<string, string>>
  choiceMeta?: PlayerChoiceMeta
  answers?: Readonly<Record<number, ChoiceOptionLabel>>
  ariaLabel?: string
  className?: string
  onAnswer?(choiceIndex: number, answer: ChoiceOptionLabel): void
}

export function ExamPageView({
  ariaLabel,
  className,
  ...contentProps
}: ExamPageViewProps): JSX.Element {
  const [shadowRoot, setShadowRoot] = useState<ShadowRoot | null>(null)
  const attachRenderer = useCallback((host: HTMLDivElement | null): void => {
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    if (!root.querySelector(`style[data-${STYLE_MARKER}]`)) {
      const style = document.createElement('style')
      style.setAttribute(`data-${STYLE_MARKER}`, '')
      style.textContent = rendererCss
      root.append(style)
    }
    setShadowRoot(root)
  }, [])

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-exam-page-view=""
      data-style-isolation="shadow"
      ref={attachRenderer}
    >
      {shadowRoot ? createPortal(<ExamPageContent {...contentProps} />, shadowRoot) : null}
    </div>
  )
}

function ExamPageContent({
  page,
  step,
  resourceUrls,
  choiceMeta,
  answers = {},
  onAnswer = () => undefined
}: Omit<ExamPageViewProps, 'ariaLabel' | 'className'>): JSX.Element {
  return (
    <div className="page">
      {page.content.map((block) => {
        const style = {
          left: `${block.x}%`,
          top: `${block.y}%`,
          ...(block.width === undefined ? {} : { width: `${block.width}%` }),
          ...(!('height' in block) || block.height === undefined
            ? {}
            : { height: `${block.height}%` })
        } satisfies CSSProperties
        if (block.type === 'text') {
          return (
            <div
              className="textBlock"
              key={block.id}
              style={{
                ...style,
                fontSize: block.fontSize ?? 28,
                fontWeight: block.bold ? 700 : 400,
                textAlign: block.align ?? 'left'
              }}
            >
              {block.text}
            </div>
          )
        }
        if (block.type === 'image') {
          const key = resourceKey(block.src)
          return (
            <div className="imageBlock" key={block.id} style={style}>
              <img alt="" draggable={false} src={key ? resourceUrls[key] : undefined} />
            </div>
          )
        }
        const viewport = step.choiceViewOverrides?.[block.id] ?? block.defaultViewport
        return (
          <div className="choiceBlock" key={block.id} style={style}>
            {choiceMeta ? (
              <ChoiceView
                answers={answers}
                meta={choiceMeta}
                viewport={viewport}
                onAnswer={onAnswer}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
