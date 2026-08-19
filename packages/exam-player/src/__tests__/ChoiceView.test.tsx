// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerChoiceMeta } from '@ls101/core-types'
import { ChoiceView } from '../ChoiceView'

afterEach(() => cleanup())

describe('ChoiceView', () => {
  it('聚焦题目时将题目滚动到选择题滚动容器可见区域', async () => {
    let scrolledElement: HTMLElement | null = null
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = function () {
      scrolledElement = this
    }

    try {
      const meta: PlayerChoiceMeta = {
        pages: [{ questionIndices: [0, 1, 2] }],
        questions: [0, 1, 2].map((choiceIndex) => ({
          choiceIndex,
          stem: `第 ${choiceIndex + 1} 题`,
          options: [{ label: 'A', content: '选项 A' }]
        }))
      }

      render(
        <ChoiceView
          answers={{}}
          meta={meta}
          onAnswer={() => undefined}
          viewport={{ mode: 'focus', choiceIndex: 2 }}
        />
      )

      await waitFor(() => {
        expect(scrolledElement).toBe(screen.getByText('第 3 题').closest('fieldset'))
      })
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
    }
  })
})
