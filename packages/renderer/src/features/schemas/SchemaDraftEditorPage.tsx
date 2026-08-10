import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  createSchemaStructure,
  replaceSchemaDraft,
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID,
  updateSchemaDraft,
  validateSchemaData,
  validateSchemaDraft,
  type SchemaAnswerDefinition,
  type SchemaData,
  type SchemaDraft,
  type SchemaDraftLibraryDocument,
  type SchemaQuestionType,
  type SchemaTemplateInputDefinition
} from '@ls101/schema-editor'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileText,
  Plus,
  Save,
  Send,
  Trash2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { toast } from '../../components/ui/toast'
import { useSchemaRepository } from './SchemaApplicationContext'
import { SchemaDataFields } from './SchemaDataFields'
import {
  answerTypeLabels,
  createEmptySchemaData,
  questionTypeLabels,
  schemaErrorMessage,
  schemaValidationMessage
} from './schemaUi'
import shared from './SchemaShared.module.css'
import styles from './SchemaEditor.module.css'

export function SchemaDraftEditorPage(): JSX.Element {
  const repository = useSchemaRepository()
  const navigate = useNavigate()
  const { libraryId = '', draftId = '' } = useParams()
  const [library, setLibrary] = useState<SchemaDraftLibraryDocument | null>(null)
  const [draft, setDraft] = useState<SchemaDraft | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [publishData, setPublishData] = useState<SchemaData | null>(null)

  const dirty = draft !== null && JSON.stringify(draft) !== savedSnapshot
  const additionalInputs = useMemo(
    () =>
      draft?.structure.templateInputs.filter(
        (item) => !isBuiltinInput(item.inputId, draft.structure.questionType)
      ) ?? [],
    [draft]
  )

  useEffect(() => {
    let active = true
    void repository
      .getDraftLibrary(libraryId)
      .then((item) => {
        if (!active) return
        const loadedDraft = item?.drafts.find((candidate) => candidate.draftId === draftId) ?? null
        setLibrary(item)
        setDraft(loadedDraft)
        setSavedSnapshot(loadedDraft ? JSON.stringify(loadedDraft) : '')
      })
      .catch((reason: unknown) => {
        if (active) setError(schemaErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [draftId, libraryId, repository])

  const updateDraft = (update: Partial<Pick<SchemaDraft, 'name' | 'structure'>>): void => {
    setDraft((current) => (current ? { ...current, ...update } : current))
    setValidationErrors([])
  }

  const save = async (): Promise<SchemaDraft | null> => {
    if (!library || !draft) return null
    const validation = validateSchemaDraft(draft)
    if (!validation.valid) {
      setValidationErrors(validation.errors.map(schemaValidationMessage))
      return null
    }
    const revisedDraft = updateSchemaDraft(draft, { name: draft.name, structure: draft.structure })
    const replaced = replaceSchemaDraft(library, revisedDraft)
    if (!replaced.success) return null
    setSaving(true)
    setError(null)
    try {
      const savedLibrary = await repository.saveDraftLibrary(replaced.library)
      const savedDraft = savedLibrary.drafts.find((item) => item.draftId === draft.draftId) ?? null
      setLibrary(savedLibrary)
      setDraft(savedDraft)
      setSavedSnapshot(savedDraft ? JSON.stringify(savedDraft) : '')
      toast.success('结构草稿已保存')
      return savedDraft
    } catch (reason) {
      setError(schemaErrorMessage(reason))
      return null
    } finally {
      setSaving(false)
    }
  }

  const openPublish = async (): Promise<void> => {
    let source = draft
    if (dirty) source = await save()
    if (!source) return
    setValidationErrors([])
    setPublishData(createEmptySchemaData(source.name, source.structure))
  }

  const publish = async (): Promise<void> => {
    if (!draft || !publishData) return
    const validation = validateSchemaData(publishData, draft.structure)
    if (!validation.valid) {
      setValidationErrors(validation.errors.map(schemaValidationMessage))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const definition = await repository.publishDraft(libraryId, draft.draftId, publishData)
      setPublishData(null)
      toast.success('正式 Schema 已发布')
      navigate(`/schemas/${definition.schemaId}`)
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const setQuestionType = (questionType: SchemaQuestionType): void => {
    if (!draft) return
    const targetType =
      questionType === 'objective'
        ? 'text'
        : questionType === 'fixed-reading'
          ? 'fixed-speech'
          : 'free-speech'
    const answers: SchemaAnswerDefinition[] =
      questionType === 'objective'
        ? [{ answerId: draft.structure.answerFormat[0]?.answerId || 'answer', type: 'text' }]
        : (draft.structure.answerFormat.length
            ? draft.structure.answerFormat
            : [{ answerId: 'answer', type: targetType }]
          ).map((answer) => ({ answerId: answer.answerId, type: targetType }))
    updateDraft({ structure: createSchemaStructure(questionType, answers, additionalInputs) })
  }

  const setAnswers = (answerFormat: SchemaAnswerDefinition[]): void => {
    if (!draft) return
    updateDraft({
      structure: createSchemaStructure(draft.structure.questionType, answerFormat, additionalInputs)
    })
  }

  const setAdditionalInputs = (inputs: SchemaTemplateInputDefinition[]): void => {
    if (!draft) return
    updateDraft({
      structure: createSchemaStructure(
        draft.structure.questionType,
        draft.structure.answerFormat,
        inputs
      )
    })
  }

  const addAnswer = (): void => {
    if (!draft || draft.structure.questionType === 'objective') return
    const type = draft.structure.questionType === 'fixed-reading' ? 'fixed-speech' : 'free-speech'
    setAnswers([
      ...draft.structure.answerFormat,
      {
        answerId: uniqueId(
          draft.structure.answerFormat.map((item) => item.answerId),
          'answer'
        ),
        type
      }
    ])
  }

  const leave = (): void => {
    if (dirty) setConfirmLeave(true)
    else navigate(`/schemas/drafts/${libraryId}`)
  }

  if (loading) return <div className={shared.loading}>正在加载结构草稿...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarIdentity}>
          <IconButton icon={ArrowLeft} label="返回草稿库" variant="ghost" onClick={leave} />
          <div>
            <h1>{draft?.name || '未命名结构'}</h1>
            <span>{dirty ? '有未保存修改' : '结构草稿'}</span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <Button icon={Save} disabled={!draft || saving || !dirty} onClick={() => void save()}>
            保存
          </Button>
          <Button
            icon={Send}
            variant="primary"
            disabled={!draft || saving}
            onClick={() => void openPublish()}
          >
            发布正式版
          </Button>
        </div>
      </header>

      {!draft ? (
        <main className={styles.missing}>结构草稿不存在</main>
      ) : (
        <main className={styles.workspace}>
          <section className={styles.mainPane} aria-label="Schema 结构">
            {error ? (
              <div className={shared.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            {validationErrors.length && publishData === null ? (
              <ValidationNotice messages={validationErrors} />
            ) : null}

            <div className={styles.formSection}>
              <div className={styles.sectionTitle}>
                <FileText aria-hidden="true" />
                <h2>草稿信息</h2>
              </div>
              <label>
                <span>名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                />
              </label>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>评分管道</h2>
                  <p>正式发布后不可修改</p>
                </div>
              </div>
              <div className={styles.segmented} aria-label="评分管道">
                {(Object.keys(questionTypeLabels) as SchemaQuestionType[]).map((type) => (
                  <button
                    type="button"
                    data-active={draft.structure.questionType === type || undefined}
                    key={type}
                    onClick={() => setQuestionType(type)}
                  >
                    {questionTypeLabels[type]}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>答案槽位</h2>
                  <p>ID、类型和顺序在正式发布后冻结</p>
                </div>
                {draft.structure.questionType !== 'objective' ? (
                  <Button icon={Plus} size="small" onClick={addAnswer}>
                    添加槽位
                  </Button>
                ) : null}
              </div>
              <div className={styles.itemList}>
                {draft.structure.answerFormat.map((answer, index) => (
                  <div className={styles.itemRow} key={`${index}:${answer.answerId}`}>
                    <span className={styles.order}>{index + 1}</span>
                    <label>
                      <span>稳定 ID</span>
                      <input
                        aria-label={`答案槽位 ${index + 1} ID`}
                        value={answer.answerId}
                        onChange={(event) =>
                          setAnswers(
                            draft.structure.answerFormat.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, answerId: event.target.value } : item
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      <span>类型</span>
                      <input readOnly value={answerTypeLabels[answer.type]} />
                    </label>
                    <div className={styles.itemActions}>
                      <IconButton
                        icon={ArrowUp}
                        label="上移答案槽位"
                        size="small"
                        disabled={index === 0}
                        onClick={() =>
                          setAnswers(move(draft.structure.answerFormat, index, index - 1))
                        }
                      />
                      <IconButton
                        icon={ArrowDown}
                        label="下移答案槽位"
                        size="small"
                        disabled={index === draft.structure.answerFormat.length - 1}
                        onClick={() =>
                          setAnswers(move(draft.structure.answerFormat, index, index + 1))
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        label="删除答案槽位"
                        size="small"
                        variant="danger"
                        disabled={
                          draft.structure.questionType === 'objective' ||
                          draft.structure.answerFormat.length === 1
                        }
                        onClick={() =>
                          setAnswers(
                            draft.structure.answerFormat.filter(
                              (_, itemIndex) => itemIndex !== index
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>Template 输入</h2>
                  <p>内置输入只读；其他输入可按需增加</p>
                </div>
                <Button
                  icon={Plus}
                  size="small"
                  onClick={() =>
                    setAdditionalInputs([
                      ...additionalInputs,
                      {
                        inputId: uniqueId(
                          draft.structure.templateInputs.map((item) => item.inputId),
                          'input'
                        ),
                        type: 'text',
                        required: true
                      }
                    ])
                  }
                >
                  添加输入
                </Button>
              </div>
              <div className={styles.itemList}>
                {draft.structure.templateInputs.map((input) => {
                  const builtin = isBuiltinInput(input.inputId, draft.structure.questionType)
                  const additionalIndex = additionalInputs.findIndex(
                    (item) => item.inputId === input.inputId
                  )
                  return (
                    <div className={styles.inputRow} key={input.inputId}>
                      <label>
                        <span>{builtin ? '内置 ID' : '稳定 ID'}</span>
                        <input
                          readOnly={builtin}
                          aria-label={`输入 ${input.inputId} ID`}
                          value={input.inputId}
                          onChange={(event) =>
                            setAdditionalInputs(
                              additionalInputs.map((item, index) =>
                                index === additionalIndex
                                  ? { ...item, inputId: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      </label>
                      <label>
                        <span>类型</span>
                        <input readOnly value="文本" />
                      </label>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={input.required}
                          disabled={builtin}
                          onChange={(event) =>
                            setAdditionalInputs(
                              additionalInputs.map((item, index) =>
                                index === additionalIndex
                                  ? { ...item, required: event.target.checked }
                                  : item
                              )
                            )
                          }
                        />
                        <span>必填</span>
                      </label>
                      <IconButton
                        icon={Trash2}
                        label="删除输入项"
                        size="small"
                        variant="danger"
                        disabled={builtin}
                        onClick={() =>
                          setAdditionalInputs(
                            additionalInputs.filter((_, index) => index !== additionalIndex)
                          )
                        }
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className={styles.summaryPane} aria-label="结构摘要">
            <h2>结构摘要</h2>
            <dl>
              <div>
                <dt>评分管道</dt>
                <dd>{questionTypeLabels[draft.structure.questionType]}</dd>
              </div>
              <div>
                <dt>答案槽位</dt>
                <dd>{draft.structure.answerFormat.length}</dd>
              </div>
              <div>
                <dt>Template 输入</dt>
                <dd>{draft.structure.templateInputs.length}</dd>
              </div>
              <div>
                <dt>草稿修订</dt>
                <dd>r{draft.revision}</dd>
              </div>
            </dl>
          </aside>
        </main>
      )}

      <Modal
        open={publishData !== null}
        onOpenChange={(open) => {
          if (!open) setPublishData(null)
        }}
        overlayClassName={styles.modalBackdrop}
      >
        <section className={styles.publishDialog}>
          <header>
            <div>
              <ModalTitle asChild>
                <h2>发布正式 Schema</h2>
              </ModalTitle>
              <ModalDescription asChild>
                <p>当前结构将被冻结，并创建一个新的稳定 Schema ID。</p>
              </ModalDescription>
            </div>
          </header>
          <div className={styles.publishBody}>
            {validationErrors.length ? <ValidationNotice messages={validationErrors} /> : null}
            {draft && publishData ? (
              <SchemaDataFields
                structure={draft.structure}
                data={publishData}
                onChange={(data) => {
                  setPublishData(data)
                  setValidationErrors([])
                }}
              />
            ) : null}
          </div>
          <footer>
            <Button variant="ghost" onClick={() => setPublishData(null)}>
              取消
            </Button>
            <Button icon={Send} variant="primary" disabled={saving} onClick={() => void publish()}>
              {saving ? '正在发布' : '发布'}
            </Button>
          </footer>
        </section>
      </Modal>

      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的结构修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate(`/schemas/drafts/${libraryId}`)}
      />
    </div>
  )
}

function ValidationNotice({ messages }: { messages: string[] }): JSX.Element {
  return (
    <div className={styles.validation} role="alert">
      <strong>请修正以下内容</strong>
      {messages.map((message) => (
        <span key={message}>{message}</span>
      ))}
    </div>
  )
}

function uniqueId(existing: readonly string[], base: string): string {
  let suffix = 1
  while (existing.includes(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

function isBuiltinInput(inputId: string, questionType: SchemaQuestionType): boolean {
  return (
    inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID ||
    (questionType === 'objective' && inputId === SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID)
  )
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  if (item !== undefined) result.splice(to, 0, item)
  return result
}
