import { useState, type JSX } from 'react'
import type { FrameNode, TemplateNode, TextExpression } from '@ls101/template-editor'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Layers3,
  ListChecks,
  Redo2,
  Save,
  Trash2,
  Undo2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { useTemplateApplication } from './TemplateApplicationContext'
import styles from './TemplateDocumentPage.module.css'
import { useTemplateEditorSession } from './useTemplateEditorSession'

type InsertableNodeType = 'frame' | 'page' | 'choice-question'

interface NodeLocation {
  node: TemplateNode
  parent: FrameNode | null
  index: number
}

export function TemplateDocumentPage(): JSX.Element {
  const { templateId = '' } = useParams()
  return <TemplateDocumentEditor key={templateId} templateId={templateId} />
}

function TemplateDocumentEditor({ templateId }: { templateId: string }): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const session = useTemplateEditorSession(application, templateId)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  const document = session.document
  const root = document?.content.root ?? null
  const selectedLocation = root ? locateNode(root, session.selectedNodeId) : null
  const selectedNode = selectedLocation?.node ?? null
  const selectedIsRoot = selectedNode?.id === root?.id
  const canMoveUp = Boolean(selectedLocation?.parent && selectedLocation.index > 0)
  const canMoveDown = Boolean(
    selectedLocation?.parent && selectedLocation.index < selectedLocation.parent.children.length - 1
  )

  const editMetadata = (
    type: 'set-template-name' | 'set-template-description',
    value: string
  ): void => {
    session.apply({ type, value })
  }

  const insertNode = (type: InsertableNodeType): void => {
    if (!root) return
    const target = insertionTarget(root, selectedLocation)
    session.apply({
      type: 'insert-node',
      parentId: target.parentId,
      index: target.index,
      node: createNode(type)
    })
  }

  const moveSelected = (offset: -1 | 1): void => {
    if (!selectedLocation?.parent) return
    session.apply({
      type: 'move-node',
      nodeId: selectedLocation.node.id,
      parentId: selectedLocation.parent.id,
      index: selectedLocation.index + offset
    })
  }

  const copySelected = (): void => {
    if (!selectedLocation?.parent) return
    session.apply({
      type: 'copy-node',
      nodeId: selectedLocation.node.id,
      parentId: selectedLocation.parent.id,
      index: selectedLocation.index + 1
    })
  }

  const deleteSelected = (): void => {
    if (!document || !pendingDeleteId) return
    const location = locateNode(document.content.root, pendingDeleteId)
    if (!location?.parent) {
      setPendingDeleteId(null)
      return
    }
    if (session.apply({ type: 'remove-node', nodeId: pendingDeleteId })) {
      session.selectNode(location.parent.id)
    }
    setPendingDeleteId(null)
  }

  const leave = (): void => {
    if (session.dirty) {
      setConfirmLeave(true)
      return
    }
    navigate('/templates')
  }

  const toggleCollapsed = (nodeId: string): void => {
    const node = root ? locateNode(root, nodeId)?.node : null
    if (
      node?.type === 'frame' &&
      collapsedIds.has(nodeId) &&
      containsDescendant(node, session.selectedNodeId)
    ) {
      session.selectNode(nodeId)
      return
    }
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton icon={ArrowLeft} label="返回模板" onClick={leave} />
          <div>
            <h1>{document?.content.name || '未命名模板'}</h1>
            <span>
              {document
                ? `Revision ${document.revision}${session.dirty ? ' · 未保存' : ''}`
                : session.loading
                  ? '正在加载'
                  : '无法加载'}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <IconButton
            icon={Undo2}
            label="撤销"
            disabled={!session.canUndo || session.saving}
            onClick={session.undo}
          />
          <IconButton
            icon={Redo2}
            label="重做"
            disabled={!session.canRedo || session.saving}
            onClick={session.redo}
          />
          <Button
            icon={Save}
            variant="primary"
            disabled={!document || !session.dirty || session.saving}
            onClick={() => void session.save()}
          >
            {session.saving ? '正在保存' : '保存'}
          </Button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.properties} aria-labelledby="template-properties-heading">
          <section className={styles.inspectorSection}>
            <h2 id="template-properties-heading">模板</h2>
            {session.error ? (
              <div className={styles.notice} role="alert">
                {session.error}
              </div>
            ) : null}
            <label>
              名称
              <input
                disabled={!document}
                value={document?.content.name ?? ''}
                onChange={(event) => editMetadata('set-template-name', event.target.value)}
              />
            </label>
            <label>
              描述
              <textarea
                disabled={!document}
                value={document?.content.description ?? ''}
                onChange={(event) => editMetadata('set-template-description', event.target.value)}
              />
            </label>
          </section>

          <section className={styles.inspectorSection} aria-labelledby="selected-node-heading">
            <h2 id="selected-node-heading">节点</h2>
            {selectedNode ? (
              <>
                <dl className={styles.nodeDetails}>
                  <div>
                    <dt>类型</dt>
                    <dd>{selectedIsRoot ? '根框架' : nodeTypeLabel(selectedNode.type)}</dd>
                  </div>
                  <div>
                    <dt>ID</dt>
                    <dd>{selectedNode.id}</dd>
                  </div>
                  {selectedLocation?.parent ? (
                    <div>
                      <dt>父节点</dt>
                      <dd>{selectedLocation.parent.id}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className={styles.nodeActions}>
                  <IconButton
                    icon={ArrowUp}
                    label="上移节点"
                    size="small"
                    disabled={!canMoveUp}
                    onClick={() => moveSelected(-1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    label="下移节点"
                    size="small"
                    disabled={!canMoveDown}
                    onClick={() => moveSelected(1)}
                  />
                  <IconButton
                    icon={Copy}
                    label="复制节点"
                    size="small"
                    disabled={Boolean(selectedIsRoot)}
                    onClick={copySelected}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除节点"
                    size="small"
                    variant="danger"
                    disabled={Boolean(selectedIsRoot)}
                    onClick={() => setPendingDeleteId(selectedNode.id)}
                  />
                </div>
              </>
            ) : (
              <p className={styles.inspectorEmpty}>未选择节点</p>
            )}
          </section>
        </aside>

        <main className={styles.structure} aria-labelledby="template-structure-heading">
          <div className={styles.structureHeader}>
            <h2 id="template-structure-heading">结构</h2>
            <div className={styles.insertActions}>
              <Button
                icon={Layers3}
                size="small"
                disabled={!document}
                onClick={() => insertNode('frame')}
              >
                框架
              </Button>
              <Button
                icon={FileText}
                size="small"
                disabled={!document}
                onClick={() => insertNode('page')}
              >
                页面
              </Button>
              <Button
                icon={ListChecks}
                size="small"
                disabled={!document}
                onClick={() => insertNode('choice-question')}
              >
                选择题
              </Button>
            </div>
          </div>
          {root ? (
            <NodeTree
              node={root}
              rootId={root.id}
              selectedNodeId={session.selectedNodeId}
              collapsedIds={collapsedIds}
              onSelect={session.selectNode}
              onToggle={toggleCollapsed}
            />
          ) : (
            <EmptyState icon={Layers3} title={session.loading ? '正在加载模板' : '模板不可用'} />
          )}
        </main>
      </div>

      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate('/templates')}
      />
      <ConfirmModal
        confirmLabel="删除"
        danger
        message="该节点及其包含的全部子节点都会被删除。"
        open={pendingDeleteId !== null}
        title={`删除节点“${pendingDeleteId ?? ''}”？`}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={deleteSelected}
      />
    </div>
  )
}

interface NodeTreeProps {
  node: TemplateNode
  rootId: string
  selectedNodeId: string
  collapsedIds: ReadonlySet<string>
  onSelect(nodeId: string): void
  onToggle(nodeId: string): void
}

function NodeTree({
  node,
  rootId,
  selectedNodeId,
  collapsedIds,
  onSelect,
  onToggle
}: NodeTreeProps): JSX.Element {
  const collapsible = node.type === 'frame' && node.children.length > 0
  const collapsed = collapsedIds.has(node.id) && !containsDescendant(node, selectedNodeId)
  return (
    <ul className={styles.nodeList}>
      <li>
        <div className={styles.nodeRow} data-selected={node.id === selectedNodeId || undefined}>
          <button
            aria-label={`${collapsed ? '展开' : '折叠'}节点 ${node.id}`}
            className={styles.collapseButton}
            disabled={!collapsible}
            type="button"
            onClick={() => onToggle(node.id)}
          >
            {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          </button>
          <button
            aria-label={`选择节点 ${node.id}`}
            className={styles.nodeSelect}
            type="button"
            onClick={() => onSelect(node.id)}
          >
            <NodeIcon type={node.type} />
            <span className={styles.nodeIdentity}>
              <strong>{node.id}</strong>
              <small>{node.id === rootId ? '根框架' : nodeTypeLabel(node.type)}</small>
            </span>
          </button>
        </div>
        {node.type === 'frame' && !collapsed && node.children.length > 0 ? (
          <div className={styles.nodeChildren}>
            {node.children.map((child) => (
              <NodeTree
                key={child.id}
                node={child}
                rootId={rootId}
                selectedNodeId={selectedNodeId}
                collapsedIds={collapsedIds}
                onSelect={onSelect}
                onToggle={onToggle}
              />
            ))}
          </div>
        ) : null}
      </li>
    </ul>
  )
}

function containsDescendant(node: TemplateNode, nodeId: string): boolean {
  if (node.type !== 'frame') return false
  return node.children.some((child) => child.id === nodeId || containsDescendant(child, nodeId))
}

function NodeIcon({ type }: { type: TemplateNode['type'] }): JSX.Element {
  if (type === 'frame') return <Layers3 aria-hidden="true" />
  if (type === 'page') return <FileText aria-hidden="true" />
  if (type === 'choice-question') return <ListChecks aria-hidden="true" />
  return <Braces aria-hidden="true" />
}

function locateNode(root: FrameNode, nodeId: string): NodeLocation | null {
  if (root.id === nodeId) return { node: root, parent: null, index: 0 }
  for (const [index, child] of root.children.entries()) {
    if (child.id === nodeId) return { node: child, parent: root, index }
    if (child.type === 'frame') {
      const nested = locateNode(child, nodeId)
      if (nested) return nested
    }
  }
  return null
}

function insertionTarget(
  root: FrameNode,
  selection: NodeLocation | null
): { parentId: string; index?: number } {
  if (!selection) return { parentId: root.id }
  if (selection.node.type === 'frame') return { parentId: selection.node.id }
  if (!selection.parent) return { parentId: root.id }
  return { parentId: selection.parent.id, index: selection.index + 1 }
}

function createNode(type: InsertableNodeType): TemplateNode {
  if (type === 'frame') return { id: 'frame', type, children: [] }
  if (type === 'page') {
    return { id: 'page', type, content: { blocks: [] }, timeline: [] }
  }
  return {
    id: 'question',
    type,
    stem: text(''),
    options: [
      { id: 'option-a', content: text('') },
      { id: 'option-b', content: text('') }
    ],
    outputName: 'choice'
  }
}

function text(value: string): TextExpression {
  return { type: 'string', parts: [{ type: 'literal', value }] }
}

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'choice-question') return '选择题'
  return '函数'
}
