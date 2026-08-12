import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  editInterfaceDraft,
  type FieldGroup,
  type FieldLeaf,
  type FieldNode,
  type InterfaceDraft,
  type InterfaceDraftOperation
} from '@ls101/interface-editor'
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  Check,
  ChevronRight,
  FileText,
  FolderPlus,
  Plus,
  Save,
  Send,
  Trash2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { ResizableSplit } from '../../components/ui/ResizableSplit'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import {
  errorMessage,
  flattenNodes,
  getFieldNode,
  makeUniqueKey,
  validationMessage
} from './interfaceUi'
import shared from './InterfaceShared.module.css'
import styles from './InterfaceDraftEditorPage.module.css'

const newLeaf = (): FieldLeaf => ({ type: 'text', varName: '', description: '', example: '' })
const newGroup = (): FieldGroup => ({ type: 'group', children: { order: [], nodes: {} } })

export function InterfaceDraftEditorPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const { draftId = '' } = useParams()
  const [draft, setDraft] = useState<InterfaceDraft | null>(null)
  const [selectedPath, setSelectedPath] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [confirmLeave, setConfirmLeave] = useState(false)

  useEffect(() => {
    let active = true
    void application.drafts
      .get(draftId)
      .then((value) => {
        if (active) setDraft(value)
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
  }, [application, draftId])

  const selectedNode = useMemo(
    () => (draft && selectedPath.length ? getFieldNode(draft.fields, selectedPath) : null),
    [draft, selectedPath]
  )

  const apply = (operation: InterfaceDraftOperation): boolean => {
    if (!draft) return false
    const result = editInterfaceDraft(draft, operation)
    if (result.operationApplied) {
      setDraft(result.draft)
      setDirty(true)
      setValidationErrors([])
    }
    return result.operationApplied
  }

  const save = async (notify = true): Promise<boolean> => {
    if (!draft) return false
    setSaving(true)
    setError(null)
    try {
      await application.drafts.save(draft)
      setDirty(false)
      if (notify) toast.success('草稿已保存')
      return true
    } catch (reason) {
      setError(errorMessage(reason))
      return false
    } finally {
      setSaving(false)
    }
  }

  const publish = async (): Promise<void> => {
    if (!(await save(false))) return
    setSaving(true)
    try {
      const result = await application.drafts.publish(draftId)
      if (result.status === 'invalid') {
        setValidationErrors(result.errors.map(validationMessage))
        return
      }
      toast.success('题型已发布')
      navigate(`/interfaces/${encodeURIComponent(result.interface.interfaceId)}`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const leave = (): void => {
    if (dirty) {
      setConfirmLeave(true)
      return
    }
    navigate('/interfaces/drafts')
  }

  const addNode = (node: FieldNode): void => {
    if (!draft) return
    const parentPath = selectedNode?.type === 'group' ? selectedPath : []
    const base = node.type === 'group' ? 'group' : 'field'
    const key = makeUniqueKey(draft.fields, parentPath, base)
    apply({ type: 'add-node', parentPath, key, node })
    setSelectedPath([...parentPath, key])
  }

  const removeSelected = (): void => {
    if (!selectedPath.length) return
    apply({ type: 'remove-node', path: selectedPath })
    setSelectedPath(selectedPath.slice(0, -1))
  }

  if (loading) return <div className={shared.loading}>正在加载草稿...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarIdentity}>
          <IconButton icon={ArrowLeft} label="返回草稿列表" variant="ghost" onClick={leave} />
          <div>
            <h1>{draft?.name || '未命名题型'}</h1>
            <span>{dirty ? '有未保存修改' : '草稿'}</span>
          </div>
        </div>
        <div className={styles.toolbarActions}>
          <Button icon={Save} disabled={!draft || saving || !dirty} onClick={() => void save()}>
            保存
          </Button>
          <Button
            icon={Send}
            variant="primary"
            disabled={!draft || saving}
            onClick={() => void publish()}
          >
            发布
          </Button>
        </div>
      </header>

      {!draft ? (
        <main className={styles.missing}>草稿不存在</main>
      ) : (
        <ResizableSplit
          className={styles.workspace}
          initialSize={390}
          minFirst={280}
          minSecond={410}
          label="调整题型内容与字段编辑区宽度"
        >
          <section className={styles.documentPane} aria-label="题型内容">
            {error ? (
              <div className={shared.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            {validationErrors.length ? (
              <div className={styles.validation} role="alert">
                <strong>发布前需要修正以下内容</strong>
                {validationErrors.map((message) => (
                  <span key={message}>{message}</span>
                ))}
              </div>
            ) : null}

            <div className={styles.formSection}>
              <div className={styles.sectionTitle}>
                <FileText aria-hidden="true" />
                <h2>基本信息</h2>
              </div>
              <label>
                <span>名称</span>
                <input
                  value={draft.name}
                  onChange={(event) => apply({ type: 'set-name', value: event.target.value })}
                  placeholder="例如：上海高考听说"
                />
              </label>
              <label>
                <span>描述</span>
                <textarea
                  rows={3}
                  value={draft.description}
                  onChange={(event) =>
                    apply({ type: 'set-description', value: event.target.value })
                  }
                  placeholder="简要说明这个题型的用途"
                />
              </label>
            </div>

            <div className={styles.formSection}>
              <div className={styles.sectionTitle}>
                <Braces aria-hidden="true" />
                <h2>提示词</h2>
              </div>
              <label>
                <span>生成要求</span>
                <textarea
                  className={styles.prompt}
                  value={draft.promptTemplate}
                  onChange={(event) => apply({ type: 'set-prompt', value: event.target.value })}
                  placeholder="描述 AI 应该如何生成这一题型的内容"
                />
              </label>
            </div>
          </section>

          <section className={styles.fieldsPane} aria-label="字段结构">
            <header className={styles.paneHeader}>
              <div>
                <h2>字段结构</h2>
                <span>{flattenNodes(draft.fields).length} 个节点</span>
              </div>
              <div>
                <IconButton icon={Plus} label="添加字段" onClick={() => addNode(newLeaf())} />
                <IconButton
                  icon={FolderPlus}
                  label="添加字段组"
                  onClick={() => addNode(newGroup())}
                />
              </div>
            </header>

            <ResizableSplit
              className={styles.fieldWorkspace}
              initialSize={220}
              minFirst={170}
              minSecond={220}
              label="调整字段树与属性面板宽度"
            >
              <div className={styles.tree}>
                {draft.fields.order.length === 0 ? (
                  <div className={styles.treeEmpty}>添加第一个字段或字段组</div>
                ) : null}
                {flattenNodes(draft.fields).map(({ key, node, path, depth }) => {
                  const selected = path.join('.') === selectedPath.join('.')
                  return (
                    <button
                      className={styles.treeRow}
                      data-selected={selected || undefined}
                      key={path.join('.')}
                      onClick={() => setSelectedPath(path)}
                      style={{ paddingLeft: 12 + depth * 20 }}
                      type="button"
                    >
                      {node.type === 'group' ? <ChevronRight aria-hidden="true" /> : <span />}
                      <span className={styles.nodeType}>
                        {node.type === 'group' ? '组' : node.type}
                      </span>
                      <strong>{key}</strong>
                      {node.type === 'text' && node.varName ? <code>{node.varName}</code> : null}
                      {node.type === 'image' && node.varName ? (
                        <code>{node.varName}.inst / .img</code>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              <div className={styles.inspector}>
                {selectedNode ? (
                  <FieldInspector
                    key={selectedPath.join('.')}
                    node={selectedNode}
                    path={selectedPath}
                    onApply={(operation) => {
                      const applied = apply(operation)
                      if (applied && operation.type === 'rename-node') {
                        setSelectedPath([...selectedPath.slice(0, -1), operation.key])
                      }
                      return applied
                    }}
                    onRemove={removeSelected}
                  />
                ) : (
                  <div className={styles.inspectorEmpty}>
                    <Check aria-hidden="true" />
                    <span>选择一个节点编辑字段配置</span>
                  </div>
                )}
              </div>
            </ResizableSplit>
          </section>
        </ResizableSplit>
      )}
      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate('/interfaces/drafts')}
      />
    </div>
  )
}

interface FieldInspectorProps {
  node: FieldNode
  path: string[]
  onApply(operation: InterfaceDraftOperation): boolean
  onRemove(): void
}

function FieldInspector({ node, path, onApply, onRemove }: FieldInspectorProps): JSX.Element {
  const [key, setKey] = useState(path.at(-1) ?? '')

  const updateLeaf = (update: Partial<FieldLeaf>): void => {
    if (node.type === 'group') return
    onApply({ type: 'update-node', path, node: { ...node, ...update } })
  }

  return (
    <div className={styles.inspectorForm}>
      <div className={styles.inspectorHeading}>
        <div>
          <span>节点配置</span>
          <strong>{path.join(' / ')}</strong>
        </div>
        <IconButton icon={Trash2} label="删除节点" variant="danger" onClick={onRemove} />
      </div>
      <label>
        <span>字段标识</span>
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onBlur={() => {
            if (key !== path.at(-1) && !onApply({ type: 'rename-node', path, key })) {
              setKey(path.at(-1) ?? '')
            }
          }}
        />
      </label>
      {node.type !== 'group' ? (
        <>
          <label>
            <span>类型</span>
            <select
              value={node.type}
              onChange={(event) => updateLeaf({ type: event.target.value as 'text' | 'image' })}
            >
              <option value="text">文本</option>
              <option value="image">图片</option>
            </select>
          </label>
          <label>
            <span>变量名</span>
            <input
              value={node.varName}
              onChange={(event) => updateLeaf({ varName: event.target.value })}
              placeholder="例如：questionText"
            />
          </label>
          <label>
            <span>描述</span>
            <textarea
              rows={3}
              value={node.description}
              onChange={(event) => updateLeaf({ description: event.target.value })}
              placeholder="告诉 AI 这个字段包含什么"
            />
          </label>
          <label>
            <span>示例</span>
            <textarea
              rows={4}
              value={node.example}
              onChange={(event) => updateLeaf({ example: event.target.value })}
              placeholder="给出一个符合要求的示例值"
            />
          </label>
        </>
      ) : (
        <p className={styles.groupHint}>选中此字段组后，新字段会添加到组内。</p>
      )}
    </div>
  )
}
