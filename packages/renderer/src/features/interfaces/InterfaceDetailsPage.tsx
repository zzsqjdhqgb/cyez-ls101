import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  FieldCollection,
  InterfaceInstanceSummary,
  InterfacePromptBundle,
  PublishedInterfaceDetails
} from '@ls101/interface-editor'
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  Copy,
  FileOutput,
  Layers3,
  Plus,
  Trash2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage, flattenNodes, formatDate } from './interfaceUi'
import shared from './InterfaceShared.module.css'
import styles from './InterfaceDetailsPage.module.css'

export function InterfaceDetailsPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const { interfaceId = '' } = useParams()
  const [details, setDetails] = useState<PublishedInterfaceDetails | null>(null)
  const [instances, setInstances] = useState<InterfaceInstanceSummary[]>([])
  const [prompts, setPrompts] = useState<InterfacePromptBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<InterfaceInstanceSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextDetails, nextInstances, nextPrompts] = await Promise.all([
        application.published.get(interfaceId),
        application.published.listInstances(interfaceId),
        application.published.getPrompts(interfaceId)
      ])
      setDetails(nextDetails)
      setInstances(nextInstances)
      setPrompts(nextPrompts)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [application, interfaceId])

  useEffect(() => {
    let active = true
    void Promise.all([
      application.published.get(interfaceId),
      application.published.listInstances(interfaceId),
      application.published.getPrompts(interfaceId)
    ])
      .then(([nextDetails, nextInstances, nextPrompts]) => {
        if (!active) return
        setDetails(nextDetails)
        setInstances(nextInstances)
        setPrompts(nextPrompts)
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
  }, [application, interfaceId])

  const createInstance = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const created = await application.published.createBlankInstance(interfaceId)
      navigate(
        `/interfaces/${encodeURIComponent(interfaceId)}/instances/${created.instance.instanceId}`
      )
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  const copyToDraft = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const draft = await application.published.copyToDraft(interfaceId)
      navigate(`/interfaces/drafts/${draft.draftId}`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  const exportInterface = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const result = await application.transfer.export(interfaceId, { mode: 'all' })
      if (result.status === 'exported') toast.success('题型已导出')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  const deleteInstance = async (instance: InterfaceInstanceSummary): Promise<void> => {
    try {
      await application.instances.delete(interfaceId, instance.instanceId)
      setPendingDelete(null)
      await load()
      toast.success(`已删除题组“${instance.name}”`)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const copyText = async (label: string, value: string): Promise<void> => {
    setError(null)
    try {
      if (!navigator.clipboard) throw new Error('当前环境无法访问剪贴板。')
      await navigator.clipboard.writeText(value)
      toast.success(`已复制${label}`)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
  }

  if (loading) return <div className={shared.loading}>正在加载题型...</div>

  return (
    <Page>
      <PageHeader
        title={details?.definition.name ?? '题型不存在'}
        actions={
          <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/interfaces')}>
            返回题型
          </Button>
        }
      />

      {error ? (
        <div className={shared.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {!details ? <EmptyState icon={Braces} title="题型不存在" /> : null}
      {details ? (
        <>
          <div className={styles.summary}>
            <p>{details.definition.description || '暂无描述'}</p>
            <div className={styles.summaryActions}>
              {details.source.type === 'builtin' ? (
                <span className={shared.badge}>内置题型</span>
              ) : null}
              <Button icon={Copy} disabled={working} onClick={() => void copyToDraft()}>
                复制为草稿
              </Button>
              <Button icon={FileOutput} disabled={working} onClick={() => void exportInterface()}>
                导出
              </Button>
            </div>
          </div>

          <details className={styles.definition}>
            <summary>题型定义</summary>
            {prompts ? (
              <div className={styles.copyTools}>
                <div className={styles.copyActions}>
                  <Button
                    icon={Copy}
                    size="small"
                    onClick={() => void copyText('完整提示词', prompts.fullPrompt)}
                  >
                    复制完整提示词
                  </Button>
                  <Button
                    icon={Copy}
                    size="small"
                    onClick={() => void copyText('提示词', prompts.prompt)}
                  >
                    复制单独提示词
                  </Button>
                  <Button
                    icon={Copy}
                    size="small"
                    onClick={() => void copyText('JSON Schema', prompts.jsonSchema)}
                  >
                    复制 JSON Schema
                  </Button>
                  <Button
                    icon={Copy}
                    size="small"
                    onClick={() => void copyText('JSON Example', prompts.jsonExample)}
                  >
                    复制 JSON Example
                  </Button>
                </div>
              </div>
            ) : null}
            <section>
              <h3>提示词</h3>
              <pre>{details.definition.promptTemplate}</pre>
            </section>
            <section>
              <h3>字段结构</h3>
              <DefinitionTree fields={details.definition.fields} />
            </section>
          </details>

          <div className={shared.sectionHeader}>
            <h2>题组</h2>
            <Button
              icon={Plus}
              variant="primary"
              disabled={working}
              onClick={() => void createInstance()}
            >
              新建题组
            </Button>
          </div>

          {instances.length === 0 ? <EmptyState icon={Layers3} title="暂无题组" /> : null}
          {instances.length > 0 ? (
            <div className={shared.list}>
              {instances.map((instance) => (
                <article className={shared.row} key={instance.instanceId}>
                  <div className={shared.rowMain}>
                    <button
                      className={shared.rowTitle}
                      onClick={() =>
                        navigate(
                          `/interfaces/${encodeURIComponent(interfaceId)}/instances/${instance.instanceId}`
                        )
                      }
                      type="button"
                    >
                      {instance.name}
                    </button>
                    <p className={shared.rowDescription}>{formatDate(instance.generatedAt)}</p>
                  </div>
                  <div className={shared.rowActions}>
                    <Button
                      onClick={() =>
                        navigate(
                          `/interfaces/${encodeURIComponent(interfaceId)}/instances/${instance.instanceId}`
                        )
                      }
                    >
                      编辑
                    </Button>
                    <IconButton
                      icon={Trash2}
                      label="删除题组"
                      variant="danger"
                      onClick={() => setPendingDelete(instance)}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          <ConfirmModal
            danger
            confirmLabel="删除"
            message="删除后无法恢复，题组中的内容和资源也会一并删除。"
            open={pendingDelete !== null}
            title={`删除题组“${pendingDelete?.name ?? ''}”？`}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              if (pendingDelete) void deleteInstance(pendingDelete)
            }}
          />
        </>
      ) : null}
    </Page>
  )
}

function DefinitionTree({ fields }: { fields: FieldCollection }): JSX.Element {
  return (
    <div className={styles.fieldList}>
      {flattenNodes(fields).map(({ key, node, path, depth }) => (
        <div
          className={styles.fieldRow}
          key={path.join('.')}
          style={{ paddingLeft: 12 + depth * 24 }}
        >
          <span className={styles.fieldKind}>{node.type === 'group' ? '组' : node.type}</span>
          <strong>{key}</strong>
          {node.type !== 'group' ? <code>[@{node.varName}]</code> : null}
          {node.type !== 'group' ? <span>{node.description}</span> : null}
        </div>
      ))}
    </div>
  )
}
