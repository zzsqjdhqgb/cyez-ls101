import type {
  ChoiceGroupExpression,
  FunctionDef,
  FunctionInputDef,
  FunctionInputExpression,
  FunctionNode,
  TemplateDocumentOperation,
  TextExpression,
  ValueExpression
} from '@ls101/template-editor'
import { useEffect, type JSX } from 'react'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { TemplateFunctionSchemaSummary } from './TemplateFunctionSchemaSummary'
import { TemplateVariableInput } from './TemplateVariableInput'
import type { TemplateVariableCandidate } from './TemplateVariableInputModel'
import type { TemplateChoiceGroupCandidate } from './TemplateChoiceTargets'
import styles from './TemplateFunctionCallEditor.module.css'

interface TemplateFunctionCallEditorProps {
  node: FunctionNode
  definition: FunctionDef | undefined
  functions: readonly FunctionDef[]
  variableCandidates: readonly TemplateVariableCandidate[]
  choiceGroupCandidates?: readonly TemplateChoiceGroupCandidate[]
  compact?: boolean
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateFunctionCallEditor({
  node,
  definition,
  functions,
  variableCandidates,
  choiceGroupCandidates = [],
  compact = false,
  apply
}: TemplateFunctionCallEditorProps): JSX.Element {
  const inputs = definition?.inputs ?? fallbackInputs(node)
  const outputs =
    definition?.outputs.map(({ name, type }) => ({ name, type })) ??
    Object.keys(node.outputNames).map((name) => ({ name, type: null }))
  const labelPrefix = compact ? `节点 ${node.id}` : '函数'

  return (
    <div className={styles.editor} data-compact={compact || undefined}>
      <section className={styles.section} aria-label={`${labelPrefix} 入参`}>
        <div className={styles.heading}>
          <ArrowDownToLine aria-hidden="true" />
          <span>入参</span>
          <small>{inputs.length}</small>
        </div>
        {inputs.length > 0 ? (
          <div className={styles.rows}>
            {inputs.map((input) => (
              <FunctionInputRow
                key={input.name}
                input={input}
                label={`${labelPrefix} 入参 ${input.name}`}
                value={node.inputs[input.name]}
                variableCandidates={variableCandidates}
                choiceGroupCandidates={choiceGroupCandidates}
                onChange={(expression) =>
                  apply({
                    type: 'set-function-call-input',
                    nodeId: node.id,
                    inputName: input.name,
                    expression
                  })
                }
              />
            ))}
          </div>
        ) : (
          <span className={styles.empty}>无入参</span>
        )}
      </section>

      <section className={styles.section} aria-label={`${labelPrefix} 出参`}>
        <div className={styles.heading}>
          <ArrowUpFromLine aria-hidden="true" />
          <span>出参</span>
          <small>{outputs.length}</small>
        </div>
        {outputs.length > 0 ? (
          <div className={styles.rows}>
            {outputs.map((output) => (
              <label className={styles.row} key={output.name}>
                <span className={styles.identity} title={output.name}>
                  <strong>{output.name}</strong>
                  {output.type ? <small>{valueTypeLabel(output.type)}</small> : null}
                </span>
                <input
                  aria-label={`${labelPrefix} 出参 ${output.name}`}
                  placeholder="输出变量名"
                  value={node.outputNames[output.name] ?? ''}
                  onChange={(event) =>
                    apply({
                      type: 'set-function-call-output-name',
                      nodeId: node.id,
                      outputName: output.name,
                      value: event.target.value
                    })
                  }
                />
              </label>
            ))}
          </div>
        ) : (
          <span className={styles.empty}>无出参</span>
        )}
      </section>

      {!compact && definition ? (
        <TemplateFunctionSchemaSummary definition={definition} functions={functions} />
      ) : null}

      {!definition ? <div className={styles.warning}>函数定义不可用，当前显示已有绑定</div> : null}
    </div>
  )
}

function FunctionInputRow({
  input,
  value,
  label,
  variableCandidates,
  choiceGroupCandidates,
  onChange
}: {
  input: FunctionInputDef
  value: FunctionInputExpression | undefined
  label: string
  variableCandidates: readonly TemplateVariableCandidate[]
  choiceGroupCandidates: readonly TemplateChoiceGroupCandidate[]
  onChange(expression: FunctionInputExpression): void
}): JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.identity} title={input.name}>
        <strong>{input.name}</strong>
        <small>{valueTypeLabel(input.type)}</small>
      </span>
      <span className={styles.control}>
        {input.type === 'choice-group' ? (
          <ChoiceGroupInput
            choiceGroupCandidates={choiceGroupCandidates}
            input={input}
            label={label}
            value={value}
            onChange={onChange}
          />
        ) : input.type === 'string' ? (
          <TemplateVariableInput
            mode="text"
            ariaLabel={label}
            candidates={variableCandidates}
            placeholder="文本"
            value={asTextExpression(value)}
            onChange={onChange}
          />
        ) : input.type === 'number' ? (
          <TemplateVariableInput
            mode="value"
            ariaLabel={label}
            candidates={variableCandidates}
            inputMode="decimal"
            value={asNumberExpression(value)}
            valueType="number"
            onChange={onChange}
          />
        ) : (
          <TemplateVariableInput
            mode="value"
            ariaLabel={label}
            candidates={variableCandidates}
            inputMode="text"
            placeholder="文件"
            value={asFileExpression(value)}
            valueType="file"
            onChange={onChange}
          />
        )}
      </span>
    </div>
  )
}

