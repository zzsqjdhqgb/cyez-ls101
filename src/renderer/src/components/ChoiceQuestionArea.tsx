/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useEffect } from 'react'
import type { ChoicePage } from '../types'

interface Props {
  pages: ChoicePage[]
  currentPage: number
  focusId?: number
  pageRange?: [number, number]
  answers: Record<number, string>
  onAnswer: (choiceId: number, answer: string) => void
  onPageChange: (page: number) => void
}

function getPageForChoiceId(pages: ChoicePage[], choiceId: number): number {
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].questions.some((q) => q.id === choiceId)) return i
  }
  return 0
}

const OPTION_LABELS = ['A', 'B', 'C', 'D']

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '10px 16px'
  },
  questionBlock: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #333',
    transition: 'background 0.2s'
  },
  questionBlockHighlight: {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid #3b82f6',
    background: '#283548',
    transition: 'background 0.2s'
  },
  stem: {
    fontSize: 18,
    color: '#e2e8f0',
    marginBottom: 6,
    lineHeight: 1.3,
    wordBreak: 'break-word'
  },
  optionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 8px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
    userSelect: 'none'
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    border: '2px solid #64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'border-color 0.15s'
  },
  radioSelected: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    border: '2px solid #3b82f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3b82f6'
  },
  optionLabel: {
    fontSize: 16,
    color: '#94a3b8',
    minWidth: 20
  },
  optionText: {
    fontSize: 16,
    color: '#cbd5e1',
    flex: 1
  },
  optionTextSelected: {
    fontSize: 16,
    color: '#ffffff',
    flex: 1,
    fontWeight: 500
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    padding: '4px 0'
  },
  pageBtn: {
    fontSize: 16,
    padding: '4px 14px',
    background: '#333',
    color: '#cbd5e1',
    border: '1px solid #444',
    borderRadius: 6,
    cursor: 'pointer'
  },
  pageBtnDisabled: {
    fontSize: 16,
    padding: '4px 14px',
    background: '#222',
    color: '#555',
    border: '1px solid #333',
    borderRadius: 6,
    cursor: 'default'
  },
  pageInfo: {
    fontSize: 16,
    color: '#64748b'
  }
}

export default function ChoiceQuestionArea({
  pages,
  currentPage,
  focusId,
  pageRange,
  answers,
  onAnswer,
  onPageChange
}: Props): JSX.Element {
  const totalPages = pages.length
  const isLocked = focusId !== undefined && focusId > 0
  const hasRange = pageRange !== undefined
  const rangeStart = hasRange ? pageRange[0] : 0
  const rangeEnd = hasRange ? pageRange[1] : totalPages - 1

  useEffect(() => {
    if (focusId !== undefined && focusId > 0) {
      const targetPage = getPageForChoiceId(pages, focusId)
      if (targetPage !== currentPage) {
        onPageChange(targetPage)
      }
    }
  }, [focusId, currentPage])

  useEffect(() => {
    if (hasRange && currentPage < rangeStart) {
      onPageChange(rangeStart)
    }
  }, [pageRange, currentPage])

  const prevDisabled = isLocked || currentPage === 0 || (hasRange && currentPage <= rangeStart)
  const nextDisabled =
    isLocked || currentPage === totalPages - 1 || (hasRange && currentPage >= rangeEnd)

  const currentPageQuestions = pages[currentPage]?.questions ?? []

  return (
    <div style={styles.container}>
      {currentPageQuestions.map((q) => {
        const isHighlighted = focusId === q.id
        const selectedAnswer = answers[q.id]

        return (
          <div
            key={q.id}
            style={isHighlighted ? styles.questionBlockHighlight : styles.questionBlock}
          >
            <div style={styles.stem}>
              {q.id}. {q.stem}
            </div>
            <div style={styles.optionsGrid}>
              {q.options.map((opt, optIdx) => {
                const label = OPTION_LABELS[optIdx]
                const isSelected = selectedAnswer === label

                return (
                  <div
                    key={label}
                    style={styles.optionRow}
                    onClick={() => onAnswer(q.id, label)}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div style={isSelected ? styles.radioSelected : styles.radio}>
                      {isSelected && <div style={styles.radioDot} />}
                    </div>
                    <span style={styles.optionLabel}>{label}.</span>
                    <span style={isSelected ? styles.optionTextSelected : styles.optionText}>
                      {opt}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {totalPages > 1 && (
        <div style={styles.pageNav}>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={prevDisabled}
            style={prevDisabled ? styles.pageBtnDisabled : styles.pageBtn}
          >
            ◀ 上一页
          </button>
          <span style={styles.pageInfo}>
            第 {currentPage + 1}/{totalPages} 页
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={nextDisabled}
            style={nextDisabled ? styles.pageBtnDisabled : styles.pageBtn}
          >
            下一页 ▶
          </button>
        </div>
      )}
    </div>
  )
}
