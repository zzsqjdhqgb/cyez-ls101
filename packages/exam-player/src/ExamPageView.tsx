import type { CSSProperties, JSX } from 'react'
import type {
  ChoiceOptionLabel,
  ExamPage,
  PlayerChoiceMeta,
  ResolvedChoiceViewport
} from '@ls101/core-types'
import { ChoiceView } from './ChoiceView'
import { resourceKey } from './loading'
import styles from './ExamPlayer.module.css'

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
  onAnswer?(choiceIndex: number, answer: ChoiceOptionLabel): void
}

export function ExamPageView({
  page,
  step,
  resourceUrls,
  choiceMeta,
  answers = {},
  ariaLabel,
  onAnswer = () => undefined
}: ExamPageViewProps): JSX.Element {
  return (
    <div aria-label={ariaLabel} className={styles.page}>
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
              className={styles.textBlock}
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
            <div className={styles.imageBlock} key={block.id} style={style}>
              <img alt="" draggable={false} src={key ? resourceUrls[key] : undefined} />
            </div>
          )
        }
        const viewport = step.choiceViewOverrides?.[block.id] ?? block.defaultViewport
        return (
          <div className={styles.choiceBlock} key={block.id} style={style}>
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
