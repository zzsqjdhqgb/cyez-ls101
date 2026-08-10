import { useMemo, useState, type JSX } from 'react'
import type { ChoiceOptionLabel, PlayerChoiceMeta, ResolvedChoiceViewport } from '@ls101/core-types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './ExamPlayer.module.css'

interface ChoiceViewProps {
  meta: PlayerChoiceMeta
  viewport: ResolvedChoiceViewport
  answers: Readonly<Record<number, ChoiceOptionLabel>>
  onAnswer(choiceIndex: number, answer: ChoiceOptionLabel): void
}

export function ChoiceView({ meta, viewport, answers, onAnswer }: ChoiceViewProps): JSX.Element {
  const focusedPage = useMemo(
    () =>
      viewport.mode === 'focus'
        ? Math.max(
            0,
            meta.pages.findIndex((page) => page.questionIndices.includes(viewport.choiceIndex))
          )
        : null,
    [meta.pages, viewport]
  )
  const viewportKey = JSON.stringify(viewport)
  const [navigation, setNavigation] = useState(() => ({
    viewportKey,
    pageIndex: initialPage(viewport, focusedPage)
  }))
  const pageIndex =
    navigation.viewportKey === viewportKey
      ? navigation.pageIndex
      : initialPage(viewport, focusedPage)

  const [minimum, maximum] = pageBounds(viewport, meta.pages.length, focusedPage)
  const safePage = Math.min(maximum, Math.max(minimum, pageIndex))
  const questionIndices = meta.pages[safePage]?.questionIndices ?? []
  const questions = questionIndices
    .map((index) => meta.questions.find((question) => question.choiceIndex === index))
    .filter((question) => question !== undefined)

  return (
    <div className={styles.choiceView}>
      <div className={styles.choiceQuestions}>
        {questions.map((question) => {
          const focused = viewport.mode === 'focus' && viewport.choiceIndex === question.choiceIndex
          return (
            <fieldset
              className={styles.choiceQuestion}
              data-focused={focused || undefined}
              key={question.choiceIndex}
            >
              <legend>{question.stem}</legend>
              <div className={styles.choiceOptions}>
                {question.options.map((option) => (
                  <label className={styles.choiceOption} key={option.label}>
                    <input
                      checked={answers[question.choiceIndex] === option.label}
                      name={`choice-${question.choiceIndex}`}
                      type="radio"
                      value={option.label}
                      onChange={() => onAnswer(question.choiceIndex, option.label)}
                    />
                    <span className={styles.optionLabel}>{option.label}</span>
                    <span>{option.content}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
      {maximum > minimum ? (
        <nav className={styles.choiceNavigation} aria-label="选择题分页">
          <button
            aria-label="上一页"
            disabled={safePage <= minimum}
            type="button"
            onClick={() =>
              setNavigation({ viewportKey, pageIndex: Math.max(minimum, safePage - 1) })
            }
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <span>
            {safePage - minimum + 1} / {maximum - minimum + 1}
          </span>
          <button
            aria-label="下一页"
            disabled={safePage >= maximum}
            type="button"
            onClick={() =>
              setNavigation({ viewportKey, pageIndex: Math.min(maximum, safePage + 1) })
            }
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  )
}

function initialPage(viewport: ResolvedChoiceViewport, focusedPage: number | null): number {
  if (viewport.mode === 'focus') return focusedPage ?? 0
  if (viewport.mode === 'range') return viewport.initialPage ?? viewport.startPage
  return viewport.initialPage ?? 0
}

function pageBounds(
  viewport: ResolvedChoiceViewport,
  pageCount: number,
  focusedPage: number | null
): [number, number] {
  if (viewport.mode === 'focus') return [focusedPage ?? 0, focusedPage ?? 0]
  if (viewport.mode === 'range') return [viewport.startPage, viewport.endPage]
  return [0, Math.max(0, pageCount - 1)]
}
