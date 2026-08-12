import type { JSX } from 'react'
import {
  type FunctionDocumentOperation,
  type FunctionInputDef,
  type FunctionOutputDef,
  type TemplateValueType,
  type ValueType
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

const INPUT_TYPES: readonly ValueType[] = ['string', 'number', 'file']
const OUTPUT_TYPES: readonly TemplateValueType[] = ['string', 'number', 'file', 'audio', 'choice']

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
                      input: { ...input, type: event.target.value as ValueType }
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
                      output: defaultOutput(output.name, event.target.value as TemplateValueType)
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
          onChange={(event) =>
            onChange({ ...output, expression: { ...output.expression, name: event.target.value } })
          }
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
          value={output.expression}
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

function defaultOutput(name: string, type: TemplateValueType): FunctionOutputDef {
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
  return '选择题答案'
}
