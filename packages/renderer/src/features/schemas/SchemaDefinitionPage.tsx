import { useEffect, useState, type JSX } from 'react'
import { validateSchemaData, type SchemaData, type SchemaDefinition } from '@ls101/schema-editor'
import { AlertCircle, ArrowLeft, LockKeyhole, Save, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { toast } from '../../components/ui/toast'
import { useSchemaRepository } from './SchemaApplicationContext'
import { SchemaDataFields } from './SchemaDataFields'
import {
  answerTypeLabels,
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
  const [definition, setDefinition] = useState<SchemaDefinition | null>(null)
  const [data, setData] = useState<SchemaData | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty = data !== null && JSON.stringify(data) !== savedSnapshot

  useEffect(() => {
    let active = true
    void repository
      .getSchema(schemaId)
      .then((item) => {
        if (!active) return
        setDefinition(item)
        setData(item?.data ?? null)
        setSavedSnapshot(item ? JSON.stringify(item.data) : '')
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
  }, [repository, schemaId])

  const save = async (): Promise<void> => {
    if (!definition || !data) return
    const validation = validateSchemaData(data, definition.structure)
    if (!validation.valid) {
      setValidationErrors(validation.errors.map(schemaValidationMessage))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await repository.updateSchemaData(
        definition.schemaId,
        definition.revision,
        data
      )
      setDefinition(saved)
      setData(saved.data)
      setSavedSnapshot(JSON.stringify(saved.data))
      toast.success('正式 Schema 已保存')
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
      toast.success(`已删除正式 Schema“${definition.data.name}”`)
      navigate('/schemas')
    } catch (reason) {
      setError(schemaErrorMessage(reason))
      setConfirmDelete(false)
    } finally {
      setSaving(false)
    }
  }

  const leave = (): void => {
    if (dirty) setConfirmLeave(true)
    else navigate('/schemas')
  }

  if (loading) return <div className={shared.loading}>正在加载正式 Schema...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarIdentity}>
          <IconButton icon={ArrowLeft} label="返回 Schema 列表" variant="ghost" onClick={leave} />
          <div>
            <h1>{data?.name || '未命名 Schema'}</h1>
            <span>
              {dirty ? '有未保存修改' : definition ? `正式版 r${definition.revision}` : '正式版'}
            </span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <IconButton
            icon={Trash2}
            label="删除正式 Schema"
            variant="danger"
            disabled={!definition || saving}
            onClick={() => setConfirmDelete(true)}
          />
          <Button
            icon={Save}
            variant="primary"
            disabled={!definition || !dirty || saving}
            onClick={() => void save()}
          >
            {saving ? '正在保存' : '保存'}
          </Button>
        </div>
      </header>

      {!definition || !data ? (
        <main className={styles.missing}>正式 Schema 不存在</main>
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
              <h2>可编辑数据</h2>
            </div>
            <SchemaDataFields
              structure={definition.structure}
              data={data}
              onChange={(nextData) => {
                setData(nextData)
                setValidationErrors([])
              }}
            />
          </section>

          <aside className={styles.summaryPane} aria-label="冻结结构">
            <div className={styles.sectionTitle}>
              <LockKeyhole aria-hidden="true" />
              <h2>冻结结构</h2>
            </div>
            <dl>
              <div>
                <dt>评分管道</dt>
                <dd>{questionTypeLabels[definition.structure.questionType]}</dd>
              </div>
              <div>
                <dt>Schema ID</dt>
                <dd>{definition.schemaId}</dd>
              </div>
              <div>
                <dt>结构哈希</dt>
                <dd>{definition.structureHash.slice(0, 18)}...</dd>
              </div>
            </dl>
            <div className={styles.formSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <h2>答案槽位</h2>
                </div>
              </div>
              <ul className={styles.frozenList}>
                {definition.structure.answerFormat.map((answer) => (
                  <li key={answer.answerId}>
                    <code>{answer.answerId}</code>
                    <span>{answerTypeLabels[answer.type]}</span>
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
                {definition.structure.templateInputs.map((input) => (
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
        title={`删除正式 Schema“${definition?.data.name ?? ''}”？`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteSchema()}
      />
    </div>
  )
}
