import { useCallback, useEffect, useState, type JSX } from 'react'
import type { InterfaceDraftSummary } from '@ls101/interface-editor'
import { AlertCircle, FilePenLine, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage } from './interfaceUi'
import shared from './InterfaceShared.module.css'

export function InterfaceDraftListPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const [items, setItems] = useState<InterfaceDraftSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<InterfaceDraftSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await application.browser.listDrafts())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [application])

  useEffect(() => {
    let active = true
    void application.browser
      .listDrafts()
      .then((values) => {
        if (active) setItems(values)
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
      setPendingDelete(null)
      await load()
      toast.success(`已删除草稿“${item.name || '未命名题型'}”`)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return (
    <Page>
      <PageHeader
        title="题型库"
        actions={
          <Button icon={Plus} variant="primary" onClick={() => void createDraft()}>
            新建题型
          </Button>
        }
      />

      <div className={shared.tabs} role="tablist" aria-label="题型库内容">
        <button
          aria-selected="false"
          role="tab"
          type="button"
          onClick={() => navigate('/interfaces')}
        >
          题型
        </button>
        <button aria-selected="true" role="tab" type="button">
          草稿
        </button>
      </div>

      {error ? (
        <div className={shared.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? <div className={shared.loading}>正在加载草稿...</div> : null}
      {!loading && items.length === 0 ? <EmptyState icon={FilePenLine} title="暂无草稿" /> : null}
      {!loading && items.length > 0 ? (
        <div className={shared.list}>
          {items.map((item) => (
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
