import type {
  FunctionDocument,
  FunctionInputExpression,
  TemplateNode
} from '@ls101/template-editor'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '../../components/ui/Button'
import { TemplateInspectorSection } from './TemplateInspectorSection'
import type { TemplatePreviewSnapshot } from './TemplatePreview'
import type { FunctionPreviewSession } from './useFunctionPreview'
import styles from './TemplatePreview.module.css'
import { templateCompileErrorDetails, templateErrorNodeId } from './TemplateCompileErrors'

export function TemplateFunctionPreviewInspector({
  document,
  target,
  snapshot,
  snapshotCount,
  session,
  onLocateError
}: {
  document: FunctionDocument | null
  target: TemplateNode | null
  snapshot: TemplatePreviewSnapshot | null
  snapshotCount: number
  session: FunctionPreviewSession
  onLocateError?(nodeId: string): void
}): JSX.Element {
  return (
    <aside className={styles.inspector} aria-label="函数预览配置">
      <TemplateInspectorSection title="预览范围" headingId="function-preview-scope-heading">
        <dl className={styles.details}>
          <div>
            <dt>节点</dt>
            <dd>{target?.name?.trim() || (target ? nodeTypeLabel(target.type) : '不可用')}</dd>
          </div>
          <div>
            <dt>画面</dt>
            <dd>{snapshotCount}</dd>
          </div>
        </dl>
        <Button
          icon={RefreshCw}
          size="small"
          disabled={session.compiling}
          onClick={session.refresh}
        >
          刷新预览
        </Button>
      </TemplateInspectorSection>
      {(document?.content.inputs.length ?? 0) > 0 ? (
        <TemplateInspectorSection title="函数输入">
          <div className={styles.bindings}>
            {document?.content.inputs.map((input) => (
              <div className={styles.binding} key={input.name}>
                <span>{input.name}</span>
                <PreviewInput
                  input={session.inputs[input.name]}
                  label={`预览输入 ${input.name}`}
                  onChange={(value) => session.setInput(input.name, value)}
                />
              </div>
            ))}
          </div>
        </TemplateInspectorSection>
      ) : null}
      <TemplateInspectorSection title="当前 Timeline">
        {snapshot ? (
          <dl className={styles.details}>
            <div>
              <dt>类型</dt>
              <dd>{stepLabel(snapshot.step.type)}</dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>{snapshot.page.sourceNodeId}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.emptyValue}>暂无 Timeline 信息</p>
        )}
      </TemplateInspectorSection>
      {session.error ? (
        <TemplateInspectorSection title="预览错误">
          <div className={styles.error} role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{session.error}</span>
          </div>
        </TemplateInspectorSection>
      ) : null}
      {session.result && !session.result.success ? (
        <TemplateInspectorSection title="校验结果">
          <ol className={styles.errorList}>
            {session.result.errors.map((error, index) => {
              const details = templateCompileErrorDetails(error)
              const nodeId = document
                ? templateErrorNodeId(document.content.body, details.path)
                : null
              return (
                <li key={`${details.path}-${index}`}>
                  {nodeId && onLocateError ? (
                    <button type="button" onClick={() => onLocateError(nodeId)}>
                      <strong>{details.message}</strong>
                      <small>{details.path}</small>
                    </button>
                  ) : (
                    <span>
                      <strong>{details.message}</strong>
                      <small>{details.path}</small>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </TemplateInspectorSection>
      ) : null}
    </aside>
  )
}

function PreviewInput({
  input,
  label,
  onChange
}: {
  input: FunctionInputExpression | undefined
  label: string
  onChange(value: FunctionInputExpression): void
}): JSX.Element {
  if (input?.type === 'choice-group') {
    if (input.selection.kind === 'question') {
      const selection = input.selection
      return (
        <span className={styles.groupPreviewInput}>
          <input
            aria-label={`${label} 页面`}
            min={0}
            type="number"
            value={selection.pageIndex}
            onChange={(event) =>
              onChange({
                ...input,
                selection: {
                  ...selection,
                  pageIndex: Number(event.target.value)
                }
              })
            }
          />
          <input
            aria-label={`${label} 题目`}
            min={0}
            type="number"
            value={selection.questionIndex}
            onChange={(event) =>
              onChange({
                ...input,
                selection: {
                  ...selection,
                  questionIndex: Number(event.target.value)
                }
              })
            }
          />
        </span>
      )
    }
    if (input.selection.kind === 'range') {
      const selection = input.selection
      return (
        <input
          aria-label={`${label} 起始页`}
          min={0}
          type="number"
          value={selection.startPage}
          onChange={(event) =>
            onChange({
              ...input,
              selection: { ...selection, startPage: Number(event.target.value) }
            })
          }
        />
      )
    }
    return <span>完整题组</span>
  }
  if (input?.type === 'number') {
    return (
      <input
        aria-label={label}
        inputMode="decimal"
        type="number"
        value={input.source === 'literal' ? input.value : 0}
        onChange={(event) =>
          onChange({ type: 'number', source: 'literal', value: Number(event.target.value) })
        }
      />
    )
  }
  const type = input?.type === 'file' ? 'file' : 'string'
  return (
    <input
      aria-label={label}
      placeholder={type === 'file' ? '文件路径' : '预览文本'}
      value={input && 'source' in input && input.source === 'literal' ? input.value : ''}
      onChange={(event) => onChange({ type, source: 'literal', value: event.target.value })}
    />
  )
}

function stepLabel(type: TemplatePreviewSnapshot['step']['type']): string {
  if (type === 'play') return 'TTS 播放'
  if (type === 'countdown') return '倒计时'
  return '录音'
}

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'function') return '函数'
  return '选择题'
}
