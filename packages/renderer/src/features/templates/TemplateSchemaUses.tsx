import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SchemaDefinition } from '@ls101/core-types'
import { isSchemaId, schemaBuiltinInputDescription } from '@ls101/schema-editor'
import type {
  SchemaAnswerBinding,
  SchemaTextExpression,
  SchemaUse,
  TemplateDocumentOperation
} from '@ls101/template-editor'
import { FilePlus2, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { useSchemaRepository } from '../schemas/SchemaApplicationContext'
import { questionTypeLabels } from '../schemas/schemaUi'
import { TemplateVariableInput } from './TemplateVariableInput'
import {
  parseSchemaTextExpression,
  schemaTextExpressionInputValue,
  type TemplateVariableCandidate
} from './TemplateVariableInputModel'
import { templateErrorMessage } from './templateUi'
import styles from './TemplateSchemaUses.module.css'

interface TemplateSchemaUsesProps {
  uses: readonly SchemaUse[]
  variableCandidates: readonly TemplateVariableCandidate[]
  disabled?: boolean
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateSchemaUses({
  uses,
  variableCandidates,
  disabled = false,
  apply
}: TemplateSchemaUsesProps): JSX.Element {
  const repository = useSchemaRepository()
  const [definitions, setDefinitions] = useState<ReadonlyMap<string, SchemaDefinition>>(
    () => new Map()
  )
  const [available, setAvailable] = useState<SchemaDefinition[]>([])
  const [selectedSchemaId, setSelectedSchemaId] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const schemaIdKey = uses
    .map((use) => use.schemaId)
    .sort()
    .join('|')

  useEffect(() => {
    let active = true
    const ids = schemaIdKey.split('|').filter(isSchemaId)
    void Promise.all(ids.map((id) => repository.getSchema(id)))
      .then((items) => {
        if (!active) return
        setDefinitions(
          new Map(
            items
              .filter((item): item is SchemaDefinition => item !== null)
              .map((item) => [item.schemaId, item])
          )
        )
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [repository, schemaIdKey])

  const openPicker = async (): Promise<void> => {
    setPickerOpen(true)
    setLoading(true)
    setError(null)
    try {
      const items = (
        await Promise.all((await repository.listSchemaIds()).map((id) => repository.getSchema(id)))
      ).filter((item): item is SchemaDefinition => item !== null)
      setAvailable(items)
      setSelectedSchemaId(items[0]?.schemaId ?? '')
      setDefinitions(
        (current) => new Map([...current, ...items.map((item) => [item.schemaId, item])])
      )
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }

  const addUse = (): void => {
    const definition = available.find((item) => item.schemaId === selectedSchemaId)
    if (!definition) return
    if (apply({ type: 'insert-schema-use', use: createSchemaUse(definition, uses) })) {
      setPickerOpen(false)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <span>{uses.length} 个评分单元</span>
        <Button
          icon={Plus}
          size="small"
          disabled={disabled || loading}
          onClick={() => void openPicker()}
        >
          添加
        </Button>
      </div>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {pickerOpen ? (
        <div className={styles.picker}>
          <label>
            正式 Schema
            <select
              disabled={loading || available.length === 0}
              value={selectedSchemaId}
              onChange={(event) => setSelectedSchemaId(event.target.value)}
            >
              {available.map((item) => (
                <option key={item.schemaId} value={item.schemaId}>
                  {item.data.name}
                </option>
              ))}
            </select>
          </label>
          {loading ? <span>正在加载...</span> : null}
          {!loading && available.length === 0 ? <span>暂无正式 Schema</span> : null}
          <div className={styles.pickerActions}>
            <Button size="small" variant="ghost" onClick={() => setPickerOpen(false)}>
              取消
            </Button>
            <Button size="small" variant="primary" disabled={!selectedSchemaId} onClick={addUse}>
              添加评分单元
            </Button>
          </div>
        </div>
      ) : null}

      {uses.length === 0 ? <p className={styles.empty}>当前模板没有评分单元</p> : null}
      <div className={styles.useList}>
        {uses.map((use) => (
          <SchemaUseEditor
            apply={apply}
            definition={definitions.get(use.schemaId) ?? null}
            disabled={disabled}
            key={use.useId}
            use={use}
            variableCandidates={variableCandidates}
          />
        ))}
      </div>
    </div>
  )
}

interface SchemaUseEditorProps {
  use: SchemaUse
  definition: SchemaDefinition | null
  variableCandidates: readonly TemplateVariableCandidate[]
  disabled: boolean
  apply(operation: TemplateDocumentOperation): boolean
}

function SchemaUseEditor({
  use,
  definition,
  variableCandidates,
  disabled,
  apply
}: SchemaUseEditorProps): JSX.Element {
  const audioOutputs = useMemo(
    () => variableCandidates.filter((item) => item.type === 'audio' && item.ref.scope === 'local'),
    [variableCandidates]
  )
  const choiceOutputs = useMemo(
    () => variableCandidates.filter((item) => item.type === 'choice' && item.ref.scope === 'local'),
    [variableCandidates]
  )

  const setAnswer = (answerId: string, binding: SchemaAnswerBinding): void => {
    apply({ type: 'set-schema-answer-binding', useId: use.useId, answerId, binding })
  }

  return (
    <section className={styles.use} aria-label={`评分单元 ${use.useId}`}>
      <header>
        <div>
          <strong>{definition?.data.name ?? '未知 Schema'}</strong>
          <span>
            {definition ? questionTypeLabels[definition.structure.questionType] : use.schemaId}
          </span>
        </div>
        <IconButton
          icon={Trash2}
          label="删除评分单元"
          size="small"
          variant="danger"
          disabled={disabled}
          onClick={() => apply({ type: 'remove-schema-use', useId: use.useId })}
        />
      </header>

      {!definition ? (
        <div className={styles.error}>Schema 不存在或 ID 无效</div>
      ) : (
        <>
          <div className={styles.bindingGroup}>
            <h3>题目输入</h3>
            {definition.structure.templateInputs.map((input) => (
              <label key={input.inputId}>
                {schemaInputLabel(definition, input.inputId)}
                <input
                  aria-label={`${use.useId} ${input.inputId}`}
                  disabled={disabled}
                  value={schemaTextExpressionInputValue(
                    use.inputBindings[input.inputId] ?? emptySchemaText()
                  )}
                  onChange={(event) =>
                    apply({
                      type: 'set-schema-input-binding',
                      useId: use.useId,
                      inputId: input.inputId,
                      expression: parseSchemaTextExpression(event.target.value)
                    })
                  }
                />
              </label>
            ))}
          </div>

          <div className={styles.bindingGroup}>
            <h3>答案绑定</h3>
            {definition.structure.answerFormat.map((answer) => {
              const storedBinding = use.answerBindings[answer.answerId]
              const binding =
                storedBinding?.type === answer.type
                  ? storedBinding
                  : defaultAnswerBinding(answer.type)
              const description =
                definition.data.answerDescriptions[answer.answerId] || answer.answerId
              if (binding.type === 'text') {
                return (
                  <div className={styles.answer} key={answer.answerId}>
                    <strong>{description}</strong>
                    <label>
                      选择题输出
                      <select
                        aria-label={`${use.useId} ${answer.answerId} 选择题输出`}
                        disabled={disabled}
                        value={binding.name}
                        onChange={(event) =>
                          setAnswer(answer.answerId, { ...binding, name: event.target.value })
                        }
                      >
                        <option value="">未选择</option>
                        {choiceOutputs.map((item) => (
                          <option key={item.key} value={localName(item)}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )
              }
              if (binding.type === 'fixed-speech') {
                return (
                  <div className={styles.answer} key={answer.answerId}>
                    <strong>{description}</strong>
                    <label>
                      文本
                      <input
                        aria-label={`${use.useId} ${answer.answerId} 文本`}
                        disabled={disabled}
                        value={schemaTextExpressionInputValue(binding.text)}
                        onChange={(event) =>
                          setAnswer(answer.answerId, {
                            ...binding,
                            text: parseSchemaTextExpression(event.target.value)
                          })
                        }
                      />
                    </label>
                    <label>
                      录音
                      <select
                        aria-label={`${use.useId} ${answer.answerId} 录音`}
                        disabled={disabled}
                        value={binding.audio.name}
                        onChange={(event) =>
                          setAnswer(answer.answerId, {
                            ...binding,
                            audio: { ...binding.audio, name: event.target.value }
                          })
                        }
                      >
                        <option value="">未选择</option>
                        {audioOutputs.map((item) => (
                          <option key={item.key} value={localName(item)}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )
              }
              return (
                <div className={styles.answer} key={answer.answerId}>
                  <strong>{description}</strong>
                  <label>
                    录音
                    <select
                      aria-label={`${use.useId} ${answer.answerId} 录音`}
                      disabled={disabled}
                      value={binding.audio.name}
                      onChange={(event) =>
                        setAnswer(answer.answerId, {
                          ...binding,
                          audio: { ...binding.audio, name: event.target.value }
                        })
                      }
                    >
                      <option value="">未选择</option>
                      {audioOutputs.map((item) => (
                        <option key={item.key} value={localName(item)}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )
            })}
          </div>

          <div className={styles.bindingGroup}>
            <div className={styles.groupHeading}>
              <h3>附件</h3>
              <IconButton
                icon={FilePlus2}
                label="添加评分附件"
                size="small"
                disabled={disabled}
                onClick={() =>
                  apply({
                    type: 'insert-schema-attachment',
                    useId: use.useId,
                    attachment: {
                      varName: uniqueAttachmentName(use),
                      description: '',
                      file: { type: 'file', source: 'literal', value: '' }
                    }
                  })
                }
              />
            </div>
            {use.attachments.map((attachment) => (
              <div className={styles.attachment} key={attachment.varName}>
                <div className={styles.attachmentFields}>
                  <label>
                    变量名
                    <input
                      aria-label={`${use.useId} 附件变量名`}
                      disabled={disabled}
                      value={attachment.varName}
                      onChange={(event) =>
                        apply({
                          type: 'update-schema-attachment',
                          useId: use.useId,
                          varName: attachment.varName,
                          attachment: { ...attachment, varName: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label>
                    说明
                    <input
                      aria-label={`${use.useId} ${attachment.varName} 附件说明`}
                      disabled={disabled}
                      value={attachment.description}
                      onChange={(event) =>
                        apply({
                          type: 'update-schema-attachment',
                          useId: use.useId,
                          varName: attachment.varName,
                          attachment: { ...attachment, description: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label>
                    文件
                    <TemplateVariableInput
                      mode="value"
                      valueType="file"
                      ariaLabel={`${use.useId} ${attachment.varName} 文件`}
                      disabled={disabled}
                      candidates={variableCandidates}
                      value={attachment.file}
                      onChange={(file) =>
                        apply({
                          type: 'update-schema-attachment',
                          useId: use.useId,
                          varName: attachment.varName,
                          attachment: { ...attachment, file }
                        })
                      }
                    />
                  </label>
                </div>
                <IconButton
                  icon={Trash2}
                  label="删除评分附件"
                  size="small"
                  variant="danger"
                  disabled={disabled}
                  onClick={() =>
                    apply({
                      type: 'remove-schema-attachment',
                      useId: use.useId,
                      varName: attachment.varName
                    })
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function createSchemaUse(definition: SchemaDefinition, existing: readonly SchemaUse[]): SchemaUse {
  return {
    useId: uniqueUseId(existing),
    schemaId: definition.schemaId,
    inputBindings: Object.fromEntries(
      definition.structure.templateInputs.map((input) => [input.inputId, emptySchemaText()])
    ),
    answerBindings: Object.fromEntries(
      definition.structure.answerFormat.map((answer) => [
        answer.answerId,
        defaultAnswerBinding(answer.type)
      ])
    ),
    attachments: []
  }
}

function defaultAnswerBinding(
  type: SchemaDefinition['structure']['answerFormat'][number]['type']
): SchemaAnswerBinding {
  if (type === 'text') return { type: 'text', source: 'choice-output', name: '' }
  if (type === 'fixed-speech')
    return {
      type: 'fixed-speech',
      text: emptySchemaText(),
      audio: { type: 'audio', source: 'record-output', name: '' }
    }
  return { type: 'free-speech', audio: { type: 'audio', source: 'record-output', name: '' } }
}

function emptySchemaText(): SchemaTextExpression {
  return { type: 'string' as const, parts: [{ type: 'literal' as const, value: '' }] }
}

function schemaInputLabel(definition: SchemaDefinition, inputId: string): string {
  return (
    schemaBuiltinInputDescription(definition.structure.questionType, inputId) ??
    definition.data.inputDescriptions[inputId] ??
    inputId
  )
}

function localName(candidate: TemplateVariableCandidate): string {
  return candidate.ref.scope === 'local' ? candidate.ref.name : ''
}

function uniqueUseId(uses: readonly SchemaUse[]): string {
  let suffix = 1
  while (uses.some((use) => use.useId === `schema-use-${suffix}`)) suffix += 1
  return `schema-use-${suffix}`
}

function uniqueAttachmentName(use: SchemaUse): string {
  let suffix = 1
  while (use.attachments.some((item) => item.varName === `attachment${suffix}`)) suffix += 1
  return `attachment${suffix}`
}
