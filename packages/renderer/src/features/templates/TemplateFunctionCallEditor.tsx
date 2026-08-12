import type {
  FunctionDef,
  FunctionInputDef,
  FunctionNode,
  StaticValueExpression,
  TemplateDocumentOperation,
  TextExpression,
  ValueExpression
} from '@ls101/template-editor'
import type { JSX } from 'react'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { TemplateFunctionSchemaSummary } from './TemplateFunctionSchemaSummary'
import { TemplateVariableInput } from './TemplateVariableInput'
import type { TemplateVariableCandidate } from './TemplateVariableInputModel'
import styles from './TemplateFunctionCallEditor.module.css'

interface TemplateFunctionCallEditorProps {
  node: FunctionNode
  definition: FunctionDef | undefined
  functions: readonly FunctionDef[]
  variableCandidates: readonly TemplateVariableCandidate[]
  compact?: boolean
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateFunctionCallEditor({
  node,
  definition,
  functions,
  variableCandidates,
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
  onChange
}: {
  input: FunctionInputDef
  value: StaticValueExpression | undefined
  label: string
  variableCandidates: readonly TemplateVariableCandidate[]
  onChange(expression: StaticValueExpression): void
}): JSX.Element {
  return (
    <label className={styles.row}>
      <span className={styles.identity} title={input.name}>
        <strong>{input.name}</strong>
        <small>{valueTypeLabel(input.type)}</small>
      </span>
      <span className={styles.control}>
        {input.type === 'string' ? (
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
    </label>
  )
}

function fallbackInputs(node: FunctionNode): FunctionInputDef[] {
  return Object.entries(node.inputs).map(([name, expression]) => ({
    name,
    type: expression.type
  }))
}

function asTextExpression(value: StaticValueExpression | undefined): TextExpression {
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

function asNumberExpression(value: StaticValueExpression | undefined): ValueExpression<'number'> {
  return value?.type === 'number' ? value : { type: 'number', source: 'literal', value: 0 }
}

function asFileExpression(value: StaticValueExpression | undefined): ValueExpression<'file'> {
  return value?.type === 'file' ? value : { type: 'file', source: 'literal', value: '' }
}

function valueTypeLabel(type: string): string {
  if (type === 'string') return '文本'
  if (type === 'number') return '数字'
  if (type === 'file') return '文件'
  if (type === 'audio') return '录音'
  if (type === 'choice') return '选择结果'
  return type
}
