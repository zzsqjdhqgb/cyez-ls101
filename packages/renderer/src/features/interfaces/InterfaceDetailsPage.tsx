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
  PencilLine,
  Plus,
  Sparkles,
  Trash2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ActionMenu, ActionMenuItem } from '../../components/ui/ActionMenu'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage, flattenNodes, formatDate } from './interfaceUi'
import shared from './InterfaceShared.module.css'
import styles from './InterfaceDetailsPage.module.css'

type DetailsView = 'instances' | 'definition'
type CreateMode = 'manual' | 'ai'

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
  const [view, setView] = useState<DetailsView>('instances')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createMode, setCreateMode] = useState<CreateMode>('manual')
  const [createError, setCreateError] = useState<string | null>(null)

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
    const nextName = createName.trim()
    if (!nextName) {
      setCreateError('请输入题组名称。')
      return
    }
    setWorking(true)
    setCreateError(null)
    try {
      const created = await application.published.createBlankInstance(interfaceId, nextName)
      setCreateOpen(false)
      navigate(
        `/interfaces/${encodeURIComponent(interfaceId)}/instances/${created.instance.instanceId}`,
        { state: createMode === 'ai' ? { openAIGeneration: true } : undefined }
      )
    } catch (reason) {
      setCreateError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  const beginCreate = (): void => {
    setCreateName('')
    setCreateMode('manual')
    setCreateError(null)
    setCreateOpen(true)
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
    navigate(`/interfaces/${encodeURIComponent(interfaceId)}/export`)
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
          <div className={styles.contextLine}>
            <p>{details.definition.description || '暂无描述'}</p>
            {details.source.type === 'builtin' ? (
              <span className={shared.badge}>内置题型</span>
            ) : null}
          </div>

          <div className={shared.tabs} role="tablist" aria-label="题型详情内容">
            <button
              aria-selected={view === 'instances'}
              role="tab"
              type="button"
              onClick={() => setView('instances')}
            >
              题组
            </button>
            <button
              aria-selected={view === 'definition'}
              role="tab"
              type="button"
              onClick={() => setView('definition')}
            >
              题型定义
            </button>
          </div>

          {view === 'instances' ? (
            <>
              <div className={shared.sectionHeader}>
                <div>
                  <h2>题组</h2>
                  <span className={styles.sectionHint}>为试卷模板准备可复用的具体内容</span>
                </div>
                <Button icon={Plus} variant="primary" disabled={working} onClick={beginCreate}>
                  新建题组
                </Button>
              </div>

              {instances.length === 0 ? <EmptyState icon={Layers3} title="暂无题组" /> : null}
              {instances.length > 0 ? (
                <div className={shared.list}>
                  {instances.map((instance) => (
                    <article className={shared.row} key={instance.instanceId}>
                      <button
                        aria-label={instance.name}
                        className={shared.rowPrimary}
                        onClick={() =>
                          navigate(
                            `/interfaces/${encodeURIComponent(interfaceId)}/instances/${instance.instanceId}`
                          )
                        }
                        type="button"
                      >
                        <span className={shared.rowTitle}>{instance.name}</span>
                        <p className={shared.rowDescription}>{formatDate(instance.generatedAt)}</p>
                      </button>
                      <div className={shared.rowActions}>
                        <ActionMenu label={`题组操作：${instance.name}`}>
                          <ActionMenuItem
                            danger
                            icon={Trash2}
                            onSelect={() => setPendingDelete(instance)}
                          >
                            删除题组
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <section className={styles.definition} aria-label="题型定义">
              <div className={styles.definitionActions}>
                <Button icon={Copy} disabled={working} onClick={() => void copyToDraft()}>
                  复制为草稿
                </Button>
                <Button icon={FileOutput} disabled={working} onClick={() => void exportInterface()}>
                  导出题型
                </Button>
              </div>
              <section>
                <h2>生成要求</h2>
                <pre>{details.definition.promptTemplate}</pre>
              </section>
              <section>
                <div className={styles.definitionHeading}>
                  <h2>字段结构</h2>
                  {prompts ? (
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
                  ) : null}
                </div>
                <DefinitionTree fields={details.definition.fields} />
              </section>
            </section>
          )}

          <Modal
            open={createOpen}
            overlayClassName={styles.modalBackdrop}
            onOpenChange={(open) => {
              if (!working) setCreateOpen(open)
            }}
          >
            <form
              className={styles.createDialog}
              onSubmit={(event) => {
                event.preventDefault()
                void createInstance()
              }}
            >
              <div className={styles.createHeader}>
                <ModalTitle asChild>
                  <h2>新建题组</h2>
                </ModalTitle>
                <ModalDescription asChild>
                  <p>先命名题组并选择进入编辑器后的起始方式。</p>
                </ModalDescription>
              </div>
              <label className={styles.createName}>
                <span>题组名称</span>
                <input
                  autoFocus
                  value={createName}
                  disabled={working}
                  placeholder="例如：校园生活第一套"
                  onChange={(event) => {
                    setCreateName(event.target.value)
                    setCreateError(null)
                  }}
                />
              </label>
              <fieldset className={styles.createModes}>
                <legend>进入方式</legend>
                <label data-selected={createMode === 'manual' || undefined}>
                  <input
                    checked={createMode === 'manual'}
                    disabled={working}
                    name="create-mode"
                    type="radio"
                    value="manual"
                    onChange={() => setCreateMode('manual')}
                  />
                  <PencilLine aria-hidden="true" />
                  <span>
                    <strong>手工填写</strong>
                    <small>进入空白字段表单</small>
                  </span>
                </label>
                <label data-selected={createMode === 'ai' || undefined}>
                  <input
                    checked={createMode === 'ai'}
                    disabled={working}
                    name="create-mode"
                    type="radio"
                    value="ai"
                    onChange={() => setCreateMode('ai')}
                  />
                  <Sparkles aria-hidden="true" />
                  <span>
                    <strong>AI 生成</strong>
                    <small>进入后配置模型并生成整组内容</small>
                  </span>
                </label>
              </fieldset>
              {createError ? (
                <div className={styles.createError} role="alert">
                  {createError}
                </div>
              ) : null}
              <div className={styles.createActions}>
                <Button disabled={working} variant="ghost" onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button disabled={working || !createName.trim()} variant="primary" type="submit">
                  {working ? '正在创建...' : '创建题组'}
                </Button>
              </div>
            </form>
          </Modal>

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
          {node.type === 'text' ? <code>[@{node.varName}]</code> : null}
          {node.type === 'image' ? (
            <code>
              [@{node.varName}.inst] / [@{node.varName}.img]
            </code>
          ) : null}
          {node.type !== 'group' ? <span>{node.description}</span> : null}
        </div>
      ))}
    </div>
  )
}
