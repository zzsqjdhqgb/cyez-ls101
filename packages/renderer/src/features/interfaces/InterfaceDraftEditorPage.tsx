import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  editInterfaceDraft,
  type FieldGroup,
  type FieldLeaf,
  type FieldNode,
  type InterfaceDraft,
  type InterfaceDraftOperation,
  type ValidationError
} from '@ls101/interface-editor'
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  Check,
  ChevronDown,
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
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard'
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
  const [validationErrors, setValidationErrors] = useState<readonly ValidationError[]>([])
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmRemoveGroup, setConfirmRemoveGroup] = useState(false)
  const unsavedChanges = useUnsavedChangesGuard(dirty)

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
  const visibleNodes = useMemo(
    () =>
      draft
        ? flattenNodes(draft.fields).filter(({ path }) =>
            path.slice(0, -1).every((_segment, index) => {
              const ancestor = path.slice(0, index + 1).join('.')
              return !collapsedPaths.has(ancestor)
            })
          )
        : [],
    [collapsedPaths, draft]
  )
  const addTargetPath = selectedNode?.type === 'group' ? selectedPath : []
  const addTargetLabel = addTargetPath.length ? addTargetPath.join(' / ') : '根级'

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
        setValidationErrors(result.errors)
        return
      }
      toast.success('题型已发布')
      unsavedChanges.allowNextNavigation()
      navigate(`/interfaces/${encodeURIComponent(result.interface.interfaceId)}`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const leave = (): void => {
    navigate('/interfaces/drafts')
  }

  const addNode = (node: FieldNode): void => {
    if (!draft) return
    const parentPath = addTargetPath
    const base = node.type === 'group' ? 'group' : 'field'
    const key = makeUniqueKey(draft.fields, parentPath, base)
    apply({ type: 'add-node', parentPath, key, node })
    setSelectedPath([...parentPath, key])
  }

  const removeSelected = (): void => {
    if (!selectedPath.length) return
    if (
      selectedNode?.type === 'group' &&
      selectedNode.children.order.length > 0 &&
      !confirmRemoveGroup
    ) {
      setConfirmRemoveGroup(true)
      return
    }
    apply({ type: 'remove-node', path: selectedPath })
    setSelectedPath(selectedPath.slice(0, -1))
    setConfirmRemoveGroup(false)
  }

  const focusValidationError = (item: ValidationError): void => {
    if (item.code === 'EMPTY_NAME') {
      document.getElementById('interface-draft-name')?.focus()
      return
    }
    if (item.code === 'EMPTY_PROMPT_TEMPLATE') {
      document.getElementById('interface-draft-prompt')?.focus()
      return
    }
    if (!item.path) return
    const path = item.path.split('.')
    setCollapsedPaths((current) => {
      const next = new Set(current)
      path
        .slice(0, -1)
        .forEach((_segment, index) => next.delete(path.slice(0, index + 1).join('.')))
      return next
    })
    setSelectedPath(path)
    window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-field-path]')).find(
        (element) => element.dataset.fieldPath === item.path
      )
      target?.focus()
      target?.scrollIntoView({ block: 'nearest' })
    })
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
            onClick={() => setConfirmPublish(true)}
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
                {validationErrors.map((item, index) => (
                  <button
                    key={`${item.code}-${item.path}-${index}`}
                    type="button"
                    onClick={() => focusValidationError(item)}
                  >
                    {validationMessage(item)}
                  </button>
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
                  aria-invalid={validationErrors.some((item) => item.code === 'EMPTY_NAME')}
                  id="interface-draft-name"
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
                  aria-invalid={validationErrors.some(
                    (item) => item.code === 'EMPTY_PROMPT_TEMPLATE'
                  )}
                  className={styles.prompt}
                  id="interface-draft-prompt"
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
                <span>
                  {flattenNodes(draft.fields).length} 个节点 · 添加到：{addTargetLabel}
                </span>
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
                {visibleNodes.map(({ key, node, path, depth }) => {
                  const selected = path.join('.') === selectedPath.join('.')
                  const pathKey = path.join('.')
                  const collapsed = collapsedPaths.has(pathKey)
                  return (
                    <div
                      className={styles.treeRow}
                      data-selected={selected || undefined}
                      key={pathKey}
                      style={{ paddingLeft: 8 + depth * 20 }}
                    >
                      {node.type === 'group' ? (
                        <button
                          aria-expanded={!collapsed}
                          aria-label={`${collapsed ? '展开' : '折叠'}字段组“${key}”`}
                          className={styles.treeToggle}
                          type="button"
                          onClick={() =>
                            setCollapsedPaths((current) => {
                              const next = new Set(current)
                              if (collapsed) next.delete(pathKey)
                              else next.add(pathKey)
                              return next
                            })
                          }
                        >
                          {collapsed ? (
                            <ChevronRight aria-hidden="true" />
                          ) : (
                            <ChevronDown aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        className={styles.treeNode}
                        data-field-path={pathKey}
                        type="button"
                        onClick={() => setSelectedPath(path)}
                      >
                        <span className={styles.nodeType}>
                          {node.type === 'group' ? '组' : node.type}
                        </span>
                        <strong>{key}</strong>
                        {node.type === 'text' && node.varName ? <code>{node.varName}</code> : null}
                        {node.type === 'image' && node.varName ? (
                          <code>{node.varName}.inst / .img</code>
                        ) : null}
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className={styles.inspector}>
                {selectedNode ? (
                  <FieldInspector
                    key={selectedPath.join('.')}
                    node={selectedNode}
                    path={selectedPath}
                    validationErrors={validationErrors.filter(
                      (item) => item.path === selectedPath.join('.')
                    )}
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
        open={unsavedChanges.navigationPending}
        title="放弃未保存的修改？"
        onCancel={unsavedChanges.cancelNavigation}
        onConfirm={unsavedChanges.confirmNavigation}
      />
      <ConfirmModal
        confirmLabel="发布题型"
        message="发布后会生成不可直接修改的稳定题型，当前草稿仍会保留。"
        open={confirmPublish}
        title="发布当前题型草稿？"
        onCancel={() => setConfirmPublish(false)}
        onConfirm={() => {
          setConfirmPublish(false)
          void publish()
        }}
      />
      <ConfirmModal
        confirmLabel="删除字段组"
        danger
        message="字段组中的所有子字段也会一并从当前草稿中删除。"
        open={confirmRemoveGroup}
        title={`删除字段组“${selectedPath.at(-1) ?? ''}”？`}
        onCancel={() => setConfirmRemoveGroup(false)}
        onConfirm={removeSelected}
      />
    </div>
  )
}

interface FieldInspectorProps {
  node: FieldNode
  path: string[]
  validationErrors: readonly ValidationError[]
  onApply(operation: InterfaceDraftOperation): boolean
  onRemove(): void
}

function FieldInspector({
  node,
  path,
  validationErrors,
  onApply,
  onRemove
}: FieldInspectorProps): JSX.Element {
  const [key, setKey] = useState(path.at(-1) ?? '')
  const [keyError, setKeyError] = useState<string | null>(null)

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
      {validationErrors.length ? (
        <div className={styles.inspectorValidation} role="alert">
          {validationErrors.map((item, index) => (
            <span key={`${item.code}-${index}`}>{validationMessage(item)}</span>
          ))}
        </div>
      ) : null}
      <label>
        <span>字段标识</span>
        <input
          value={key}
          aria-invalid={Boolean(keyError)}
          onChange={(event) => {
            setKey(event.target.value)
            setKeyError(null)
          }}
          onBlur={() => {
            if (key === path.at(-1)) return
            if (!key.trim() || key !== key.trim() || key.includes('.')) {
              setKeyError('字段标识不能为空、包含点号或带有首尾空格。')
              return
            }
            if (!onApply({ type: 'rename-node', path, key }))
              setKeyError('同一层级已经存在这个字段标识。')
          }}
        />
        {keyError ? <small className={styles.fieldError}>{keyError}</small> : null}
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
