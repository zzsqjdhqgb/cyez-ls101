import type { JSX } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  ListChecks,
  Type
} from 'lucide-react'
import type {
  ChoiceViewport,
  ContentBlock,
  TemplateDocumentOperation
} from '@ls101/template-editor'
import { IconButton } from '../../components/ui/IconButton'
import { TemplateVariableInput } from './TemplateVariableInput'
import type { TemplateVariableCandidate } from './TemplateVariableInputModel'
import styles from './TemplateContentBlockInspector.module.css'

interface TemplateContentBlockInspectorProps {
  pageId: string
  block: ContentBlock
  variableCandidates: readonly TemplateVariableCandidate[]
  apply(operation: TemplateDocumentOperation): boolean
  onBlockIdChange(blockId: string): void
}

export function TemplateContentBlockInspector({
  pageId,
  block,
  variableCandidates,
  apply,
  onBlockIdChange
}: TemplateContentBlockInspectorProps): JSX.Element {
  const update = (nextBlock: ContentBlock): void => {
    if (
      apply({
        type: 'update-content-block',
        pageId,
        blockId: block.id,
        block: nextBlock
      }) &&
      nextBlock.id !== block.id
    ) {
      onBlockIdChange(nextBlock.id)
    }
  }

  return (
    <div className={styles.inspector}>
      <div className={styles.identity}>
        <span className={styles.typeIcon}>{contentBlockIcon(block.type)}</span>
        <span>
          <strong>{contentBlockLabel(block.type)}</strong>
          <small>{block.id}</small>
        </span>
      </div>

      <label>
        ID
        <input
          value={block.id}
          onChange={(event) => update({ ...block, id: event.target.value })}
        />
      </label>

      <div className={styles.geometryGrid}>
        <NumberField
          label="X"
          max={Math.max(0, 100 - (block.width ?? 0))}
          min={0}
          value={block.x}
          onChange={(x) => {
            if (x !== undefined) update({ ...block, x })
          }}
        />
        <NumberField
          label="Y"
          max={block.type === 'choice-view' ? Math.max(0, 100 - block.height) : 100}
          min={0}
          value={block.y}
          onChange={(y) => {
            if (y !== undefined) update({ ...block, y })
          }}
        />
        <NumberField
          label="宽度"
          max={Math.max(1, 100 - block.x)}
          min={1}
          value={block.width}
          onChange={(width) => {
            if (width !== undefined) update({ ...block, width })
            else if (block.type === 'text') update({ ...block, width: undefined })
          }}
        />
        {block.type === 'choice-view' ? (
          <NumberField
            label="高度"
            max={Math.max(1, 100 - block.y)}
            min={1}
            value={block.height}
            onChange={(height) => update({ ...block, height: height ?? block.height })}
          />
        ) : null}
      </div>

      {block.type === 'text' ? (
        <>
          <label>
            文本
            <TemplateVariableInput
              mode="text"
              ariaLabel="内容块文本"
              candidates={variableCandidates}
              value={block.text}
              onChange={(text) => update({ ...block, text })}
            />
          </label>
          <NumberField
            label="字号"
            min={1}
            value={block.fontSize}
            onChange={(fontSize) => update({ ...block, fontSize })}
          />
          <div className={styles.formatRow} aria-label="文本格式">
            <IconButton
              aria-pressed={block.bold ?? false}
              className={styles.formatButton}
              data-active={block.bold || undefined}
              icon={Bold}
              label="粗体"
              size="small"
              onClick={() => update({ ...block, bold: !block.bold })}
            />
            <span className={styles.formatDivider} />
            {(['left', 'center', 'right'] as const).map((align) => (
              <IconButton
                aria-pressed={(block.align ?? 'left') === align}
                className={styles.formatButton}
                data-active={(block.align ?? 'left') === align || undefined}
                icon={alignIcon(align)}
                key={align}
                label={alignLabel(align)}
                size="small"
                onClick={() => update({ ...block, align })}
              />
            ))}
          </div>
        </>
      ) : null}

      {block.type === 'image' ? (
        <label>
          图片
          <TemplateVariableInput
            mode="value"
            ariaLabel="内容块图片"
            candidates={variableCandidates}
            placeholder="资源地址"
            value={block.src}
            valueType="file"
            onChange={(src) => update({ ...block, src })}
          />
        </label>
      ) : null}

      {block.type === 'choice-view' ? (
        <ChoiceViewportEditor
          value={block.defaultViewport}
          onChange={(defaultViewport) => update({ ...block, defaultViewport })}
        />
      ) : null}
    </div>
  )
}

