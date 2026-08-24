import type { JSX } from 'react'
import {
  type FunctionDocumentOperation,
  type FunctionInputDef,
  type FunctionOutputDef,
  type TemplateValueType,
  type ValueExpression
} from '@ls101/template-editor'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { TemplateVariableInput } from './TemplateVariableInput'
import type { TemplateVariableCandidate } from './TemplateVariableInputModel'
import styles from './FunctionSignatureEditor.module.css'

interface FunctionSignatureEditorProps {
  inputs: readonly FunctionInputDef[]
  outputs: readonly FunctionOutputDef[]
  variableCandidates: readonly TemplateVariableCandidate[]
  disabled?: boolean
  apply(operation: FunctionDocumentOperation): boolean
}

const INPUT_TYPES: readonly FunctionInputDef['type'][] = [
  'string',
  'number',
  'file',
  'choice-group'
]
const OUTPUT_TYPES: readonly FunctionOutputDef['type'][] = [
  'string',
  'number',
  'file',
  'audio',
  'choice'
]

export function FunctionSignatureEditor({
  inputs,
  outputs,
  variableCandidates,
  disabled = false,
  apply
}: FunctionSignatureEditorProps): JSX.Element {
  const addInput = (): void => {
    apply({
      type: 'insert-function-input',
      input: {
        name: availableName(
          'input',
          inputs.map((item) => item.name)
        ),
        type: 'string'
      }
    })
  }

  const addOutput = (): void => {
    apply({
      type: 'insert-function-output',
      output: defaultOutput(
        availableName(
          'output',
          outputs.map((item) => item.name)
        ),
        'string'
      )
    })
  }

  return (
    <div className={styles.root}>
      <section className={styles.group} aria-labelledby="function-inputs-heading">
        <div className={styles.heading}>
          <div>
            <strong id="function-inputs-heading">输入</strong>
            <span>{inputs.length} 项</span>
          </div>
          <Button
            aria-label="添加输入"
            icon={Plus}
            size="small"
            disabled={disabled}
            onClick={addInput}
          >
            添加
          </Button>
        </div>
        {inputs.length === 0 ? <p className={styles.empty}>没有函数输入</p> : null}
        <div className={styles.list}>
          {inputs.map((input, index) => (
            <div className={styles.item} key={index}>
              <div className={styles.itemHeading}>
                <strong>输入 {index + 1}</strong>
                <IconButton
                  icon={Trash2}
                  label={`删除输入 ${input.name}`}
                  size="small"
                  variant="danger"
                  disabled={disabled}
                  onClick={() => apply({ type: 'remove-function-input', name: input.name })}
                />
              </div>
              <label>
                名称
                <input
                  aria-label={`输入 ${index + 1} 名称`}
                  disabled={disabled}
                  value={input.name}
                  onChange={(event) =>
                    apply({
                      type: 'update-function-input',
                      name: input.name,
                      input: { ...input, name: event.target.value }
                    })
                  }
                />
              </label>
              <label>
                类型
                <select
                  aria-label={`输入 ${index + 1} 类型`}
                  disabled={disabled}
                  value={input.type}
                  onChange={(event) =>
                    apply({
                      type: 'update-function-input',
                      name: input.name,
                      input: inputWithType(
                        input.name,
                        event.target.value as FunctionInputDef['type']
                      )
                    })
                  }
                >
                  {INPUT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              {input.type === 'choice-group' ? (
                <>
                  <label>
                    形状
                    <select
                      aria-label={`输入 ${index + 1} 题组形状`}
                      disabled={disabled}
                      value={input.shape.kind}
                      onChange={(event) => {
                        const kind = event.target.value as 'question' | 'range' | 'all'
                        apply({
                          type: 'update-function-input',
                          name: input.name,
                          input: {
                            name: input.name,
                            type: 'choice-group',
                            shape:
                              kind === 'question'
                                ? { kind }
                                : {
                                    kind,
                                    pageCounts:
                                      input.shape.kind === 'question' ? [1] : input.shape.pageCounts
                                  }
                          }
                        })
                      }}
                    >
                      <option value="question">单题</option>
                      <option value="range">连续范围</option>
                      <option value="all">完整题组</option>
                    </select>
                  </label>
                  {input.shape.kind !== 'question' ? (
                    <div className={styles.pageCounts}>
                      <div className={styles.pageCountsHeading}>
                        <span>每页题数</span>
                        <Button
                          aria-label={`输入 ${index + 1} 添加页面`}
                          icon={Plus}
                          size="small"
                          disabled={disabled}
                          onClick={() =>
                            apply({
                              type: 'update-function-input',
                              name: input.name,
                              input: addPageCount(input)
                            })
                          }
                        >
                          添加页面
                        </Button>
                      </div>
                      <div className={styles.pageCountList}>
                        {input.shape.pageCounts.map((questionCount, pageIndex) => (
                          <div className={styles.pageCountRow} key={pageIndex}>
                            <span>第 {pageIndex + 1} 页</span>
                            <input
                              aria-label={`输入 ${index + 1} 第 ${pageIndex + 1} 页题数`}
                              disabled={disabled}
                              inputMode="numeric"
                              min={1}
                              step={1}
                              type="number"
                              value={questionCount}
                              onChange={(event) =>
                                apply({
                                  type: 'update-function-input',
                                  name: input.name,
                                  input: updatePageCount(input, pageIndex, event.target.value)
                                })
                              }
                            />
                            <IconButton
                              icon={Trash2}
                              label={`输入 ${index + 1} 删除第 ${pageIndex + 1} 页`}
                              size="small"
                              variant="danger"
                              disabled={disabled || input.shape.pageCounts.length === 1}
                              onClick={() =>
                                apply({
                                  type: 'update-function-input',
                                  name: input.name,
                                  input: removePageCount(input, pageIndex)
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.group} aria-labelledby="function-outputs-heading">
        <div className={styles.heading}>
          <div>
            <strong id="function-outputs-heading">输出</strong>
            <span>{outputs.length} 项</span>
          </div>
          <Button
            aria-label="添加输出"
            icon={Plus}
            size="small"
            disabled={disabled}
            onClick={addOutput}
          >
            添加
          </Button>
        </div>
        {outputs.length === 0 ? <p className={styles.empty}>没有函数输出</p> : null}
        <div className={styles.list}>
          {outputs.map((output, index) => (
            <div className={styles.item} key={index}>
              <div className={styles.itemHeading}>
                <strong>输出 {index + 1}</strong>
                <IconButton
                  icon={Trash2}
                  label={`删除输出 ${output.name}`}
                  size="small"
                  variant="danger"
                  disabled={disabled}
                  onClick={() => apply({ type: 'remove-function-output', name: output.name })}
                />
              </div>
              <label>
                名称
                <input
                  aria-label={`输出 ${index + 1} 名称`}
                  disabled={disabled}
                  value={output.name}
                  onChange={(event) =>
                    apply({
                      type: 'update-function-output',
                      name: output.name,
                      output: { ...output, name: event.target.value }
                    })
                  }
                />
              </label>
              <label>
                类型
                <select
                  aria-label={`输出 ${index + 1} 类型`}
                  disabled={disabled}
                  value={output.type}
                  onChange={(event) =>
                    apply({
                      type: 'update-function-output',
                      name: output.name,
                      output: defaultOutput(
                        output.name,
                        event.target.value as FunctionOutputDef['type']
                      )
                    })
                  }
                >
                  {OUTPUT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <OutputExpressionEditor
                disabled={disabled}
                index={index}
                output={output}
                variableCandidates={variableCandidates}
                onChange={(next) =>
                  apply({ type: 'update-function-output', name: output.name, output: next })
                }
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function OutputExpressionEditor({
  output,
  index,
  variableCandidates,
  disabled,
  onChange
}: {
  output: FunctionOutputDef
  index: number
  variableCandidates: readonly TemplateVariableCandidate[]
  disabled: boolean
  onChange(output: FunctionOutputDef): void
}): JSX.Element {
  if (output.type === 'audio' || output.type === 'choice') {
    const candidates = variableCandidates.filter(
      (candidate) => candidate.type === output.type && candidate.ref.scope === 'local'
    )
    return (
      <label>
        来源
        <select
          aria-label={`输出 ${index + 1} 来源`}
          disabled={disabled}
          value={output.expression.name}
          onChange={(event) => onChange(withRuntimeOutputName(output, event.target.value))}
        >
          <option value="">未选择</option>
          {candidates.map((candidate) => (
            <option
              key={candidate.key}
              value={candidate.ref.scope === 'local' ? candidate.ref.name : ''}
            >
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (output.type === 'string' && 'parts' in output.expression) {
    return (
      <label>
        表达式
        <TemplateVariableInput
          ariaLabel={`输出 ${index + 1} 表达式`}
          candidates={variableCandidates}
          disabled={disabled}
          mode="text"
          value={output.expression}
          onChange={(expression) => onChange({ ...output, expression })}
        />
      </label>
    )
  }

  if (output.type === 'string') {
    return (
      <label>
        表达式
        <TemplateVariableInput
          ariaLabel={`输出 ${index + 1} 表达式`}
          candidates={variableCandidates}
          disabled={disabled}
          mode="value"
          value={output.expression as ValueExpression<'string'>}
          valueType="string"
          onChange={(expression) => onChange({ ...output, expression })}
        />
      </label>
    )
  }

  if (output.type === 'number') {
    return (
      <label>
        表达式
        <TemplateVariableInput
          ariaLabel={`输出 ${index + 1} 表达式`}
          candidates={variableCandidates}
          disabled={disabled}
          inputMode="decimal"
          mode="value"
          value={output.expression}
          valueType="number"
          onChange={(expression) => onChange({ ...output, expression })}
        />
      </label>
    )
  }

  return (
    <label>
      表达式
      <TemplateVariableInput
        ariaLabel={`输出 ${index + 1} 表达式`}
        candidates={variableCandidates}
        disabled={disabled}
        mode="value"
        value={output.expression}
        valueType="file"
        onChange={(expression) => onChange({ ...output, expression })}
      />
    </label>
  )
}

function defaultOutput(name: string, type: FunctionOutputDef['type']): FunctionOutputDef {
  if (type === 'string') {
    return {
      name,
      type,
      expression: { type: 'string', parts: [{ type: 'literal', value: '' }] }
    }
  }
  if (type === 'number') {
    return { name, type, expression: { type: 'number', source: 'literal', value: 0 } }
  }
  if (type === 'file') {
    return { name, type, expression: { type: 'file', source: 'literal', value: '' } }
  }
  if (type === 'audio') {
    return { name, type, expression: { type: 'audio', source: 'record-output', name: '' } }
  }
  return { name, type, expression: { type: 'choice', source: 'choice-output', name: '' } }
}

function withRuntimeOutputName(
  output: Extract<FunctionOutputDef, { type: 'audio' | 'choice' }>,
  name: string
): FunctionOutputDef {
  if (output.type === 'audio') {
    return { ...output, expression: { ...output.expression, name } }
  }
  return { ...output, expression: { ...output.expression, name } }
}

function availableName(prefix: string, names: readonly string[]): string {
  const used = new Set(names)
  if (!used.has(prefix)) return prefix
  let suffix = 2
  while (used.has(`${prefix}${suffix}`)) suffix += 1
  return `${prefix}${suffix}`
}

function typeLabel(type: TemplateValueType): string {
  if (type === 'string') return '文本'
  if (type === 'number') return '数字'
  if (type === 'file') return '文件'
  if (type === 'audio') return '录音'
  if (type === 'choice-group') return '选择题组'
  return '选择题答案'
}

function inputWithType(name: string, type: FunctionInputDef['type']): FunctionInputDef {
  return type === 'choice-group' ? { name, type, shape: { kind: 'question' } } : { name, type }
}

function addPageCount(
  input: Extract<FunctionInputDef, { type: 'choice-group' }>
): FunctionInputDef {
  if (input.shape.kind === 'question') return input
  return {
    ...input,
    shape: { kind: input.shape.kind, pageCounts: [...input.shape.pageCounts, 1] }
  }
}

function updatePageCount(
  input: Extract<FunctionInputDef, { type: 'choice-group' }>,
  pageIndex: number,
  value: string
): FunctionInputDef {
  if (input.shape.kind === 'question') return input
  const parsed = Number(value)
  const questionCount = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1
  return {
    ...input,
    shape: {
      kind: input.shape.kind,
      pageCounts: input.shape.pageCounts.map((count, index) =>
        index === pageIndex ? questionCount : count
      )
    }
  }
}

function removePageCount(
  input: Extract<FunctionInputDef, { type: 'choice-group' }>,
  pageIndex: number
): FunctionInputDef {
  if (input.shape.kind === 'question' || input.shape.pageCounts.length <= 1) return input
  return {
    ...input,
    shape: {
      kind: input.shape.kind,
      pageCounts: input.shape.pageCounts.filter((_count, index) => index !== pageIndex)
    }
  }
}
