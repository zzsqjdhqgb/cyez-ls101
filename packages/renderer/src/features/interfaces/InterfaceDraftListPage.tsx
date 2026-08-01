import { useCallback, useEffect, useState, type JSX } from 'react'
import type { InterfaceDraftSummary } from '@ls101/interface-editor'
import { AlertCircle, ArrowLeft, FilePenLine, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
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
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  return (
    <Page>
      <PageHeader
        title="题型草稿"
        actions={
          <>
            <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/interfaces')}>
              返回题型
            </Button>
            <Button icon={Plus} variant="primary" onClick={() => void createDraft()}>
              新建草稿
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
      {loading ? <div className={shared.loading}>正在加载草稿...</div> : null}
      {!loading && items.length === 0 ? <EmptyState icon={FilePenLine} title="暂无草稿" /> : null}
      {!loading && items.length > 0 ? (
        <div className={shared.list}>
          {items.map((item) => (
            <article className={shared.row} key={item.draftId}>
              <div className={shared.rowMain}>
                <button
                  className={shared.rowTitle}
                  onClick={() => navigate(`/interfaces/drafts/${item.draftId}`)}
                  type="button"
                >
                  {item.name || '未命名题型'}
                </button>
                <p className={shared.rowDescription}>{item.description || '暂无描述'}</p>
              </div>
              <div className={shared.rowActions}>
                <Button onClick={() => navigate(`/interfaces/drafts/${item.draftId}`)}>编辑</Button>
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
        message="删除后无法恢复，这不会影响已经发布的题型。"
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