function fallbackInputs(node: FunctionNode): FunctionInputDef[] {
  return Object.entries(node.inputs).map(([name, expression]) => {
    if (expression.type !== 'choice-group') return { name, type: expression.type }
    if (expression.selection.kind === 'question') {
      return { name, type: 'choice-group', shape: { kind: 'question' } }
    }
    return {
      name,
      type: 'choice-group',
      shape: {
        kind: expression.selection.kind === 'range' ? 'range' : 'all',
        pageCounts: []
      }
    }
  })
}

function ChoiceGroupInput({
  input,
  choiceGroupCandidates,
  value,
  label,
  onChange
}: {
  input: Extract<FunctionInputDef, { type: 'choice-group' }>
  choiceGroupCandidates: readonly TemplateChoiceGroupCandidate[]
  value: FunctionInputExpression | undefined
  label: string
  onChange(expression: FunctionInputExpression): void
}): JSX.Element {
  const expression = value?.type === 'choice-group' ? value : defaultChoiceGroupInput(input)
  const availableCandidates = choiceGroupCandidates.filter((candidate) =>
    canSelectShape(input.shape, shapePageCounts(candidate.shape), candidate.shape.kind)
  )
  const selectedCandidate =
    availableCandidates.find((candidate) =>
      expression.source === 'global'
        ? candidate.source === 'global'
        : candidate.source === 'local' && candidate.name === expression.name
    ) ?? availableCandidates[0]
  const sourceShape = selectedCandidate?.shape
  const sourcePageCounts = sourceShape ? shapePageCounts(sourceShape) : []
  const sourceValue = selectedCandidate
    ? selectedCandidate.source === 'global'
      ? { source: 'global' as const }
      : { source: 'local' as const, name: selectedCandidate.name ?? '' }
    : expression.source === 'global'
      ? { source: 'global' as const }
      : { source: 'local' as const, name: expression.name }
  const normalizedSelection = normalizeSelection(
    input.shape,
    sourcePageCounts,
    expression.selection
  )
  const normalizedExpression = createNormalizedExpression(selectedCandidate, normalizedSelection)

  useEffect(() => {
    if (!normalizedExpression || sameChoiceGroupExpression(expression, normalizedExpression)) {
      return
    }
    onChange(normalizedExpression)
  }, [expression, normalizedExpression, onChange])

  return (
    <span className={styles.groupControl}>
      <select
        aria-label={`${label} 来源`}
        value={selectedCandidate?.key ?? expressionSourceKey(expression)}
        onChange={(event) => {
          const candidate = availableCandidates.find((item) => item.key === event.target.value)
          if (!candidate) return
          onChange({
            type: 'choice-group',
            ...(candidate.source === 'global'
              ? { source: 'global' as const }
              : { source: 'local' as const, name: candidate.name ?? '' }),
            selection: defaultSelection(input.shape, shapePageCounts(candidate.shape))
          })
        }}
      >
        {availableCandidates.length > 0 ? (
          availableCandidates.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.label}
            </option>
          ))
        ) : (
          <option value={expressionSourceKey(expression)}>当前绑定不可用</option>
        )}
      </select>
      {input.shape.kind === 'range' ? (
        <select
          aria-label={`${label} 起始页`}
          value={normalizedSelection.kind === 'range' ? normalizedSelection.startPage : ''}
          onChange={(event) =>
            onChange({
              ...sourceValue,
              type: 'choice-group',
              selection: { kind: 'range', startPage: Number(event.target.value) }
            })
          }
        >
          {rangeStarts(sourcePageCounts, input.shape.pageCounts).map((pageIndex) => (
            <option key={pageIndex} value={pageIndex}>
              第 {pageIndex + 1} 页
            </option>
          ))}
        </select>
      ) : input.shape.kind === 'question' ? (
        <>
          <select
            aria-label={`${label} 页面`}
            value={normalizedSelection.kind === 'question' ? normalizedSelection.pageIndex : ''}
            onChange={(event) =>
              onChange(
                withQuestionPage(
                  { ...sourceValue, type: 'choice-group', selection: normalizedSelection },
                  Number(event.target.value)
                )
              )
            }
          >
            {sourcePageCounts.map((_count, pageIndex) => (
              <option key={pageIndex} value={pageIndex}>
                第 {pageIndex + 1} 页
              </option>
            ))}
          </select>
          <select
            aria-label={`${label} 题目`}
            value={normalizedSelection.kind === 'question' ? normalizedSelection.questionIndex : ''}
            onChange={(event) =>
              onChange(
                withQuestionIndex(
                  { ...sourceValue, type: 'choice-group', selection: normalizedSelection },
                  Number(event.target.value)
                )
              )
            }
          >
            {Array.from(
              {
                length:
                  sourcePageCounts[
                    normalizedSelection.kind === 'question' ? normalizedSelection.pageIndex : 0
                  ] ?? 0
              },
              (_item, index) => (
                <option key={index} value={index}>
                  第 {index + 1} 题
                </option>
              )
            )}
          </select>
        </>
      ) : (
        <span>整个题组</span>
      )}
    </span>
  )
}

