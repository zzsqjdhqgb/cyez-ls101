import { useEffect, useState, type JSX } from 'react'
import {
  addSchemaDraft,
  createSchemaDraft,
  createSchemaStructure,
  removeSchemaDraft,
  type SchemaDraft,
  type SchemaDraftLibraryDocument
} from '@ls101/schema-editor'
import { AlertCircle, ArrowLeft, FilePenLine, Plus, Save, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useSchemaRepository } from './SchemaApplicationContext'
import { questionTypeLabels, schemaErrorMessage } from './schemaUi'
import shared from './SchemaShared.module.css'
import styles from './SchemaDraftLibraryPage.module.css'

export function SchemaDraftLibraryPage(): JSX.Element {
  const repository = useSchemaRepository()
  const navigate = useNavigate()
  const { libraryId = '' } = useParams()
  const [library, setLibrary] = useState<SchemaDraftLibraryDocument | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SchemaDraft | null>(null)

  useEffect(() => {
    let active = true
    void repository
      .getDraftLibrary(libraryId)
      .then((item) => {
        if (!active) return
        setLibrary(item)
        setName(item?.name ?? '')
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
  }, [libraryId, repository])

  const saveLibrary = async (
    nextLibrary: SchemaDraftLibraryDocument
  ): Promise<SchemaDraftLibraryDocument | null> => {
    setSaving(true)
    setError(null)
    try {
      const saved = await repository.saveDraftLibrary(nextLibrary)
      setLibrary(saved)
      setName(saved.name)
      return saved
    } catch (reason) {
      setError(schemaErrorMessage(reason))
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveName = async (): Promise<void> => {
    if (!library) return
    const saved = await saveLibrary({ ...library, name })
    if (saved) toast.success('草稿库已保存')
  }

  const createDraft = async (): Promise<void> => {
    if (!library) return
    const draft = createSchemaDraft(
      '未命名结构',
      createSchemaStructure('objective', [{ answerId: 'answer', type: 'text' }])
    )
    const result = addSchemaDraft(library, draft)
    if (!result.success) return
    const saved = await saveLibrary(result.library)
    if (saved) navigate(`/schemas/drafts/${saved.libraryId}/${draft.draftId}`)
  }

  const deleteDraft = async (): Promise<void> => {
    if (!library || !pendingDelete) return
    const result = removeSchemaDraft(library, pendingDelete.draftId)
    if (!result.success) return
    const deletedName = pendingDelete.name
    const saved = await saveLibrary(result.library)
    if (saved) {
      setPendingDelete(null)
      toast.success(`已删除结构草稿“${deletedName}”`)
    }
  }

  if (loading) return <div className={shared.loading}>正在加载草稿库...</div>

  if (!library) {
    return (
      <Page>
        <PageHeader
          title="草稿库不存在"
          actions={
            <Button icon={ArrowLeft} onClick={() => navigate('/schemas')}>
              返回
            </Button>
          }
        />
        {error ? (
          <div className={shared.notice} role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={library.name || '未命名草稿库'}
        actions={
          <>
            <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/schemas')}>
              返回 Schema
            </Button>
            <Button icon={Save} disabled={saving} onClick={() => void saveName()}>
              {saving ? '正在保存' : '保存名称'}
            </Button>
            <Button
              icon={Plus}
              variant="primary"
              disabled={saving}
              onClick={() => void createDraft()}
            >
              新建结构
            </Button>
          </>
        }
      />

      {error ? (
        <div className={shared.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <label className={styles.libraryName}>
        草稿库名称
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>

      <div className={shared.sectionHeader}>
        <h2>结构草稿</h2>
      </div>
      {library.drafts.length === 0 ? <EmptyState icon={FilePenLine} title="暂无结构草稿" /> : null}
      {library.drafts.length > 0 ? (
        <div className={shared.list}>
          {library.drafts.map((draft) => (
            <article className={shared.row} key={draft.draftId}>
              <div className={shared.rowMain}>
                <button
                  className={shared.rowTitle}
                  type="button"
                  onClick={() => navigate(`/schemas/drafts/${library.libraryId}/${draft.draftId}`)}
                >
                  {draft.name}
                </button>
                <p className={shared.rowDescription}>
                  {questionTypeLabels[draft.structure.questionType]} ·{' '}
                  {draft.structure.answerFormat.length} 个答案槽位 ·{' '}
                  {draft.structure.templateInputs.length} 个输入项
                </p>
              </div>
              <div className={shared.rowActions}>
                <span className={shared.badge}>草稿 r{draft.revision}</span>
                <Button
                  onClick={() => navigate(`/schemas/drafts/${library.libraryId}/${draft.draftId}`)}
                >
                  编辑
                </Button>
                <IconButton
                  icon={Trash2}
                  label="删除结构草稿"
                  variant="danger"
                  onClick={() => setPendingDelete(draft)}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除"
        message="删除后无法恢复，这不会影响已经发布的正式 Schema。"
        open={pendingDelete !== null}
        title={`删除结构草稿“${pendingDelete?.name ?? ''}”？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void deleteDraft()}
      />
    </Page>
  )
}
