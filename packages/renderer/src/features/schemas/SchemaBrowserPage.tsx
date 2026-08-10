import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  createSchemaDraftLibrary,
  type SchemaDefinition,
  type SchemaDraftLibraryDocument
} from '@ls101/schema-editor'
import { AlertCircle, ArrowRight, BookOpen, FilePenLine, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useSchemaRepository } from './SchemaApplicationContext'
import { questionTypeLabels, schemaErrorMessage } from './schemaUi'
import styles from './SchemaShared.module.css'

type PendingDelete =
  | { kind: 'schema'; item: SchemaDefinition }
  | { kind: 'library'; item: SchemaDraftLibraryDocument }

export function SchemaBrowserPage(): JSX.Element {
  const repository = useSchemaRepository()
  const navigate = useNavigate()
  const [schemas, setSchemas] = useState<SchemaDefinition[]>([])
  const [libraries, setLibraries] = useState<SchemaDraftLibraryDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [schemaIds, libraryIds] = await Promise.all([
        repository.listSchemaIds(),
        repository.listDraftLibraryIds()
      ])
      const [schemaItems, libraryItems] = await Promise.all([
        Promise.all(schemaIds.map((id) => repository.getSchema(id))),
        Promise.all(libraryIds.map((id) => repository.getDraftLibrary(id)))
      ])
      setSchemas(schemaItems.filter((item): item is SchemaDefinition => item !== null))
      setLibraries(libraryItems.filter((item): item is SchemaDraftLibraryDocument => item !== null))
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    let active = true
    void Promise.all([repository.listSchemaIds(), repository.listDraftLibraryIds()])
      .then(([schemaIds, libraryIds]) =>
        Promise.all([
          Promise.all(schemaIds.map((id) => repository.getSchema(id))),
          Promise.all(libraryIds.map((id) => repository.getDraftLibrary(id)))
        ])
      )
      .then(([schemaItems, libraryItems]) => {
        if (!active) return
        setSchemas(schemaItems.filter((item): item is SchemaDefinition => item !== null))
        setLibraries(
          libraryItems.filter((item): item is SchemaDraftLibraryDocument => item !== null)
        )
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
  }, [repository])

  const createLibrary = async (): Promise<void> => {
    setCreating(true)
    setError(null)
    try {
      const library = await repository.saveDraftLibrary(createSchemaDraftLibrary('未命名草稿库'))
      navigate(`/schemas/drafts/${library.libraryId}`)
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      if (pendingDelete.kind === 'schema') {
        await repository.deleteSchema(pendingDelete.item.schemaId)
        toast.success(`已删除正式 Schema“${pendingDelete.item.data.name}”`)
      } else {
        await repository.deleteDraftLibrary(pendingDelete.item.libraryId)
        toast.success(`已删除草稿库“${pendingDelete.item.name}”`)
      }
      setPendingDelete(null)
      await load()
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    }
  }

  return (
    <Page>
      <PageHeader
        title="评分 Schema"
        actions={
          <Button
            icon={Plus}
            variant="primary"
            disabled={creating}
            onClick={() => void createLibrary()}
          >
            {creating ? '正在新建' : '新建草稿库'}
          </Button>
        }
      />

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? <div className={styles.loading}>正在加载 Schema...</div> : null}
      {!loading && schemas.length === 0 ? (
        <EmptyState icon={BookOpen} title="暂无正式 Schema" />
      ) : null}
      {!loading && schemas.length > 0 ? (
        <div className={styles.list}>
          {schemas.map((item) => (
            <article className={styles.row} key={item.schemaId}>
              <div className={styles.rowMain}>
                <button
                  className={styles.rowTitle}
                  onClick={() => navigate(`/schemas/${item.schemaId}`)}
                  type="button"
                >
                  {item.data.name}
                </button>
                <p className={styles.rowDescription}>
                  {questionTypeLabels[item.structure.questionType]} · 满分 {item.data.maxScore} ·{' '}
                  {item.data.description}
                </p>
              </div>
              <div className={styles.rowActions}>
                <span className={styles.badge}>正式版 r{item.revision}</span>
                <Button icon={ArrowRight} onClick={() => navigate(`/schemas/${item.schemaId}`)}>
                  编辑
                </Button>
                <IconButton
                  icon={Trash2}
                  label="删除正式 Schema"
                  variant="danger"
                  onClick={() => setPendingDelete({ kind: 'schema', item })}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="schema-draft-libraries-heading">
        <div className={styles.sectionHeader}>
          <h2 id="schema-draft-libraries-heading">结构草稿库</h2>
        </div>
        {!loading && libraries.length === 0 ? (
          <EmptyState icon={FilePenLine} title="暂无草稿库" />
        ) : null}
        {!loading && libraries.length > 0 ? (
          <div className={styles.list}>
            {libraries.map((item) => (
              <article className={styles.row} key={item.libraryId}>
                <div className={styles.rowMain}>
                  <button
                    className={styles.rowTitle}
                    onClick={() => navigate(`/schemas/drafts/${item.libraryId}`)}
                    type="button"
                  >
                    {item.name}
                  </button>
                  <p className={styles.rowDescription}>{item.drafts.length} 个结构草稿</p>
                </div>
                <div className={styles.rowActions}>
                  <Button onClick={() => navigate(`/schemas/drafts/${item.libraryId}`)}>
                    进入
                  </Button>
                  <IconButton
                    icon={Trash2}
                    label="删除草稿库"
                    variant="danger"
                    onClick={() => setPendingDelete({ kind: 'library', item })}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <ConfirmModal
        danger
        confirmLabel="删除"
        message={
          pendingDelete?.kind === 'library'
            ? '草稿库及其中的所有结构草稿都会被删除，已发布的正式 Schema 不受影响。'
            : '删除后引用这个 Schema 的模板将无法通过校验。'
        }
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === 'library'
            ? `删除草稿库“${pendingDelete.item.name}”？`
            : `删除正式 Schema“${pendingDelete?.item.data.name ?? ''}”？`
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Page>
  )
}
