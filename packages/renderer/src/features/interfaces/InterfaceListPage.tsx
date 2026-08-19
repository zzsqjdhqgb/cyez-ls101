import { useCallback, useEffect, useState, type JSX } from 'react'
import type { PublishedInterfaceSummary } from '@ls101/interface-editor'
import { AlertCircle, FileDown, Shapes } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ActionMenu, ActionMenuItem } from '../../components/ui/ActionMenu'
import { EmptyState } from '../../components/ui/EmptyState'
import { Page, PageHeader } from '../../components/ui/Page'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage } from './interfaceUi'
import shared from './InterfaceShared.module.css'

export function InterfaceListPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const [items, setItems] = useState<PublishedInterfaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await application.browser.listPublished())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [application])

  useEffect(() => {
    let active = true
    void application.browser
      .listPublished()
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

  useEffect(() => {
    const reload = (): void => {
      void load()
    }
    window.addEventListener('interface-builtins-changed', reload)
    return () => window.removeEventListener('interface-builtins-changed', reload)
  }, [load])

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
          <ActionMenu label="题型库操作">
            <ActionMenuItem
              disabled={importing}
              icon={FileDown}
              onSelect={() => void importInterface()}
            >
              {importing ? '正在导入' : '导入题型'}
            </ActionMenuItem>
          </ActionMenu>
        }
      />

      <div className={shared.tabs} role="tablist" aria-label="题型库内容">
        <button aria-selected="true" role="tab" type="button">
          题型
        </button>
        <button
          aria-selected="false"
          role="tab"
          type="button"
          onClick={() => navigate('/interfaces/drafts')}
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

      {loading ? <div className={shared.loading}>正在加载题型...</div> : null}
      {!loading && items.length === 0 ? <EmptyState icon={Shapes} title="暂无题型" /> : null}
      {!loading && items.length > 0 ? (
        <div className={shared.list}>
          {items.map((item) => (
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
    </Page>
  )
}