function createNormalizedExpression(
  candidate: TemplateChoiceGroupCandidate | undefined,
  selection: ChoiceGroupExpression['selection']
): ChoiceGroupExpression | null {
  if (!candidate) return null
  return {
    type: 'choice-group',
    ...(candidate.source === 'global'
      ? { source: 'global' as const }
      : { source: 'local' as const, name: candidate.name ?? '' }),
    selection
  }
}

function sameChoiceGroupExpression(
  left: ChoiceGroupExpression,
  right: ChoiceGroupExpression
): boolean {
  if (left.source !== right.source) return false
  if (left.source === 'local' && right.source === 'local' && left.name !== right.name) {
    return false
  }
  if (left.selection.kind !== right.selection.kind) return false
  if (left.selection.kind === 'all' || right.selection.kind === 'all') return true
  if (left.selection.kind === 'range' && right.selection.kind === 'range') {
    return left.selection.startPage === right.selection.startPage
  }
  if (left.selection.kind === 'question' && right.selection.kind === 'question') {
    return (
      left.selection.pageIndex === right.selection.pageIndex &&
      left.selection.questionIndex === right.selection.questionIndex
    )
  }
  return false
}

function defaultChoiceGroupInput(
  input: Extract<FunctionInputDef, { type: 'choice-group' }>
): ChoiceGroupExpression {
  if (input.shape.kind === 'question') {
    return {
      type: 'choice-group',
      source: 'global',
      selection: { kind: 'question', pageIndex: 0, questionIndex: 0 }
    }
  }
  if (input.shape.kind === 'range') {
    return {
      type: 'choice-group',
      source: 'global',
      selection: { kind: 'range', startPage: 0 }
    }
  }
  return { type: 'choice-group', source: 'global', selection: { kind: 'all' } }
}

function shapePageCounts(shape: TemplateChoiceGroupCandidate['shape']): number[] {
  return shape.kind === 'question' ? [1] : shape.pageCounts
}

function expressionSourceKey(expression: ChoiceGroupExpression): string {
  return expression.source === 'global' ? 'global' : `local:${expression.name}`
}

