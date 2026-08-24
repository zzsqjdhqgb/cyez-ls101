import { useEffect, useState, type JSX } from 'react'
import {
  createSchemaStructure,
  isSchemaBuiltinInput,
  validateSchemaData,
  validateSchemaStructure,
  type SchemaAnswerDefinition,
  type SchemaData,
  type SchemaDefinition,
  type SchemaQuestionType,
  type SchemaTemplateInputDefinition,
  type SchemaStructure
} from '@ls101/schema-editor'
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Download,
  LockKeyhole,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { toast } from '../../components/ui/toast'
import { useSchemaRepository } from './SchemaApplicationContext'
import { SchemaDataFields } from './SchemaDataFields'
import { exportSchemaDefinitionFile } from './SchemaDefinitionFiles'
import {
  answerComponentLabels,
  answerTypeLabels,
  createEmptySchemaData,
  questionTypeLabels,
  schemaErrorMessage,
  schemaValidationMessage
} from './schemaUi'
import shared from './SchemaShared.module.css'
import styles from './SchemaEditor.module.css'

export function SchemaDefinitionPage(): JSX.Element {
  const repository = useSchemaRepository()
  const navigate = useNavigate()
  const { schemaId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const copySourceId = searchParams.get('copy')
  const isCreating = schemaId === 'new'
  const [definition, setDefinition] = useState<SchemaDefinition | null>(null)
  const [builtin, setBuiltin] = useState(false)
  const [data, setData] = useState<SchemaData | null>(null)
  const [structure, setStructure] = useState<SchemaStructure | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty =
    data !== null && structure !== null && JSON.stringify({ data, structure }) !== savedSnapshot

  useEffect(() => {
    let active = true
    if (isCreating) {
      const loadSource = copySourceId ? repository.getSchema(copySourceId) : Promise.resolve(null)
      void loadSource
        .then((source) => {
          if (!active) return
          const nextStructure =
            source?.structure ??
            createSchemaStructure('objective', [{ answerId: 'answer', type: 'text' }])
          const nextData = source
            ? { ...source.data, name: `${source.data.name}（副本）` }
            : createEmptySchemaData('未命名评分单元', nextStructure)
          setDefinition(null)
          setBuiltin(false)
          setData(nextData)
          setStructure(nextStructure)
          setSavedSnapshot(JSON.stringify({ data: nextData, structure: nextStructure }))
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
    }
    void Promise.all([repository.getSchema(schemaId), repository.listBuiltinSchemaIds()])
      .then(([item, builtinIds]) => {
        if (!active) return
        setDefinition(item)
        setBuiltin(builtinIds.includes(schemaId))
        setData(item?.data ?? null)
        setStructure(item?.structure ?? null)
        setSavedSnapshot(item ? JSON.stringify({ data: item.data, structure: item.structure }) : '')
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
  }, [copySourceId, isCreating, repository, schemaId])

  const save = async (): Promise<void> => {
    if (!data || !structure || (!isCreating && !definition)) return
    const nextStructure = structure
    const structureValidation = validateSchemaStructure(nextStructure)
    if (!structureValidation.valid) {
      setValidationErrors(structureValidation.errors.map(schemaValidationMessage))
      return
    }
    const dataValidation = validateSchemaData(data, nextStructure)
    if (!dataValidation.valid) {
      setValidationErrors(dataValidation.errors.map(schemaValidationMessage))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isCreating) {
        if (!repository.createSchema) throw new Error('当前评分单元仓储不支持直接创建。')
        const created = await repository.createSchema(nextStructure, data)
        toast.success('已添加到我的评分单元')
        navigate(`/schemas/${created.schemaId}`, { replace: true })
        return
      }
      if (!definition) return
      const saved = builtin
        ? await repository.updateSchemaData(definition.schemaId, definition.revision, data)
        : repository.updateSchema
          ? await repository.updateSchema(
              definition.schemaId,
              definition.revision,
              nextStructure,
              data
            )
          : await repository.updateSchemaData(definition.schemaId, definition.revision, data)
      setDefinition(saved)
      setData(saved.data)
      setStructure(saved.structure)
      setSavedSnapshot(JSON.stringify({ data: saved.data, structure: saved.structure }))
      toast.success('评分单元已保存')
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const deleteSchema = async (): Promise<void> => {
    if (!definition) return
    setSaving(true)
    try {
      await repository.deleteSchema(definition.schemaId)
      toast.success(`已删除评分单元“${definition.data.name}”`)
      navigate('/schemas')
    } catch (reason) {
      setError(schemaErrorMessage(reason))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  const copySchema = (): void => {
    if (definition) navigate(`/schemas/new?copy=${encodeURIComponent(definition.schemaId)}`)
  }

  const exportSchema = async (): Promise<void> => {
    if (!definition || dirty) return
    setExporting(true)
    setError(null)
    try {
      if (await exportSchemaDefinitionFile(definition)) toast.success('Schema 已导出')
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setExporting(false)
    }
  }

  const leave = (): void => {
    if (dirty) setConfirmLeave(true)
    else navigate('/schemas')
  }

  const updateStructure = (next: SchemaStructure): void => {
    setStructure(next)
    setData((current) => {
      if (!current) return current
      const answerDescriptions = Object.fromEntries(
        next.answerFormat.map((answer) => [
          answer.answerId,
          current.answerDescriptions[answer.answerId] ?? ''
        ])
      )
      const inputDescriptions = Object.fromEntries(
        next.templateInputs
          .filter((input) => !isSchemaBuiltinInput(next.questionType, input.inputId))
          .map((input) => [input.inputId, current.inputDescriptions[input.inputId] ?? ''])
      )
      return { ...current, answerDescriptions, inputDescriptions }
    })
    setValidationErrors([])
  }

  const canEditStructure = isCreating

  const setQuestionType = (questionType: SchemaQuestionType): void => {
    if (!structure) return
    const targetType =
      questionType === 'objective'
        ? 'text'
        : questionType === 'fixed-reading'
          ? 'fixed-speech'
          : 'free-speech'
    const answers: SchemaAnswerDefinition[] =
      questionType === 'objective'
        ? [{ answerId: structure.answerFormat[0]?.answerId || 'answer', type: 'text' }]
        : (structure.answerFormat.length
            ? structure.answerFormat
            : [{ answerId: 'answer', type: targetType }]
          ).map((answer) => ({ answerId: answer.answerId, type: targetType }))
    updateStructure(
      createSchemaStructure(
        questionType,
        answers,
        structure.templateInputs.filter(
          (item) => !isSchemaBuiltinInput(structure.questionType, item.inputId)
        )
      )
    )
  }

  const setAnswers = (answerFormat: SchemaAnswerDefinition[]): void => {
    if (structure)
      updateStructure(
        createSchemaStructure(
          structure.questionType,
          answerFormat,
          structure.templateInputs.filter(
            (item) => !isSchemaBuiltinInput(structure.questionType, item.inputId)
          )
        )
      )
  }

  const setInputs = (inputs: SchemaTemplateInputDefinition[]): void => {
    if (structure)
      updateStructure(createSchemaStructure(structure.questionType, structure.answerFormat, inputs))
  }

  const uniqueId = (existing: readonly string[], base: string): string => {
    let suffix = 1
    while (existing.includes(`${base}${suffix}`)) suffix += 1
    return `${base}${suffix}`
  }

  if (loading) return <div className={shared.loading}>正在加载正式 Schema...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarIdentity}>
          <IconButton icon={ArrowLeft} label="返回 Schema 列表" variant="ghost" onClick={leave} />
          <div>
            <h1>{data?.name || '未命名评分单元'}</h1>
            <span>
              {isCreating
                ? copySourceId
                  ? '复制并修改'
                  : '新建评分单元'
                : dirty
                  ? '有未保存修改'
                  : definition
                    ? `${builtin ? '内置' : '正式版'} · r${definition.revision}`
                    : '正式版'}
            </span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          {!builtin && definition ? (
            <IconButton
              icon={Trash2}
              label="删除评分单元"
              variant="danger"
              disabled={!definition || saving || exporting}
              onClick={() => setConfirmDelete(true)}
            />
          ) : null}
          <Button
            icon={Download}
            disabled={!definition || dirty || saving || exporting}
            onClick={() => void exportSchema()}
          >
            {exporting ? '正在导出' : '导出'}
          </Button>
          {builtin ? (
            <Button
              icon={Copy}
              variant="primary"
              disabled={!definition || saving || exporting}
              onClick={copySchema}
            >
              复制并修改
            </Button>
          ) : (
            <Button
              icon={Save}
              variant="primary"
              disabled={(!isCreating && (!definition || !dirty)) || saving || exporting}
              onClick={() => void save()}
            >
              {saving ? '正在保存' : isCreating ? '添加到我的评分单元' : '保存'}
            </Button>
          )}
        </div>
      </header>

      {!data || !structure || (!isCreating && !definition) ? (
        <main className={styles.missing}>评分单元不存在</main>
      ) : (
        <main className={styles.workspace}>
          <section className={styles.mainPane} aria-label="正式 Schema 数据">
            {error ? (
              <div className={shared.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            {validationErrors.length ? (
              <div className={styles.validation} role="alert">
                <strong>请修正以下内容</strong>
                {validationErrors.map((message) => (
                  <span key={message}>{message}</span>
                ))}
              </div>
            ) : null}
            <div className={styles.sectionTitle}>
              <Save aria-hidden="true" />
              <h2>评分单元内容</h2>
            </div>
            {canEditStructure && structure ? (
              <div className={styles.formSection}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>评分结构</h2>
                    <p>结构和评分说明一起保存，不需要单独维护草稿。</p>
                  </div>
                </div>
                <div className={styles.segmented} aria-label="评分管道">
                  {(Object.keys(questionTypeLabels) as SchemaQuestionType[]).map((type) => (
                    <button
                      type="button"
                      data-active={structure.questionType === type || undefined}
                      key={type}
                      onClick={() => setQuestionType(type)}
                    >
                      {questionTypeLabels[type]}
                    </button>
                  ))}
                </div>
                <div className={styles.sectionHeading}>
                  <div>
                    <h3>答案槽位</h3>
                  </div>
                  {structure.questionType !== 'objective' ? (
                    <Button
                      icon={Plus}
                      size="small"
                      onClick={() =>
                        setAnswers([
                          ...structure.answerFormat,
                          {
                            answerId: uniqueId(
                              structure.answerFormat.map((item) => item.answerId),
                              'answer'
                            ),
                            type:
                              structure.questionType === 'fixed-reading'
                                ? 'fixed-speech'
                                : 'free-speech'
                          }
                        ])
                      }
                    >
                      添加槽位
                    </Button>
                  ) : null}
                </div>
                <div className={styles.itemList}>
                  {structure.answerFormat.map((answer, index) => (
                    <div className={styles.itemRow} key={`${index}:${answer.answerId}`}>
                      <span className={styles.order}>{index + 1}</span>
                      <label>
                        <span>稳定 ID</span>
                        <input
                          aria-label={`答案槽位 ${index + 1} ID`}
                          value={answer.answerId}
                          onChange={(event) =>
                            setAnswers(
                              structure.answerFormat.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, answerId: event.target.value }
                                  : item
                              )
                            )
                          }
                        />
                      </label>
                      <div className={styles.itemActions}>
                        <IconButton
                          icon={ArrowUp}
                          label="上移答案槽位"
                          size="small"
                          disabled={index === 0}
                          onClick={() => setAnswers(move(structure.answerFormat, index, index - 1))}
                        />
                        <IconButton
                          icon={ArrowDown}
                          label="下移答案槽位"
                          size="small"
                          disabled={index === structure.answerFormat.length - 1}
                          onClick={() => setAnswers(move(structure.answerFormat, index, index + 1))}
                        />
                        <IconButton
                          icon={Trash2}
                          label="删除答案槽位"
                          size="small"
                          variant="danger"
                          disabled={
                            structure.questionType === 'objective' ||
                            structure.answerFormat.length === 1
                          }
                          onClick={() =>
                            setAnswers(
                              structure.answerFormat.filter((_, itemIndex) => itemIndex !== index)
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className={styles.sectionHeading}>
                  <div>
                    <h3>Template 输入</h3>
                  </div>
                  <Button
                    icon={Plus}
                    size="small"
                    onClick={() =>
                      setInputs([
                        ...structure.templateInputs,
                        {
                          inputId: uniqueId(
                            structure.templateInputs.map((item) => item.inputId),
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
                  {structure.templateInputs.map((input) => {
                    const builtinInput = isSchemaBuiltinInput(structure.questionType, input.inputId)
                    return (
                      <div className={styles.inputRow} key={input.inputId}>
                        <label>
                          <span>{builtinInput ? '内置 ID' : '稳定 ID'}</span>
                          <input
                            readOnly={builtinInput}
                            aria-label={`输入 ${input.inputId} ID`}
                            value={input.inputId}
                            onChange={(event) =>
                              setInputs(
                                structure.templateInputs.map((item) =>
                                  item.inputId === input.inputId
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
                            disabled={builtinInput}
                            onChange={(event) =>
                              setInputs(
                                structure.templateInputs.map((item) =>
                                  item.inputId === input.inputId
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
                          disabled={builtinInput}
                          onClick={() =>
                            setInputs(
                              structure.templateInputs.filter(
                                (item) => item.inputId !== input.inputId
                              )
                            )
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <SchemaDataFields
              structure={structure ?? definition.structure}
              data={data}
              readOnly={builtin}
              onChange={(nextData) => {
                setData(nextData)
                setValidationErrors([])
              }}
            />
          </section>

          <aside
            className={styles.summaryPane}
            aria-label={canEditStructure ? '评分结构摘要' : '冻结结构'}
          >
            <div className={styles.sectionTitle}>
              <LockKeyhole aria-hidden="true" />
              <h2>{canEditStructure ? '评分结构摘要' : '冻结结构'}</h2>
            </div>
            <dl>
              <div>
                <dt>评分管道</dt>
                <dd>{questionTypeLabels[(structure ?? definition.structure).questionType]}</dd>
              </div>
              {definition ? (
                <>
                  <div>
                    <dt>Schema ID</dt>
                    <dd>{definition.schemaId}</dd>
                  </div>
                  <div>
                    <dt>结构哈希</dt>
                    <dd>{definition.structureHash.slice(0, 18)}...</dd>
                  </div>
                </>
              ) : null}
            </dl>
            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>答案槽位</h2>
                </div>
              </div>
              <ul className={styles.frozenList}>
                {(structure ?? definition.structure).answerFormat.map((answer) => (
                  <li key={answer.answerId}>
                    <code>{answer.answerId}</code>
                    <span>
                      {answerTypeLabels[answer.type]} ·{' '}
                      {answerComponentLabels[answer.type].join(' + ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>Template 输入</h2>
                </div>
              </div>
              <ul className={styles.frozenList}>
                {(structure ?? definition.structure).templateInputs.map((input) => (
                  <li key={input.inputId}>
                    <code>{input.inputId}</code>
                    <span>{input.required ? '必填' : '可选'}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </main>
      )}

      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的数据修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate('/schemas')}
      />
      <ConfirmModal
        confirmLabel="删除"
        danger
        message="删除后引用这个 Schema 的模板将无法通过校验。"
        open={confirmDelete}
        title={`删除评分单元“${definition?.data.name ?? ''}”？`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteSchema()}
      />
    </div>
  )
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  if (item !== undefined) result.splice(to, 0, item)
  return result
}
