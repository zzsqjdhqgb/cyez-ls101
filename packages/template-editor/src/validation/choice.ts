import type { ChoiceViewport, FrameNode, TemplateNode } from '../types'
import { addError, type ValidationState } from './shared'

export interface ChoiceAnalysis {
  uncollectedQuestionCount: number
  candidatePageCounts: number[]
  viewports: ViewportUse[]
}

interface ViewportUse {
  path: string
  viewport: ChoiceViewport
}

export function analyzeChoiceFrame(
  frame: FrameNode,
  path: string,
  functionStack: readonly string[],
  state: ValidationState
): ChoiceAnalysis {
  const childResult = mergeChoiceAnalyses(
    frame.children.map((child, index) =>
      analyzeChoiceNode(child, `${path}.children[${index}]`, functionStack, state)
    )
  )

  if (!frame.choiceCollector) return childResult

  const collectorPath = `${path}.choiceCollector`
  if (childResult.candidatePageCounts.length > 0) {
    addError(state, collectorPath, 'NESTED_CHOICE_COLLECTOR')
  }
  if (childResult.uncollectedQuestionCount === 0) {
    addError(state, collectorPath, 'EMPTY_CHOICE_COLLECTOR')
  }
  if (frame.choiceCollector.pages.length === 0) {
    addError(state, `${collectorPath}.pages`, 'EMPTY_CHOICE_COLLECTOR_PAGES')
  }

  let configuredQuestionCount = 0
  frame.choiceCollector.pages.forEach((page, index) => {
    if (!Number.isInteger(page.questionCount) || page.questionCount <= 0) {
      addError(
        state,
        `${collectorPath}.pages[${index}].questionCount`,
        'INVALID_CHOICE_PAGE_SIZE',
        { value: page.questionCount }
      )
      return
    }
    configuredQuestionCount += page.questionCount
  })
  if (configuredQuestionCount !== childResult.uncollectedQuestionCount) {
    addError(state, `${collectorPath}.pages`, 'CHOICE_PAGE_TOTAL_MISMATCH', {
      expected: childResult.uncollectedQuestionCount,
      actual: configuredQuestionCount
    })
  }

  return {
    uncollectedQuestionCount: 0,
    candidatePageCounts: [...childResult.candidatePageCounts, frame.choiceCollector.pages.length],
    viewports: childResult.viewports
  }
}

function analyzeChoiceNode(
  node: TemplateNode,
  path: string,
  functionStack: readonly string[],
  state: ValidationState
): ChoiceAnalysis {
  switch (node.type) {
    case 'frame':
      return analyzeChoiceFrame(node, path, functionStack, state)
    case 'choice-question':
      return emptyChoiceAnalysis({ uncollectedQuestionCount: 1 })
    case 'page': {
      const viewports: ViewportUse[] = []
      node.content.blocks.forEach((block, index) => {
        if (block.type === 'choice-view') {
          viewports.push({
            path: `${path}.content.blocks[${index}].defaultViewport`,
            viewport: block.defaultViewport
          })
        }
      })
      node.timeline.forEach((step, stepIndex) => {
        for (const [blockId, viewport] of Object.entries(step.choiceViewOverrides ?? {})) {
          viewports.push({
            path: `${path}.timeline[${stepIndex}].choiceViewOverrides[${JSON.stringify(blockId)}]`,
            viewport
          })
        }
      })
      return emptyChoiceAnalysis({ viewports })
    }
    case 'function': {
      const func = state.functionsById.get(node.functionRef)
      if (!func || functionStack.includes(func.id)) return emptyChoiceAnalysis()
      return analyzeChoiceFrame(func.body, `${path}.function`, [...functionStack, func.id], state)
    }
  }
}

function emptyChoiceAnalysis(overrides: Partial<ChoiceAnalysis> = {}): ChoiceAnalysis {
  return {
    uncollectedQuestionCount: 0,
    candidatePageCounts: [],
    viewports: [],
    ...overrides
  }
}

function mergeChoiceAnalyses(results: readonly ChoiceAnalysis[]): ChoiceAnalysis {
  return results.reduce<ChoiceAnalysis>(
    (merged, result) => ({
      uncollectedQuestionCount: merged.uncollectedQuestionCount + result.uncollectedQuestionCount,
      candidatePageCounts: [...merged.candidatePageCounts, ...result.candidatePageCounts],
      viewports: [...merged.viewports, ...result.viewports]
    }),
    emptyChoiceAnalysis()
  )
}

export function validateChoiceResult(result: ChoiceAnalysis, state: ValidationState): void {
  if (result.candidatePageCounts.length > 1) {
    addError(state, 'root', 'MULTIPLE_CHOICE_COLLECTORS', {
      count: result.candidatePageCounts.length
    })
  }
  if (result.uncollectedQuestionCount > 0) {
    addError(state, 'root', 'UNCOLLECTED_CHOICE_QUESTIONS', {
      count: result.uncollectedQuestionCount
    })
  }
  if (result.viewports.length > 0 && result.candidatePageCounts.length !== 1) {
    result.viewports.forEach((viewport) =>
      addError(state, viewport.path, 'CHOICE_VIEW_WITHOUT_META')
    )
  }

  const pageCount =
    result.candidatePageCounts.length === 1 ? result.candidatePageCounts[0] : undefined
  result.viewports.forEach(({ path, viewport }) =>
    validateChoiceViewport(viewport, pageCount, path, state)
  )
}

function validateChoiceViewport(
  viewport: ChoiceViewport,
  pageCount: number | undefined,
  path: string,
  state: ValidationState
): void {
  if (viewport.mode === 'focus') {
    if (!viewport.questionRef.questionId.trim()) {
      addError(state, `${path}.questionRef.questionId`, 'EMPTY_FOCUS_REFERENCE')
    }
    viewport.questionRef.callPath.forEach((callId, index) => {
      if (!callId.trim()) {
        addError(state, `${path}.questionRef.callPath[${index}]`, 'INVALID_FOCUS_CALL_PATH')
      }
    })
    return
  }

  if (viewport.mode === 'free') {
    if (viewport.initialPage !== undefined) {
      validatePageIndex(viewport.initialPage, pageCount, `${path}.initialPage`, state)
    }
    return
  }

  const startIsValid = validatePageIndex(viewport.startPage, pageCount, `${path}.startPage`, state)
  const endIsValid = validatePageIndex(viewport.endPage, pageCount, `${path}.endPage`, state)
  if (startIsValid && endIsValid && viewport.startPage > viewport.endPage) {
    addError(state, path, 'INVALID_CHOICE_VIEWPORT', {
      startPage: viewport.startPage,
      endPage: viewport.endPage
    })
  }
  if (viewport.initialPage !== undefined) {
    const initialIsValid = validatePageIndex(
      viewport.initialPage,
      pageCount,
      `${path}.initialPage`,
      state
    )
    if (
      initialIsValid &&
      (viewport.initialPage < viewport.startPage || viewport.initialPage > viewport.endPage)
    ) {
      addError(state, `${path}.initialPage`, 'INVALID_CHOICE_VIEWPORT', {
        initialPage: viewport.initialPage,
        startPage: viewport.startPage,
        endPage: viewport.endPage
      })
    }
  }
}

function validatePageIndex(
  value: number,
  pageCount: number | undefined,
  path: string,
  state: ValidationState
): boolean {
  const valid =
    Number.isInteger(value) && value >= 0 && (pageCount === undefined || value < pageCount)
  if (!valid) {
    addError(state, path, 'INVALID_CHOICE_VIEWPORT', {
      value,
      ...(pageCount === undefined ? {} : { pageCount })
    })
  }
  return valid
}
