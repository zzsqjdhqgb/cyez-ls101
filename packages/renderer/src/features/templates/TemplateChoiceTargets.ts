import type {
  ChoiceQuestionRef,
  FrameNode,
  FunctionDef,
  TemplateNode
} from '@ls101/template-editor'

export interface TemplateChoiceTarget {
  pageIndex: number
  questionIndex: number
  ref: ChoiceQuestionRef
}

export interface TemplateChoiceTargetPage {
  pageIndex: number
  questions: readonly TemplateChoiceTarget[]
}

interface ChoiceTraversalResult {
  uncollected: ChoiceQuestionRef[]
  candidates: ChoiceQuestionRef[][][]
}

const EMPTY_RESULT: ChoiceTraversalResult = { uncollected: [], candidates: [] }

export function collectTemplateChoiceTargetPages(
  root: FrameNode,
  functions: readonly FunctionDef[]
): readonly TemplateChoiceTargetPage[] {
  const functionsById = new Map(functions.map((definition) => [definition.id, definition]))
  const result = traverseFrame(root, [], functionsById, new Set())
  if (result.candidates.length !== 1) return []
  return result.candidates[0].map((questions, pageIndex) => ({
    pageIndex,
    questions: questions.map((ref, questionIndex) => ({ pageIndex, questionIndex, ref }))
  }))
}

export function sameChoiceQuestionRef(
  first: ChoiceQuestionRef,
  second: ChoiceQuestionRef
): boolean {
  return (
    first.questionId === second.questionId &&
    first.callPath.length === second.callPath.length &&
    first.callPath.every((part, index) => part === second.callPath[index])
  )
}

function traverseFrame(
  frame: FrameNode,
  callPath: readonly string[],
  functions: ReadonlyMap<string, FunctionDef>,
  activeFunctions: ReadonlySet<string>
): ChoiceTraversalResult {
  const children = mergeResults(
    frame.children.map((node) => traverseNode(node, callPath, functions, activeFunctions))
  )
  if (!frame.choiceCollector) return children

  let offset = 0
  const pages = frame.choiceCollector.pages.map((page) => {
    const questions = children.uncollected.slice(offset, offset + page.questionCount)
    offset += page.questionCount
    return questions
  })
  return {
    uncollected: [],
    candidates: [...children.candidates, pages]
  }
}

function traverseNode(
  node: TemplateNode,
  callPath: readonly string[],
  functions: ReadonlyMap<string, FunctionDef>,
  activeFunctions: ReadonlySet<string>
): ChoiceTraversalResult {
  if (node.type === 'frame') {
    return traverseFrame(node, callPath, functions, activeFunctions)
  }
  if (node.type === 'choice-question') {
    return {
      uncollected: [
        {
          scope: 'absolute',
          callPath: [...callPath],
          questionId: node.id
        }
      ],
      candidates: []
    }
  }
  if (node.type !== 'function') return EMPTY_RESULT

  const definition = functions.get(node.functionRef)
  if (!definition || activeFunctions.has(definition.id)) return EMPTY_RESULT
  return traverseFrame(
    definition.body,
    [...callPath, node.id],
    functions,
    new Set(activeFunctions).add(definition.id)
  )
}

function mergeResults(results: readonly ChoiceTraversalResult[]): ChoiceTraversalResult {
  return {
    uncollected: results.flatMap((result) => result.uncollected),
    candidates: results.flatMap((result) => result.candidates)
  }
}
