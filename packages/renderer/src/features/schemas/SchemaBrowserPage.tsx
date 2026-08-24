import { useCallback, useEffect, useState, type JSX } from 'react'
import type { SchemaDefinition } from '@ls101/schema-editor'
import { AlertCircle, ArrowRight, BookOpen, Plus, Trash2 } from 'lucide-react'
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

type PendingDelete = { kind: 'schema'; item: SchemaDefinition }
type SchemaView = 'builtin' | 'custom'

export function SchemaBrowserPage(): JSX.Element {
  const repository = useSchemaRepository()
  const navigate = useNavigate()
  const [schemas, setSchemas] = useState<SchemaDefinition[]>([])
  const [builtinSchemaIds, setBuiltinSchemaIds] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [view, setView] = useState<SchemaView>('builtin')

  const visibleSchemas = schemas.filter((item) =>
    view === 'builtin' ? builtinSchemaIds.has(item.schemaId) : !builtinSchemaIds.has(item.schemaId)
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [schemaIds, builtinIds] = await Promise.all([
        repository.listSchemaIds(),
        repository.listBuiltinSchemaIds()
      ])
      const schemaItems = await Promise.all(schemaIds.map((id) => repository.getSchema(id)))
      setSchemas(schemaItems.filter((item): item is SchemaDefinition => item !== null))
      setBuiltinSchemaIds(new Set(builtinIds))
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    let active = true
    void Promise.all([repository.listSchemaIds(), repository.listBuiltinSchemaIds()])
      .then(([schemaIds, builtinIds]) =>
        Promise.all([Promise.all(schemaIds.map((id) => repository.getSchema(id))), builtinIds])
      )
      .then(([schemaItems, builtinIds]) => {
        if (!active) return
        setSchemas(schemaItems.filter((item): item is SchemaDefinition => item !== null))
        setBuiltinSchemaIds(new Set(builtinIds))
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

  const createSchema = (): void => {
    navigate('/schemas/new')
  }

  const copySchema = (source: SchemaDefinition): void => {
    navigate(`/schemas/new?copy=${encodeURIComponent(source.schemaId)}`)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    try {
      await repository.deleteSchema(pendingDelete.item.schemaId)
      toast.success(`已删除评分单元“${pendingDelete.item.data.name}”`)
      setPendingDelete(null)
      await load()
    } catch (reason) {
      setError(schemaErrorMessage(reason))
    }
  }

  return (
    <Page>
      <PageHeader
        title="评分单元"
        actions={
          <Button icon={Plus} variant="primary" onClick={createSchema}>
            新建评分单元
          </Button>
        }
      />

      <div className={styles.tabs} role="tablist" aria-label="评分单元来源">
        <button
          aria-selected={view === 'custom'}
          role="tab"
          type="button"
          onClick={() => setView('custom')}
        >
          我的评分单元
        </button>
        <button
          aria-selected={view === 'builtin'}
          role="tab"
          type="button"
          onClick={() => setView('builtin')}
        >
          内置评分单元
        </button>
      </div>

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? <div className={styles.loading}>正在加载 Schema...</div> : null}
      {!loading && visibleSchemas.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={view === 'builtin' ? '暂无内置评分单元' : '暂无我的评分单元'}
        />
      ) : null}
      {!loading && visibleSchemas.length > 0 ? (
        <div className={styles.list}>
          {visibleSchemas.map((item) => (
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
                <span className={styles.badge}>
                  {builtinSchemaIds.has(item.schemaId) ? '内置' : `r${item.revision}`}
                </span>
                {builtinSchemaIds.has(item.schemaId) ? (
                  <Button icon={ArrowRight} onClick={() => copySchema(item)}>
                    复制并修改
                  </Button>
                ) : (
                  <Button icon={ArrowRight} onClick={() => navigate(`/schemas/${item.schemaId}`)}>
                    编辑
                  </Button>
                )}
                {!builtinSchemaIds.has(item.schemaId) ? (
                  <IconButton
                    icon={Trash2}
                    label="删除评分单元"
                    variant="danger"
                    onClick={() => setPendingDelete({ kind: 'schema', item })}
                  />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除"
        message="删除后引用这个评分单元的模板将无法通过校验。"
        open={pendingDelete !== null}
        title={`删除评分单元“${pendingDelete?.item.data.name ?? ''}”？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </Page>
  )
}
