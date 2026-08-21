import { useCallback, useEffect, useState, type JSX } from 'react'
import type { InterfaceDraftSummary, PublishedInterfaceSummary } from '@ls101/interface-editor'
import { AlertCircle, FileDown, FilePenLine, Plus, Shapes, Trash2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ActionMenu, ActionMenuItem } from '../../components/ui/ActionMenu'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage } from './interfaceUi'
import shared from './InterfaceShared.module.css'

type InterfaceLibraryView = 'published' | 'drafts'

export function InterfaceListPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const view: InterfaceLibraryView = searchParams.get('view') === 'drafts' ? 'drafts' : 'published'
  const [publishedItems, setPublishedItems] = useState<PublishedInterfaceSummary[]>([])
  const [draftItems, setDraftItems] = useState<InterfaceDraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<InterfaceDraftSummary | null>(null)

  const reloadPublished = useCallback(async () => {
    setError(null)
    try {
      setPublishedItems(await application.browser.listPublished())
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }, [application])

  useEffect(() => {
    let active = true
    void Promise.all([application.browser.listPublished(), application.browser.listDrafts()])
      .then(([published, drafts]) => {
        if (!active) return
        setPublishedItems(published)
        setDraftItems(drafts)
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application])

  useEffect(() => {
    const reload = (): void => {
      void reloadPublished()
    }
    window.addEventListener('interface-builtins-changed', reload)
    return () => window.removeEventListener('interface-builtins-changed', reload)
  }, [reloadPublished])

  const switchView = (next: InterfaceLibraryView): void => {
    setSearchParams(next === 'drafts' ? { view: 'drafts' } : {})
  }

  const createDraft = async (): Promise<void> => {
    setError(null)
    try {
      const draft = await application.drafts.create()
      navigate(`/interfaces/drafts/${draft.draftId}`)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const deleteDraft = async (item: InterfaceDraftSummary): Promise<void> => {
    try {
      await application.drafts.delete(item.draftId)
      setDraftItems((current) => current.filter((draft) => draft.draftId !== item.draftId))
      setPendingDelete(null)
      toast.success(`已删除草稿“${item.name || '未命名题型'}”`)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const importInterface = async (): Promise<void> => {
    setImporting(true)
    setError(null)
    try {
      const session = await application.transfer.beginImport()
      if (!session) return
      navigate('/interfaces/import', { state: { session } })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="题型库"
        actions={
          view === 'published' ? (
            <ActionMenu label="题型库操作">
              <ActionMenuItem
                disabled={importing}
                icon={FileDown}
                onSelect={() => void importInterface()}
              >
                {importing ? '正在导入' : '导入题型'}
              </ActionMenuItem>
            </ActionMenu>
          ) : (
            <Button icon={Plus} variant="primary" onClick={() => void createDraft()}>
              新建题型
            </Button>
          )
        }
      />

      <div className={shared.tabs} role="tablist" aria-label="题型库内容">
        <button
          aria-selected={view === 'published'}
          role="tab"
          type="button"
          onClick={() => switchView('published')}
        >
          题型
        </button>
        <button
          aria-selected={view === 'drafts'}
          role="tab"
          type="button"
          onClick={() => switchView('drafts')}
        >
          草稿
        </button>
      </div>

      {error ? (
        <div className={shared.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className={shared.loading}>
          {view === 'published' ? '正在加载题型...' : '正在加载草稿...'}
        </div>
      ) : null}
      {!loading && view === 'published' && publishedItems.length === 0 ? (
        <EmptyState icon={Shapes} title="暂无题型" />
      ) : null}
      {!loading && view === 'published' && publishedItems.length > 0 ? (
        <div className={shared.list}>
          {publishedItems.map((item) => (
            <article className={shared.row} key={item.interfaceId}>
              <button
                aria-label={item.name}
                className={shared.rowPrimary}
                onClick={() => navigate(`/interfaces/${encodeURIComponent(item.interfaceId)}`)}
                type="button"
              >
                <span className={shared.rowTitle}>{item.name}</span>
                <div className={shared.rowSubline}>
                  <span>{item.instanceCount} 个题组</span>
                  <p className={shared.rowDescription}>{item.description || '暂无描述'}</p>
                </div>
              </button>
              <div className={shared.rowActions}>
                {item.source.type === 'builtin' ? <span className={shared.badge}>内置</span> : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {!loading && view === 'drafts' && draftItems.length === 0 ? (
        <EmptyState icon={FilePenLine} title="暂无草稿" />
      ) : null}
      {!loading && view === 'drafts' && draftItems.length > 0 ? (
        <div className={shared.list}>
          {draftItems.map((item) => (
            <article className={shared.row} key={item.draftId}>
              <button
                aria-label={item.name || '未命名题型'}
                className={shared.rowPrimary}
                onClick={() => navigate(`/interfaces/drafts/${item.draftId}`)}
                type="button"
              >
                <span className={shared.rowTitle}>{item.name || '未命名题型'}</span>
                <p className={shared.rowDescription}>{item.description || '暂无描述'}</p>
              </button>
              <div className={shared.rowActions}>
                <IconButton
                  icon={Trash2}
                  label="删除草稿"
                  variant="danger"
                  onClick={() => setPendingDelete(item)}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <ConfirmModal
        danger
        confirmLabel="删除"
        message="删除后无法恢复，但不会影响已经发布的题型。"
        open={pendingDelete !== null}
        title={`删除草稿“${pendingDelete?.name || '未命名题型'}”？`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteDraft(pendingDelete)
        }}
      />
    </Page>
  )
}
