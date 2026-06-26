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
    gap: 16,
    padding: '16px 20px'
  },
  questionBlock: {
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #333',
    transition: 'background 0.2s'
  },
  questionBlockHighlight: {
    padding: '12px 16px',
    borderRadius: 8,
    border: '1px solid #3b82f6',
    background: '#283548',
    transition: 'background 0.2s'
  },
  stem: {
    fontSize: 22,
    color: '#e2e8f0',
    marginBottom: 10,
    lineHeight: 1.5,
    wordBreak: 'break-word'
  },
  optionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  optionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background 0.15s',
    userSelect: 'none'
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: '2px solid #64748b',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'border-color 0.15s'
  },
  radioSelected: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    border: '2px solid #3b82f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#3b82f6'
  },
  optionLabel: {
    fontSize: 20,
    color: '#94a3b8',
    minWidth: 24
  },
  optionText: {
    fontSize: 20,
    color: '#cbd5e1',
    flex: 1
  },
  optionTextSelected: {
    fontSize: 20,
    color: '#ffffff',
    flex: 1,
    fontWeight: 500
  },
  pageNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    padding: '8px 0'
  },
  pageBtn: {
    fontSize: 18,
    padding: '6px 16px',
    background: '#333',
    color: '#cbd5e1',
    border: '1px solid #444',
    borderRadius: 6,
    cursor: 'pointer'
  },
  pageBtnDisabled: {
    fontSize: 18,
    padding: '6px 16px',
    background: '#222',
    color: '#555',
    border: '1px solid #333',
    borderRadius: 6,
    cursor: 'default'
  },
  pageInfo: {
    fontSize: 18,
    color: '#64748b'
  }
}

export default function ChoiceQuestionArea({
  pages,
  currentPage,
  focusId,
  answers,
  onAnswer,
  onPageChange
}: Props): JSX.Element {
  const totalPages = pages.length
  const isLocked = focusId !== undefined && focusId > 0

  useEffect(() => {
    if (focusId !== undefined && focusId > 0) {
      const targetPage = getPageForChoiceId(pages, focusId)
      if (targetPage !== currentPage) {
        onPageChange(targetPage)
      }
    }
  }, [focusId]) // eslint-disable-line react-hooks/exhaustive-deps

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
            disabled={currentPage === 0 || isLocked}
            style={currentPage === 0 || isLocked ? styles.pageBtnDisabled : styles.pageBtn}
          >
            ◀ 上一页
          </button>
          <span style={styles.pageInfo}>
            第 {currentPage + 1}/{totalPages} 页
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages - 1 || isLocked}
            style={
              currentPage === totalPages - 1 || isLocked ? styles.pageBtnDisabled : styles.pageBtn
            }
          >
            下一页 ▶
          </button>
        </div>
      )}
    </div>
  )
}
