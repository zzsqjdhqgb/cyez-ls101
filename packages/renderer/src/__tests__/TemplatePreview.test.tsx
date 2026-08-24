// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerChoiceMeta, ResolvedChoiceViewport } from '@ls101/core-types'
import type {
  TemplatePreviewData,
  TemplatePreviewPage,
  TemplatePreviewTimelineStep
} from '@ls101/template-editor'
import {
  TemplatePreviewCanvas,
  TemplatePreviewFilmstrip,
  type TemplatePreviewSnapshot
} from '../features/templates/TemplatePreview'

afterEach(cleanup)

const choiceMeta: PlayerChoiceMeta = {
  pages: [{ questionIndices: [0] }, { questionIndices: [1] }, { questionIndices: [2] }],
  questions: [
    {
      choiceIndex: 0,
      stem: '第一题',
      options: [
        { label: 'A', content: '选项 A1' },
        { label: 'B', content: '选项 B1' }
      ]
    },
    {
      choiceIndex: 1,
      stem: '第二题',
      options: [
        { label: 'A', content: '选项 A2' },
        { label: 'B', content: '选项 B2' }
      ]
    },
    {
      choiceIndex: 2,
      stem: '第三题',
      options: [
        { label: 'A', content: '选项 A3' },
        { label: 'B', content: '选项 B3' }
      ]
    }
  ]
}

const preview: TemplatePreviewData = {
  title: '选择题预览',
  pages: [],
  recordingIndices: [],
  choiceMeta,
  resources: {}
}

describe('Template preview', () => {
  it('keeps interactive controls outside the filmstrip selection button', () => {
    const snapshot = createSnapshot('snapshot-free', { mode: 'free' })
    const { container } = render(
      <TemplatePreviewFilmstrip
        compiling={false}
        error={null}
        missingInstances={false}
        preview={preview}
        result={null}
        selectedIndex={0}
        snapshots={[snapshot]}
        onSelect={vi.fn()}
      />
    )

    const selectButton = screen.getByRole('button', { name: '预览画面 1，倒计时' })
    const thumbnail = container.querySelector('[inert]')
    const rendererHost = thumbnail?.querySelector<HTMLElement>('[data-exam-page-view]')
    expect(selectButton.querySelector('button, input')).toBeNull()
    expect(thumbnail).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('[data-exam-page-view] input')).toBeNull()
    expect(rendererHost).toHaveAttribute('data-style-isolation', 'shadow')
    expect(rendererHost?.shadowRoot?.querySelector('input')).not.toBeNull()
    expect(
      rendererHost?.shadowRoot?.querySelector('style[data-exam-page-view-styles]')
    ).not.toBeNull()
  })

  it('keeps the main ChoiceView interactive and resets it when the snapshot changes', () => {
    const first = createSnapshot('snapshot-range-1', {
      mode: 'range',
      startPage: 0,
      endPage: 1
    })
    const second = createSnapshot('snapshot-range-2', {
      mode: 'range',
      startPage: 0,
      endPage: 1
    })
    const { rerender } = renderCanvas(first)
    const firstPage = withinPreviewPage('最终画面 1')

    expect(firstPage.getByText('第一题')).toBeInTheDocument()
    expect(firstPage.getByText('1 / 2')).toBeInTheDocument()
    fireEvent.click(firstPage.getByRole('button', { name: '下一页' }))
    expect(firstPage.getByText('第二题')).toBeInTheDocument()
    fireEvent.click(firstPage.getByRole('radio', { name: /选项 B2/ }))
    expect(firstPage.getByRole('radio', { name: /选项 B2/ })).toBeChecked()

    rerender(canvas(second))
    const resetPage = withinPreviewPage('最终画面 1')
    expect(resetPage.getByText('第一题')).toBeInTheDocument()
    expect(resetPage.getByRole('radio', { name: /选项 B1/ })).not.toBeChecked()
  })

  it('shows free, range, and focus configuration in a separate information popover', () => {
    const { rerender } = renderCanvas(
      createSnapshot('snapshot-free', { mode: 'free', initialPage: 1 })
    )

    openChoiceInfo()
    expect(screen.getByRole('region', { name: 'ChoiceView 配置' })).toHaveTextContent('全部分页')
    expect(screen.getByRole('region', { name: 'ChoiceView 配置' })).toHaveTextContent('第 1–3 页')
    expect(screen.getByRole('region', { name: 'ChoiceView 配置' })).toHaveTextContent('第 2 页')

    rerender(
      canvas(
        createSnapshot('snapshot-range', {
          mode: 'range',
          startPage: 1,
          endPage: 2,
          initialPage: 2
        })
      )
    )
    expect(screen.queryByRole('region', { name: 'ChoiceView 配置' })).not.toBeInTheDocument()
    openChoiceInfo()
    expect(screen.getByRole('region', { name: 'ChoiceView 配置' })).toHaveTextContent('限制范围')
    expect(screen.getByRole('region', { name: 'ChoiceView 配置' })).toHaveTextContent('第 2–3 页')

    rerender(canvas(createSnapshot('snapshot-focus', { mode: 'focus', choiceIndex: 2 })))
    openChoiceInfo()
    const focusInfo = screen.getByRole('region', { name: 'ChoiceView 配置' })
    expect(focusInfo).toHaveTextContent('聚焦题目')
    expect(focusInfo).toHaveTextContent('第 3 题')
    expect(focusInfo).toHaveTextContent('第 3 页')
  })

  it('uses the full canvas for the empty preview state', () => {
    const { container } = render(
      <TemplatePreviewCanvas
        position={0}
        preview={null}
        resourceUrls={{}}
        snapshot={null}
        total={0}
      />
    )

    expect(screen.getByText('没有可预览的画面')).toBeVisible()
    expect(container.firstElementChild?.firstElementChild?.className).toContain('canvasEmpty')
  })
})

function createSnapshot(id: string, viewport: ResolvedChoiceViewport): TemplatePreviewSnapshot {
  const step: TemplatePreviewTimelineStep = { type: 'countdown', seconds: 5 }
  const page: TemplatePreviewPage = {
    id: `page:${id}`,
    sourceNodeId: id,
    sourceNodeName: '选择题页面',
    callPath: [],
    content: [
      {
        id: 'choice-view',
        type: 'choice-view',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        defaultViewport: viewport
      }
    ],
    timeline: [step]
  }
  return { id, page, pageIndex: 0, step, stepIndex: 0 }
}

function canvas(snapshot: TemplatePreviewSnapshot): JSX.Element {
  return (
    <TemplatePreviewCanvas
      position={0}
      preview={preview}
      resourceUrls={{}}
      snapshot={snapshot}
      total={1}
    />
  )
}

function renderCanvas(snapshot: TemplatePreviewSnapshot): ReturnType<typeof render> {
  return render(canvas(snapshot))
}

function openChoiceInfo(): void {
  fireEvent.click(screen.getByRole('button', { name: '查看 ChoiceView 配置' }))
}

function withinPreviewPage(label: string): ReturnType<typeof within> {
  const shadowRoot = screen.getByLabelText(label).shadowRoot
  if (!shadowRoot) throw new Error(`missing Shadow Root for ${label}`)
  return within(shadowRoot as unknown as HTMLElement)
}
