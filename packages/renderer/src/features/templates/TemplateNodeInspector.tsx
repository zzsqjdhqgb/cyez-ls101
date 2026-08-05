import type { JSX } from 'react'
import { ArrowDown, ArrowUp, Copy, Mic, Plus, Timer, Trash2, Variable, Volume2 } from 'lucide-react'
import type {
  ChoiceOptionDef,
  ChoiceQuestionNode,
  FrameNode,
  FunctionDef,
  PageNode,
  TemplateDocumentOperation,
  TemplateNode,
  TextExpression,
  TextExpressionPart,
  TimelineStep,
  ValueExpression,
  VariableRef
} from '@ls101/template-editor'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import styles from './TemplateNodeInspector.module.css'

interface TemplateNodeInspectorProps {
  node: TemplateNode
  functions: readonly FunctionDef[]
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateNodeInspector({
  node,
  functions,
  apply
}: TemplateNodeInspectorProps): JSX.Element | null {
  if (node.type === 'frame') {
    return <FrameInspector node={node} functions={functions} apply={apply} />
  }
  if (node.type === 'page') return <PageInspector node={node} apply={apply} />
  if (node.type === 'choice-question') return <ChoiceQuestionInspector node={node} apply={apply} />
  return null
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

function ChoiceQuestionInspector({
  node,
  apply
}: {
  node: ChoiceQuestionNode
  apply: TemplateNodeInspectorProps['apply']
}): JSX.Element {
  const updateOption = (optionId: string, option: ChoiceOptionDef): void => {
    apply({ type: 'update-choice-option', nodeId: node.id, optionId, option })
  }

  return (
    <div className={styles.nodeEditor}>
      <label>
        输出名称
        <input
          value={node.outputName}
          onChange={(event) =>
            apply({ type: 'set-choice-question', nodeId: node.id, outputName: event.target.value })
          }
        />
      </label>

      <TextExpressionEditor
        label="题干"
        value={node.stem}
        onChange={(stem) => apply({ type: 'set-choice-question', nodeId: node.id, stem })}
      />

      <div className={styles.fieldGroup}>
        <div className={styles.groupHeading}>
          <span>选项</span>
          <span>{node.options.length} / 26</span>
        </div>
        <div className={styles.itemList}>
          {node.options.map((option, index) => (
            <div className={styles.editorItem} key={option.id}>
              <div className={styles.itemToolbar}>
                <strong>{optionLabel(index)}</strong>
                <ListActions
                  copyDisabled={node.options.length >= 26}
                  index={index}
                  length={node.options.length}
                  removeDisabled={node.options.length <= 2}
                  subject={`选项 ${optionLabel(index)}`}
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
                compact
                label={`选项 ${optionLabel(index)} 内容`}
                value={option.content}
                onChange={(content) => updateOption(option.id, { ...option, content })}
              />
            </div>
          ))}
        </div>
        <Button
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
  apply
}: {
  node: PageNode
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
                  onChange={(text) => updateStep(index, { ...step, text })}
                />
              ) : (
                <ValueExpressionEditor
                  label={step.type === 'record' ? '录音时长（秒）' : '倒计时（秒）'}
                  value={step.type === 'record' ? step.duration : step.seconds}
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
  value: TextExpression
  compact?: boolean
  onChange(value: TextExpression): void
}

function TextExpressionEditor({
  label,
  value,
  compact = false,
  onChange
}: TextExpressionEditorProps): JSX.Element {
  const parts = value.parts.length > 0 ? value.parts : [{ type: 'literal', value: '' } as const]
  const updatePart = (index: number, part: TextExpressionPart): void => {
    onChange({ ...value, parts: replaceAt(parts, index, part) })
  }
  const appendVariable = (): void => {
    onChange({
      ...value,
      parts: [...parts, { type: 'variable', ref: { scope: 'local', name: '' } }]
    })
  }

  if (compact && parts.length === 1 && parts[0].type === 'literal') {
    return (
      <div className={styles.compactExpression}>
        <span className={styles.fieldLabel}>{label}</span>
        <div className={styles.compactLiteral}>
          <input
            aria-label={`${label}文本 1`}
            value={parts[0].value}
            onChange={(event) => updatePart(0, { ...parts[0], value: event.target.value })}
          />
          <IconButton
            icon={Variable}
            label={`${label}添加变量`}
            size="small"
            onClick={appendVariable}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={compact ? styles.compactExpression : styles.expression}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.partList}>
        {parts.map((part, index) => (
          <div className={styles.partRow} key={`${part.type}-${index}`}>
            <span className={styles.partType}>{part.type === 'literal' ? '文本' : '变量'}</span>
            <div className={styles.partValue}>
              {part.type === 'literal' ? (
                <textarea
                  aria-label={`${label}文本 ${index + 1}`}
                  rows={compact ? 2 : 3}
                  value={part.value}
                  onChange={(event) => updatePart(index, { ...part, value: event.target.value })}
                />
              ) : (
                <VariableRefEditor
                  label={`${label}变量 ${index + 1}`}
                  value={part.ref}
                  onChange={(ref) => updatePart(index, { ...part, ref })}
                />
              )}
            </div>
            <div className={styles.verticalActions}>
              <IconButton
                icon={ArrowUp}
                label={`上移${label}片段 ${index + 1}`}
                size="small"
                disabled={index === 0}
                onClick={() => onChange({ ...value, parts: moveAt(parts, index, index - 1) })}
              />
              <IconButton
                icon={ArrowDown}
                label={`下移${label}片段 ${index + 1}`}
                size="small"
                disabled={index === parts.length - 1}
                onClick={() => onChange({ ...value, parts: moveAt(parts, index, index + 1) })}
              />
              <IconButton
                icon={Trash2}
                label={`删除${label}片段 ${index + 1}`}
                size="small"
                variant="danger"
                disabled={parts.length === 1}
                onClick={() => onChange({ ...value, parts: removeAt(parts, index) })}
              />
            </div>
          </div>
        ))}
      </div>
      <div className={styles.commandRow}>
        <Button
          aria-label={`${label}添加文本`}
          icon={Plus}
          size="small"
          onClick={() => onChange({ ...value, parts: [...parts, { type: 'literal', value: '' }] })}
        >
          文本
        </Button>
        <Button
          aria-label={`${label}添加变量`}
          icon={Variable}
          size="small"
          onClick={appendVariable}
        >
          变量
        </Button>
      </div>
    </div>
  )
}

type EditableValueExpression = ValueExpression<'number'> | ValueExpression<'file'>

function ValueExpressionEditor({
  label,
  value,
  onChange
}: {
  label: string
  value: EditableValueExpression
  onChange(value: EditableValueExpression): void
}): JSX.Element {
  return (
    <div className={styles.expression}>
      <span className={styles.fieldLabel}>{label}</span>
      <select
        aria-label={`${label}来源`}
        value={value.source}
        onChange={(event) =>
          onChange(
            event.target.value === 'literal'
              ? value.type === 'number'
                ? literalNumber(0)
                : literalFile('')
              : variableValue(value.type, { scope: 'local', name: '' })
          )
        }
      >
        <option value="literal">固定值</option>
        <option value="variable">变量</option>
      </select>
      {value.source === 'literal' ? (
        <input
          aria-label={label}
          min={value.type === 'number' ? 0 : undefined}
          step={value.type === 'number' ? 1 : undefined}
          type={value.type === 'number' ? 'number' : 'text'}
          value={value.value}
          onChange={(event) =>
            onChange(
              value.type === 'number'
                ? literalNumber(Number(event.target.value))
                : literalFile(event.target.value)
            )
          }
        />
      ) : (
        <VariableRefEditor
          label={label}
          value={value.ref}
          onChange={(ref) => onChange(variableValue(value.type, ref))}
        />
      )}
    </div>
  )
}

function VariableRefEditor({
  label,
  value,
  onChange
}: {
  label: string
  value: VariableRef
  onChange(value: VariableRef): void
}): JSX.Element {
  return (
    <div className={styles.variableFields}>
      <select
        aria-label={`${label}作用域`}
        value={value.scope}
        onChange={(event) =>
          onChange(
            event.target.value === 'interface'
              ? { scope: 'interface', alias: '', varName: '' }
              : { scope: 'local', name: '' }
          )
        }
      >
        <option value="local">局部</option>
        <option value="interface">Interface</option>
      </select>
      {value.scope === 'local' ? (
        <input
          aria-label={`${label}名称`}
          placeholder="变量名称"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      ) : (
        <>
          <input
            aria-label={`${label} Interface 别名`}
            placeholder="Interface 别名"
            value={value.alias}
            onChange={(event) => onChange({ ...value, alias: event.target.value })}
          />
          <input
            aria-label={`${label}变量名称`}
            placeholder="变量名称"
            value={value.varName}
            onChange={(event) => onChange({ ...value, varName: event.target.value })}
          />
        </>
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

function literalFile(value: string): ValueExpression<'file'> {
  return { type: 'file', source: 'literal', value }
}

function variableValue(type: 'number' | 'file', ref: VariableRef): EditableValueExpression {
  return type === 'number'
    ? { type: 'number', source: 'variable', ref }
    : { type: 'file', source: 'variable', ref }
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