function defaultSelection(
  shape: Extract<FunctionInputDef, { type: 'choice-group' }>['shape'],
  sourcePageCounts: readonly number[]
): ChoiceGroupExpression['selection'] {
  if (shape.kind === 'question') return { kind: 'question', pageIndex: 0, questionIndex: 0 }
  if (shape.kind === 'range') {
    return { kind: 'range', startPage: rangeStarts(sourcePageCounts, shape.pageCounts)[0] ?? 0 }
  }
  return { kind: 'all' }
}

function canSelectShape(
  shape: Extract<FunctionInputDef, { type: 'choice-group' }>['shape'],
  sourcePageCounts: readonly number[],
  sourceKind: TemplateChoiceGroupCandidate['shape']['kind']
): boolean {
  if (shape.kind === 'question') return sourcePageCounts.some((count) => count > 0)
  if (shape.kind === 'range') return rangeStarts(sourcePageCounts, shape.pageCounts).length > 0
  return (
    sourceKind === 'all' &&
    sourcePageCounts.length === shape.pageCounts.length &&
    shape.pageCounts.every((count, index) => sourcePageCounts[index] === count)
  )
}

function normalizeSelection(
  shape: Extract<FunctionInputDef, { type: 'choice-group' }>['shape'],
  sourcePageCounts: readonly number[],
  selection: ChoiceGroupExpression['selection']
): ChoiceGroupExpression['selection'] {
  const fallback = defaultSelection(shape, sourcePageCounts)
  if (shape.kind === 'all') return fallback
  if (shape.kind === 'range') {
    const starts = rangeStarts(sourcePageCounts, shape.pageCounts)
    return selection.kind === 'range' && starts.includes(selection.startPage)
      ? selection
      : { kind: 'range', startPage: starts[0] ?? 0 }
  }
  const pageIndex = selection.kind === 'question' ? selection.pageIndex : 0
  const safePage = Math.min(Math.max(pageIndex, 0), Math.max(0, sourcePageCounts.length - 1))
  const questionCount = sourcePageCounts[safePage] ?? 0
  const questionIndex =
    selection.kind === 'question'
      ? Math.min(Math.max(selection.questionIndex, 0), Math.max(0, questionCount - 1))
      : 0
  return { kind: 'question', pageIndex: safePage, questionIndex }
}

function rangeStarts(
  sourcePageCounts: readonly number[],
  expectedPageCounts: readonly number[]
): number[] {
  if (expectedPageCounts.length === 0) return []
  const starts: number[] = []
  for (let start = 0; start + expectedPageCounts.length <= sourcePageCounts.length; start += 1) {
    if (expectedPageCounts.every((count, index) => sourcePageCounts[start + index] === count)) {
      starts.push(start)
    }
  }
  return starts
}

function withQuestionPage(
  expression: ChoiceGroupExpression,
  pageIndex: number
): ChoiceGroupExpression {
  if (expression.selection.kind !== 'question') return expression
  return {
    ...expression,
    selection: {
      kind: 'question',
      pageIndex,
      questionIndex: expression.selection.questionIndex
    }
  }
}

function withQuestionIndex(
  expression: ChoiceGroupExpression,
  questionIndex: number
): ChoiceGroupExpression {
  if (expression.selection.kind !== 'question') return expression
  return {
    ...expression,
    selection: {
      kind: 'question',
      pageIndex: expression.selection.pageIndex,
      questionIndex
    }
  }
}

function asTextExpression(value: FunctionInputExpression | undefined): TextExpression {
  if (!value || value.type !== 'string') {
    return { type: 'string', parts: [{ type: 'literal', value: '' }] }
  }
  if ('parts' in value) return value
  return {
    type: 'string',
    parts: [
      value.source === 'literal'
        ? { type: 'literal', value: value.value }
        : { type: 'variable', ref: value.ref }
    ]
  }
}

function asNumberExpression(value: FunctionInputExpression | undefined): ValueExpression<'number'> {
  return value?.type === 'number' ? value : { type: 'number', source: 'literal', value: 0 }
}

function asFileExpression(value: FunctionInputExpression | undefined): ValueExpression<'file'> {
  return value?.type === 'file' ? value : { type: 'file', source: 'literal', value: '' }
}

function valueTypeLabel(type: string): string {
  if (type === 'string') return '文本'
  if (type === 'number') return '数字'
  if (type === 'file') return '文件'
  if (type === 'audio') return '录音'
  if (type === 'choice') return '选择结果'
  if (type === 'choice-group') return '选择题组'
  return type
}