function ChoiceViewportEditor({
  value,
  onChange
}: {
  value: ChoiceViewport
  onChange(value: ChoiceViewport): void
}): JSX.Element {
  const setMode = (mode: ChoiceViewport['mode']): void => {
    if (mode === 'free') onChange({ mode: 'free' })
    else if (mode === 'range') onChange({ mode: 'range', startPage: 0, endPage: 0 })
    else {
      onChange({
        mode: 'focus',
        questionRef: { scope: 'relative', callPath: [], questionId: '' }
      })
    }
  }
  return (
    <div className={styles.viewportFields}>
      <label>
        显示模式
        <select
          value={value.mode}
          onChange={(event) => setMode(event.target.value as ChoiceViewport['mode'])}
        >
          <option value="free">自由浏览</option>
          <option value="focus">聚焦题目</option>
          <option value="range">分页范围</option>
        </select>
      </label>
      {value.mode === 'free' ? (
        <NumberField
          label="初始页"
          min={0}
          value={value.initialPage}
          onChange={(initialPage) => onChange({ ...value, initialPage })}
        />
      ) : null}
      {value.mode === 'range' ? (
        <div className={styles.geometryGrid}>
          <NumberField
            label="起始页"
            min={0}
            value={value.startPage}
            onChange={(startPage) => onChange({ ...value, startPage: startPage ?? 0 })}
          />
          <NumberField
            label="结束页"
            min={0}
            value={value.endPage}
            onChange={(endPage) => onChange({ ...value, endPage: endPage ?? 0 })}
          />
          <NumberField
            label="初始页"
            min={0}
            value={value.initialPage}
            onChange={(initialPage) => onChange({ ...value, initialPage })}
          />
        </div>
      ) : null}
      {value.mode === 'focus' ? (
        <>
          <label>
            引用范围
            <select
              value={value.questionRef.scope}
              onChange={(event) =>
                onChange({
                  ...value,
                  questionRef: {
                    ...value.questionRef,
                    scope: event.target.value as 'relative' | 'absolute'
                  }
                })
              }
            >
              <option value="relative">相对</option>
              <option value="absolute">绝对</option>
            </select>
          </label>
          <label>
            调用路径
            <input
              placeholder="function-a / function-b"
              value={value.questionRef.callPath.join(' / ')}
              onChange={(event) =>
                onChange({
                  ...value,
                  questionRef: {
                    ...value.questionRef,
                    callPath: event.target.value
                      .split('/')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  }
                })
              }
            />
          </label>
          <label>
            题目 ID
            <input
              value={value.questionRef.questionId}
              onChange={(event) =>
                onChange({
                  ...value,
                  questionRef: { ...value.questionRef, questionId: event.target.value }
                })
              }
            />
          </label>
        </>
      ) : null}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number | undefined
  min?: number
  max?: number
  onChange(value: number | undefined): void
}): JSX.Element {
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        max={max}
        min={min}
        step="0.1"
        type="number"
        value={value ?? ''}
        onChange={(event) => {
          if (event.target.value === '') onChange(undefined)
          else {
            const number = Number(event.target.value)
            if (Number.isFinite(number)) {
              onChange(Math.min(max ?? number, Math.max(min ?? number, number)))
            }
          }
        }}
      />
    </label>
  )
}

function contentBlockLabel(type: ContentBlock['type']): string {
  if (type === 'text') return '文本'
  if (type === 'image') return '图片'
  return '选择题视图'
}

function contentBlockIcon(type: ContentBlock['type']): JSX.Element {
  if (type === 'text') return <Type aria-hidden="true" />
  if (type === 'image') return <ImageIcon aria-hidden="true" />
  return <ListChecks aria-hidden="true" />
}

function alignIcon(align: 'left' | 'center' | 'right'): typeof AlignLeft {
  if (align === 'center') return AlignCenter
  if (align === 'right') return AlignRight
  return AlignLeft
}

function alignLabel(align: 'left' | 'center' | 'right'): string {
  if (align === 'center') return '居中对齐'
  if (align === 'right') return '右对齐'
  return '左对齐'
}
