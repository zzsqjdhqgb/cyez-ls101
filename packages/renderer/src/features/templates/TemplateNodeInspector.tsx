import type { JSX } from 'react'
import { ArrowDown, ArrowUp, Copy, Mic, Plus, Timer, Trash2, Volume2 } from 'lucide-react'
import type {
  ChoiceOptionDef,
  ChoiceQuestionNode,
  FrameNode,
  FunctionDef,
  PageNode,
  TemplateDocumentOperation,
  TemplateNode,
  TextExpression,
  TimelineStep,
  VariableNode,
  ValueExpression
} from '@ls101/template-editor'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { TemplateFunctionCallEditor } from './TemplateFunctionCallEditor'
import type { TemplateChoiceGroupCandidate } from './TemplateChoiceTargets'
import styles from './TemplateNodeInspector.module.css'
import { TemplateVariableInput } from './TemplateVariableInput'
import type { TemplateVariableCandidate } from './TemplateVariableInputModel'

interface TemplateNodeInspectorProps {
  node: TemplateNode
  functions: readonly FunctionDef[]
  variableCandidates: readonly TemplateVariableCandidate[]
  choiceGroupCandidates: readonly TemplateChoiceGroupCandidate[]
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateNodeInspector({
  node,
  functions,
  variableCandidates,
  choiceGroupCandidates,
  apply
}: TemplateNodeInspectorProps): JSX.Element {
  const details =
    node.type === 'frame' ? (
      <FrameInspector node={node} functions={functions} apply={apply} />
    ) : node.type === 'page' ? (
      <PageInspector node={node} variableCandidates={variableCandidates} apply={apply} />
    ) : node.type === 'choice-question' ? (
      <ChoiceQuestionEditor node={node} variableCandidates={variableCandidates} apply={apply} />
    ) : node.type === 'function' ? (
      <TemplateFunctionCallEditor
        node={node}
        definition={functions.find((definition) => definition.id === node.functionRef)}
        functions={functions}
        variableCandidates={variableCandidates}
        choiceGroupCandidates={choiceGroupCandidates}
        apply={apply}
      />
    ) : node.type === 'variable' ? (
      <VariableEditor node={node} variableCandidates={variableCandidates} apply={apply} />
    ) : null

  return (
    <div className={styles.nodeEditor}>
      <label>
        节点名称
        <input
          value={node.name ?? ''}
          onChange={(event) =>
            apply({ type: 'set-node-name', nodeId: node.id, value: event.target.value })
          }
        />
      </label>
      {details}
    </div>
  )
}

export function VariableEditor({
  node,
  variableCandidates,
  apply,
  compact = false,
  ariaLabelPrefix
}: {
  node: VariableNode
  variableCandidates: readonly TemplateVariableCandidate[]
  apply: TemplateNodeInspectorProps['apply']
  compact?: boolean
  ariaLabelPrefix?: string
}): JSX.Element {
  const label = (value: string): string => (ariaLabelPrefix ? `${ariaLabelPrefix} ${value}` : value)
  const valueCandidates = variableCandidates.filter(
    (candidate) => candidate.ref.scope !== 'local' || candidate.ref.name !== node.variableName
  )
  const updateType = (type: VariableNode['value']['type']): void => {
    if (type === node.value.type) return
    apply({ type: 'set-variable', nodeId: node.id, value: defaultVariableValue(type) })
  }

  return (
    <div className={`${styles.nodeEditor}${compact ? ` ${styles.compactVariableEditor}` : ''}`}>
      <label>
        变量名称
        <input
          aria-label={label('变量名称')}
          value={node.variableName}
          onChange={(event) =>
            apply({ type: 'set-variable', nodeId: node.id, variableName: event.target.value })
          }
        />
      </label>
      <label>
        类型
        <select
          aria-label={label('类型')}
          value={node.value.type}
          onChange={(event) => updateType(event.target.value as VariableNode['value']['type'])}
        >
          <option value="string">文本</option>
          <option value="number">数字</option>
          <option value="file">文件</option>
        </select>
      </label>
      <div className={styles.expression}>
        <span className={styles.fieldLabel}>值</span>
        {node.value.type === 'string' ? (
          <TemplateVariableInput
            mode="text"
            ariaLabel={label('值')}
            candidates={valueCandidates}
            multiline={!compact}
            value={'parts' in node.value ? node.value : stringValueAsText(node.value)}
            onChange={(value) => apply({ type: 'set-variable', nodeId: node.id, value })}
          />
        ) : (
          <TemplateVariableInput
            mode="value"
            ariaLabel={label('值')}
            candidates={valueCandidates}
            inputMode={node.value.type === 'number' ? 'decimal' : 'text'}
            value={node.value}
            valueType={node.value.type}
            onChange={(value) => apply({ type: 'set-variable', nodeId: node.id, value })}
          />
        )}
      </div>
    </div>
  )
}

function defaultVariableValue(type: VariableNode['value']['type']): VariableNode['value'] {
  if (type === 'number') return { type, source: 'literal', value: 0 }
  if (type === 'file') return { type, source: 'literal', value: '' }
  return { type, parts: [{ type: 'literal', value: '' }] }
}

function stringValueAsText(value: ValueExpression<'string'>): TextExpression {
  return value.source === 'literal'
    ? text(value.value)
    : { type: 'string', parts: [{ type: 'variable', ref: value.ref }] }
}

function FrameInspector({
  node,
  functions,
  apply
}: {
  node: FrameNode
  functions: readonly FunctionDef[]
  apply: TemplateNodeInspectorProps['apply']
}): JSX.Element {
  const pages = node.choiceCollector?.pages ?? null
  const questionCount = countChoiceQuestions(node, functions)
  const configuredCount = pages?.reduce((sum, page) => sum + page.questionCount, 0) ?? 0

  const setPages = (nextPages: readonly { questionCount: number }[] | null): void => {
    apply({ type: 'set-frame-choice-collector', frameId: node.id, pages: nextPages })
  }

  return (
    <div className={styles.nodeEditor}>
      <label className={styles.checkField}>
        <input
          checked={pages !== null}
          type="checkbox"
          onChange={(event) =>
            setPages(event.target.checked ? [{ questionCount: Math.max(1, questionCount) }] : null)
          }
        />
        <span>选择题 Collector</span>
      </label>

      {pages ? (
        <div className={styles.fieldGroup}>
          <div className={styles.groupHeading}>
            <span>分页</span>
            <span
              className={
                configuredCount === questionCount ? styles.validCount : styles.invalidCount
              }
            >
              {configuredCount} / {questionCount} 题
            </span>
          </div>
          <div className={styles.itemList}>
            {pages.map((page, index) => (
              <div className={styles.compactItem} key={index}>
                <span className={styles.itemIndex}>第 {index + 1} 页</span>
                <input
                  aria-label={`第 ${index + 1} 页题目数`}
                  className={styles.numberInput}
                  min={1}
                  step={1}
                  type="number"
                  value={page.questionCount}
                  onChange={(event) => {
                    const questionCount = Number(event.target.value)
                    if (!Number.isInteger(questionCount) || questionCount < 1) return
                    setPages(replaceAt(pages, index, { questionCount }))
                  }}
                />
                <ListActions
                  index={index}
                  length={pages.length}
                  removeDisabled={pages.length === 1}
                  subject={`第 ${index + 1} 页`}
                  onCopy={() => setPages(insertAt(pages, index + 1, { ...page }))}
                  onMove={(target) => setPages(moveAt(pages, index, target))}
                  onRemove={() => setPages(removeAt(pages, index))}
                />
              </div>
            ))}
          </div>
          <Button
            className={styles.addButton}
            icon={Plus}
            size="small"
            onClick={() => setPages([...pages, { questionCount: 1 }])}
          >
            添加分页
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function ChoiceQuestionEditor({
  node,
  variableCandidates,
  apply,
  compact = false,
  ariaLabelPrefix
}: {
  node: ChoiceQuestionNode
  variableCandidates: readonly TemplateVariableCandidate[]
  apply: TemplateNodeInspectorProps['apply']
  compact?: boolean
  ariaLabelPrefix?: string
}): JSX.Element {
  const controlLabel = (label: string): string =>
    ariaLabelPrefix ? `${ariaLabelPrefix} ${label}` : label
  const updateOption = (optionId: string, option: ChoiceOptionDef): void => {
    apply({ type: 'update-choice-option', nodeId: node.id, optionId, option })
  }

  return (
    <div
      className={[styles.nodeEditor, compact ? styles.compactChoiceEditor : '']
        .filter(Boolean)
        .join(' ')}
    >
      <label>
        输出名称
        <input
          aria-label={controlLabel('输出名称')}
          value={node.outputName}
          onChange={(event) =>
            apply({ type: 'set-choice-question', nodeId: node.id, outputName: event.target.value })
          }
        />
      </label>

      <TextExpressionEditor
        ariaLabel={controlLabel('题干')}
        compact={compact}
        label="题干"
        value={node.stem}
        candidates={variableCandidates}
        onChange={(stem) => apply({ type: 'set-choice-question', nodeId: node.id, stem })}
      />

      <div className={styles.fieldGroup}>
        <div className={styles.groupHeading}>
          <span>选项</span>
          <span>{node.options.length} / 26</span>
        </div>
        <div className={styles.itemList}>
          {node.options.map((option, index) => (
            <div
              className={[styles.editorItem, compact ? styles.compactChoiceOption : '']
                .filter(Boolean)
                .join(' ')}
              key={option.id}
            >
              <div className={styles.itemToolbar}>
                <strong>{optionLabel(index)}</strong>
                <ListActions
                  copyDisabled={node.options.length >= 26}
                  index={index}
                  length={node.options.length}
                  removeDisabled={node.options.length <= 2}
                  subject={controlLabel(`选项 ${optionLabel(index)}`)}
                  onCopy={() =>
                    apply({
                      type: 'copy-choice-option',
                      nodeId: node.id,
                      optionId: option.id,
                      index: index + 1
                    })
                  }
                  onMove={(target) =>
                    apply({
                      type: 'move-choice-option',
                      nodeId: node.id,
                      optionId: option.id,
                      index: target
                    })
                  }
                  onRemove={() =>
                    apply({ type: 'remove-choice-option', nodeId: node.id, optionId: option.id })
                  }
                />
              </div>
              <TextExpressionEditor
                ariaLabel={controlLabel(`选项 ${optionLabel(index)} 内容`)}
                compact
                label={`选项 ${optionLabel(index)} 内容`}
                value={option.content}
                candidates={variableCandidates}
                onChange={(content) => updateOption(option.id, { ...option, content })}
              />
            </div>
          ))}
        </div>
        <Button
          aria-label={controlLabel('添加选项')}
          className={styles.addButton}
          disabled={node.options.length >= 26}
          icon={Plus}
          size="small"
          onClick={() =>
            apply({
              type: 'insert-choice-option',
              nodeId: node.id,
              option: { id: 'option', content: text('') }
            })
          }
        >
          添加选项
        </Button>
      </div>
    </div>
  )
}

function PageInspector({
  node,
  variableCandidates,
  apply
}: {
  node: PageNode
  variableCandidates: readonly TemplateVariableCandidate[]
  apply: TemplateNodeInspectorProps['apply']
}): JSX.Element {
  const updateStep = (index: number, step: TimelineStep): void => {
    apply({ type: 'update-timeline-step', pageId: node.id, index, step })
  }

  const addStep = (step: TimelineStep): void => {
    apply({ type: 'insert-timeline-step', pageId: node.id, step })
  }

  return (
    <div className={styles.nodeEditor}>
      <div className={styles.fieldGroup}>
        <div className={styles.groupHeading}>
          <span>时间线</span>
          <span>{node.timeline.length} 项</span>
        </div>
        {node.timeline.length === 0 ? <p className={styles.emptyValue}>无时间线项目</p> : null}
        <div className={styles.itemList}>
          {node.timeline.map((step, index) => (
            <div className={styles.editorItem} key={index}>
              <div className={styles.itemToolbar}>
                <strong>{timelineLabel(step.type)}</strong>
                <ListActions
                  index={index}
                  length={node.timeline.length}
                  subject={`${timelineLabel(step.type)} ${index + 1}`}
                  onCopy={() => apply({ type: 'copy-timeline-step', pageId: node.id, index })}
                  onMove={(target) =>
                    apply({
                      type: 'move-timeline-step',
                      pageId: node.id,
                      index,
                      targetIndex: target
                    })
                  }
                  onRemove={() => apply({ type: 'remove-timeline-step', pageId: node.id, index })}
                />
              </div>
              {step.type === 'play' ? (
                <TextExpressionEditor
                  compact
                  label="TTS 文本"
                  value={step.text}
                  candidates={variableCandidates}
                  onChange={(text) => updateStep(index, { ...step, text })}
                />
              ) : (
                <ValueExpressionEditor
                  label={step.type === 'record' ? '录音时长（秒）' : '倒计时（秒）'}
                  value={step.type === 'record' ? step.duration : step.seconds}
                  candidates={variableCandidates}
                  onChange={(value) =>
                    updateStep(
                      index,
                      step.type === 'record'
                        ? { ...step, duration: value as ValueExpression<'number'> }
                        : { ...step, seconds: value as ValueExpression<'number'> }
                    )
                  }
                />
              )}
              {step.type === 'record' ? (
                <label>
                  输出名称
                  <input
                    value={step.outputName}
                    onChange={(event) =>
                      updateStep(index, { ...step, outputName: event.target.value })
                    }
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>
        <div className={styles.commandRow}>
          <Button
            icon={Volume2}
            size="small"
            onClick={() => addStep({ type: 'play', text: text('') })}
          >
            TTS 播放
          </Button>
          <Button
            icon={Timer}
            size="small"
            onClick={() => addStep({ type: 'countdown', seconds: literalNumber(1) })}
          >
            倒计时
          </Button>
          <Button
            icon={Mic}
            size="small"
            onClick={() =>
              addStep({ type: 'record', duration: literalNumber(1), outputName: 'recording' })
            }
          >
            录音
          </Button>
        </div>
      </div>
    </div>
  )
}

interface TextExpressionEditorProps {
  label: string
  ariaLabel?: string
  value: TextExpression
  candidates: readonly TemplateVariableCandidate[]
  compact?: boolean
  onChange(value: TextExpression): void
}

function TextExpressionEditor({
  label,
  ariaLabel = label,
  value,
  candidates,
  compact = false,
  onChange
}: TextExpressionEditorProps): JSX.Element {
  return (
    <div className={compact ? styles.compactExpression : styles.expression}>
      <span className={styles.fieldLabel}>{label}</span>
      <TemplateVariableInput
        mode="text"
        ariaLabel={ariaLabel}
        candidates={candidates}
        multiline={!compact}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

type EditableValueExpression = ValueExpression<'number'> | ValueExpression<'file'>

function ValueExpressionEditor({
  label,
  value,
  candidates,
  onChange
}: {
  label: string
  value: EditableValueExpression
  candidates: readonly TemplateVariableCandidate[]
  onChange(value: EditableValueExpression): void
}): JSX.Element {
  return (
    <div className={styles.expression}>
      <span className={styles.fieldLabel}>{label}</span>
      {value.type === 'number' ? (
        <TemplateVariableInput
          mode="value"
          ariaLabel={label}
          candidates={candidates}
          inputMode="decimal"
          min={0}
          value={value}
          valueType="number"
          onChange={onChange}
        />
      ) : (
        <TemplateVariableInput
          mode="value"
          ariaLabel={label}
          candidates={candidates}
          value={value}
          valueType="file"
          onChange={onChange}
        />
      )}
    </div>
  )
}

function ListActions({
  index,
  length,
  subject,
  removeDisabled = false,
  copyDisabled = false,
  onMove,
  onCopy,
  onRemove
}: {
  index: number
  length: number
  subject: string
  removeDisabled?: boolean
  copyDisabled?: boolean
  onMove(index: number): void
  onCopy(): void
  onRemove(): void
}): JSX.Element {
  return (
    <div className={styles.listActions}>
      <IconButton
        icon={ArrowUp}
        label={`上移${subject}`}
        size="small"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
      />
      <IconButton
        icon={ArrowDown}
        label={`下移${subject}`}
        size="small"
        disabled={index === length - 1}
        onClick={() => onMove(index + 1)}
      />
      <IconButton
        icon={Copy}
        label={`复制${subject}`}
        size="small"
        disabled={copyDisabled}
        onClick={onCopy}
      />
      <IconButton
        icon={Trash2}
        label={`删除${subject}`}
        size="small"
        variant="danger"
        disabled={removeDisabled}
        onClick={onRemove}
      />
    </div>
  )
}

function countChoiceQuestions(
  node: FrameNode,
  functions: readonly FunctionDef[],
  activeFunctions: ReadonlySet<string> = new Set()
): number {
  return node.children.reduce((count, child) => {
    if (child.type === 'choice-question') return count + 1
    if (child.type === 'frame') {
      return child.choiceCollector
        ? count
        : count + countChoiceQuestions(child, functions, activeFunctions)
    }
    if (child.type === 'function') {
      if (activeFunctions.has(child.functionRef)) return count
      const definition = functions.find((item) => item.id === child.functionRef)
      if (!definition || definition.body.choiceCollector) return count
      return (
        count +
        countChoiceQuestions(
          definition.body,
          functions,
          new Set(activeFunctions).add(child.functionRef)
        )
      )
    }
    return count
  }, 0)
}

function optionLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

function timelineLabel(type: TimelineStep['type']): string {
  if (type === 'play') return '播放音频'
  if (type === 'countdown') return '倒计时'
  return '录音'
}

function text(value: string): TextExpression {
  return { type: 'string', parts: [{ type: 'literal', value }] }
}

function literalNumber(value: number): ValueExpression<'number'> {
  return { type: 'number', source: 'literal', value }
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item))
}

function insertAt<T>(items: readonly T[], index: number, value: T): T[] {
  return [...items.slice(0, index), value, ...items.slice(index)]
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index)
}

function moveAt<T>(items: readonly T[], index: number, target: number): T[] {
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}
