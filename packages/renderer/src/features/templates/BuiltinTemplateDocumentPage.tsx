import { useEffect, useMemo, useState, type JSX } from 'react'
import type { BuiltinTemplateRelease, TemplateDocument, TemplateNode } from '@ls101/template-editor'
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Layers3,
  LayoutTemplate,
  ListChecks,
  Variable
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { toast } from '../../components/ui/toast'
import { useTemplateApplication } from './TemplateApplicationContext'
import { TemplatePageCanvas } from './TemplatePageCanvas'
import { templateErrorMessage } from './templateUi'
import { findNode } from './useTemplateEditorSession'
import styles from './BuiltinTemplateDocumentPage.module.css'

type DetailView = 'structure' | 'page'

export function BuiltinTemplateDocumentPage(): JSX.Element {
  const { templateId = '' } = useParams()
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const [release, setRelease] = useState<BuiltinTemplateRelease | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())
  const [view, setView] = useState<DetailView>('structure')

  useEffect(() => {
    let active = true
    void application.builtinTemplates
      .get(templateId)
      .then((nextRelease) => {
        if (!active) return
        setRelease(nextRelease)
        setSelectedNodeId(nextRelease?.document.content.root.id ?? '')
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application, templateId])

  const document = useMemo<TemplateDocument | null>(
    () =>
      release
        ? {
            templateId: release.templateId,
            revision: 0,
            content: structuredClone(release.document.content),
            resources: structuredClone(release.document.resources),
            editorState: structuredClone(release.document.editorState)
          }
        : null,
    [release]
  )
  const selectedNode = document ? findNode(document.content.root, selectedNodeId) : null
  const visibleView = view === 'page' && selectedNode?.type === 'page' ? 'page' : 'structure'

  const createCopy = async (): Promise<void> => {
    if (copying) return
    setCopying(true)
    setError(null)
    try {
      const copy = await application.builtinTemplates.createCopy(templateId)
      toast.success(`已创建模板副本“${copy.content.name || '未命名模板'}”`)
      navigate(`/templates/${copy.templateId}`)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setCopying(false)
    }
  }

  const selectNode = (nodeId: string): void => {
    setSelectedNodeId(nodeId)
    setSelectedBlockId(null)
  }

  const toggleNode = (nodeId: string): void => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  if (loading) {
    return (
      <div className={styles.state}>
        <span>正在加载内置模板...</span>
      </div>
    )
  }

  if (!document || !release) {
    return (
      <div className={styles.state}>
        <EmptyState icon={LayoutTemplate} title={error || '内置模板不存在'} />
        <Button icon={ArrowLeft} onClick={() => navigate('/templates')}>
          返回模板列表
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.viewer}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton
            icon={ArrowLeft}
            label="返回模板列表"
            onClick={() => navigate('/templates')}
          />
          <div>
            <h1>{document.content.name || '未命名模板'}</h1>
            <span>内置模板 · v{release.version} · 只读</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button icon={Copy} disabled={copying} onClick={() => void createCopy()}>
            {copying ? '正在创建' : '创建副本'}
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate(`/templates/builtin/${templateId}/generate`)}
          >
            生成试卷
          </Button>
        </div>
      </header>

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={styles.workspace}>
        <main className={styles.center} aria-labelledby="builtin-template-view-heading">
          <div className={styles.centerHeader}>
            <h2 className={styles.visuallyHidden} id="builtin-template-view-heading">
              {visibleView === 'structure' ? '结构' : '页面'}
            </h2>
            <div className={styles.centerTabs} role="tablist" aria-label="查看视图">
              <button
                aria-selected={visibleView === 'structure'}
                className={styles.centerTab}
                role="tab"
                type="button"
                onClick={() => setView('structure')}
              >
                <Layers3 aria-hidden="true" />
                <span>结构</span>
              </button>
              <button
                aria-selected={visibleView === 'page'}
                className={styles.centerTab}
                disabled={selectedNode?.type !== 'page'}
                role="tab"
                type="button"
                onClick={() => setView('page')}
              >
                <LayoutTemplate aria-hidden="true" />
                <span>页面</span>
              </button>
            </div>
          </div>

          {visibleView === 'structure' ? (
            <div className={styles.structure} role="tabpanel">
              <ReadonlyNodeTree
                node={document.content.root}
                rootId={document.content.root.id}
                selectedNodeId={selectedNodeId}
                collapsedIds={collapsedIds}
                onSelect={selectNode}
                onToggle={toggleNode}
              />
            </div>
          ) : selectedNode?.type === 'page' ? (
            <div className={styles.pagePanel} role="tabpanel">
              <TemplatePageCanvas
                disabled
                page={selectedNode}
                selectedBlockId={selectedBlockId}
                apply={() => false}
                onSelectBlock={setSelectedBlockId}
              />
            </div>
          ) : null}
        </main>

        <aside className={styles.inspector} aria-label="模板详情">
          <section>
            <h2>模板信息</h2>
            <dl>
              <Detail label="名称" value={document.content.name || '未命名模板'} />
              <Detail label="描述" value={document.content.description || '暂无描述'} />
              <Detail label="版本" value={`v${release.version}`} />
              <Detail label="Template ID" value={release.templateId} code />
              <Detail label="内嵌函数" value={String(document.resources.functions.length)} />
            </dl>
          </section>
          <section>
            <h2>节点详情</h2>
            {selectedNode ? (
              <dl>
                <Detail
                  label="名称"
                  value={selectedNode.name?.trim() || nodeTypeLabel(selectedNode.type)}
                />
                <Detail label="类型" value={nodeTypeLabel(selectedNode.type)} />
                <Detail label="节点 ID" value={selectedNode.id} code />
                {nodeDetails(selectedNode).map(([label, value]) => (
                  <Detail key={label} label={label} value={value} code={label === '函数引用'} />
                ))}
              </dl>
            ) : (
              <p>未选择节点</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function ReadonlyNodeTree({
  node,
  rootId,
  selectedNodeId,
  collapsedIds,
  onSelect,
  onToggle
}: {
  node: TemplateNode
  rootId: string
  selectedNodeId: string
  collapsedIds: ReadonlySet<string>
  onSelect(nodeId: string): void
  onToggle(nodeId: string): void
}): JSX.Element {
  const hasChildren = node.type === 'frame' && node.children.length > 0
  const collapsed = collapsedIds.has(node.id)
  return (
    <ul className={styles.nodeList}>
      <li>
        <div className={styles.nodeRow} data-selected={node.id === selectedNodeId || undefined}>
          <button
            aria-label={`${collapsed ? '展开' : '折叠'}节点 ${node.id}`}
            className={styles.collapseButton}
            disabled={!hasChildren}
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
            <span>
              <strong>{node.name?.trim() || nodeTypeLabel(node.type)}</strong>
              <small>
                {node.id}
                {node.id === rootId ? ' · 根节点' : ''}
              </small>
            </span>
          </button>
        </div>
        {node.type === 'frame' && !collapsed && node.children.length > 0 ? (
          <div className={styles.nodeChildren}>
            {node.children.map((child) => (
              <ReadonlyNodeTree
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

function Detail({
  label,
  value,
  code = false
}: {
  label: string
  value: string
  code?: boolean
}): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={code ? styles.code : undefined}>{value}</dd>
    </div>
  )
}

function nodeDetails(node: TemplateNode): [string, string][] {
  if (node.type === 'frame') return [['子节点', String(node.children.length)]]
  if (node.type === 'page') {
    return [
      ['内容块', String(node.content.blocks.length)],
      ['时间线', String(node.timeline.length)]
    ]
  }
  if (node.type === 'function') {
    return [
      ['函数引用', node.functionRef],
      ['输入', String(Object.keys(node.inputs).length)],
      ['输出', String(Object.keys(node.outputNames).length)]
    ]
  }
  if (node.type === 'choice-question') {
    return [
      ['选项', String(node.options.length)],
      ['输出变量', node.outputName]
    ]
  }
  return [['变量名', node.variableName]]
}

function NodeIcon({ type }: { type: TemplateNode['type'] }): JSX.Element {
  if (type === 'frame') return <Layers3 aria-hidden="true" />
  if (type === 'page') return <FileText aria-hidden="true" />
  if (type === 'choice-question') return <ListChecks aria-hidden="true" />
  if (type === 'variable') return <Variable aria-hidden="true" />
  return <Braces aria-hidden="true" />
}

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'choice-question') return '选择题'
  if (type === 'variable') return '变量'
  return '函数'
}
