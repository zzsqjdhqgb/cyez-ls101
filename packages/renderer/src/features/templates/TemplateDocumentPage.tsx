import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import type { InterfaceVarManifest } from '@ls101/core-types'
import type {
  FrameNode,
  FunctionDef,
  FunctionLibrarySummary,
  FunctionLocator,
  TemplateDocumentOperation,
  TemplateNode,
  TimelineStep
} from '@ls101/template-editor'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileArchive,
  FileText,
  LayoutTemplate,
  Layers3,
  ListChecks,
  Mic,
  Plus,
  Redo2,
  Save,
  Timer,
  Trash2,
  Undo2,
  Volume2
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { ResizableSplit } from '../../components/ui/ResizableSplit'
import { useTemplateApplication } from './TemplateApplicationContext'
import styles from './TemplateDocumentPage.module.css'
import { TemplateInspectorSection } from './TemplateInspectorSection'
import { TemplateFunctionCallEditor } from './TemplateFunctionCallEditor'
import { TemplateContentBlockInspector } from './TemplateContentBlockInspector'
import { collectTemplateChoiceTargetPages } from './TemplateChoiceTargets'
import { TemplateInterfaceRequirements } from './TemplateInterfaceRequirements'
import { TemplateExamGenerationDialog } from './TemplateExamGenerationDialog'
import { TemplateNodeInspector } from './TemplateNodeInspector'
import { TemplatePageCanvas } from './TemplatePageCanvas'
import {
  TemplatePreviewCanvas,
  TemplatePreviewFilmstrip,
  TemplatePreviewInspector
} from './TemplatePreview'
import { buildTemplatePreviewSnapshots, templatePreviewResourceUrls } from './TemplatePreviewModel'
import { TemplateVariableInput } from './TemplateVariableInput'
import { TemplateSchemaUses } from './TemplateSchemaUses'
import {
  collectTemplateVariableCandidates,
  type TemplateVariableCandidate
} from './TemplateVariableInputModel'
import { templateErrorMessage } from './templateUi'
import { useTemplateEditorSession } from './useTemplateEditorSession'
import { useTemplatePreview } from './useTemplatePreview'

interface NodeLocation {
  node: TemplateNode
  parent: FrameNode | null
  index: number
}

const LIBRARY_SOURCES: readonly {
  source: FunctionLibrarySummary['source']
  label: string
}[] = [
  { source: 'builtin', label: '内置' },
  { source: 'imported', label: '导入' },
  { source: 'local', label: '本地' }
]

export function TemplateDocumentPage(): JSX.Element {
  const { templateId = '' } = useParams()
  return <TemplateDocumentEditor key={templateId} templateId={templateId} />
}

function TemplateDocumentEditor({ templateId }: { templateId: string }): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const session = useTemplateEditorSession(application, templateId)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [generationOpen, setGenerationOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [centerView, setCenterView] = useState<'structure' | 'page' | 'preview'>('structure')
  const [previewTargetId, setPreviewTargetId] = useState('root')
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0)
  const [selectedContentBlockId, setSelectedContentBlockId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [functionLibraries, setFunctionLibraries] = useState<FunctionLibrarySummary[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [interfaceManifests, setInterfaceManifests] = useState<InterfaceVarManifest[]>([])
  const [interfacesLoading, setInterfacesLoading] = useState(true)
  const [interfacesError, setInterfacesError] = useState<string | null>(null)
  const [activeLibrarySource, setActiveLibrarySource] =
    useState<FunctionLibrarySummary['source']>('builtin')
  const [collapsedLibraryKeys, setCollapsedLibraryKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  useEffect(() => {
    let active = true
    void application.browser
      .listFunctionLibraries()
      .then((items) => {
        if (!active) return
        setFunctionLibraries(items)
        setLibraryError(null)
      })
      .catch((reason: unknown) => {
        if (active) setLibraryError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLibraryLoading(false)
      })
    return () => {
      active = false
    }
  }, [application])

  useEffect(() => {
    let active = true
    void application.browser
      .listInterfaces()
      .then((items) => {
        if (!active) return
        setInterfaceManifests(items)
        setInterfacesError(null)
      })
      .catch((reason: unknown) => {
        if (active) setInterfacesError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setInterfacesLoading(false)
      })
    return () => {
      active = false
    }
  }, [application])

  const document = session.document
  const root = document?.content.root ?? null
  const selectedLocation = root ? locateNode(root, session.selectedNodeId) : null
  const selectedNode = selectedLocation?.node ?? null
  const selectedContentBlock =
    selectedNode?.type === 'page'
      ? (selectedNode.content.blocks.find((block) => block.id === selectedContentBlockId) ?? null)
      : null
  const visibleCenterView =
    centerView === 'preview'
      ? 'preview'
      : centerView === 'page' && selectedNode?.type === 'page'
        ? 'page'
        : 'structure'
  const previewSession = useTemplatePreview(application, document, visibleCenterView === 'preview')
  const previewTarget = root ? (locateNode(root, previewTargetId)?.node ?? null) : null
  const previewData =
    previewSession.result?.success && !previewSession.missingInstances
      ? previewSession.result.preview
      : null
  const previewSnapshots = useMemo(
    () =>
      root && previewTarget && previewData
        ? buildTemplatePreviewSnapshots(root, previewTarget, previewData)
        : [],
    [previewData, previewTarget, root]
  )
  const previewResourceUrls = useMemo(
    () => templatePreviewResourceUrls(previewSession.result),
    [previewSession.result]
  )
  const safePreviewIndex = Math.min(selectedPreviewIndex, Math.max(0, previewSnapshots.length - 1))
  const selectedPreviewSnapshot = previewSnapshots[safePreviewIndex] ?? null
  const variableCandidates = useMemo(
    () =>
      root && document
        ? collectTemplateVariableCandidates(
            root,
            document.resources.functions,
            document.content.interfaces,
            interfaceManifests
          )
        : [],
    [document, interfaceManifests, root]
  )
  const choiceTargetPages = useMemo(
    () =>
      root && document ? collectTemplateChoiceTargetPages(root, document.resources.functions) : [],
    [document, root]
  )

  const editMetadata = (
    type: 'set-template-name' | 'set-template-description',
    value: string
  ): void => {
    session.apply({ type, value })
  }

  const insertLibraryItem = (
    library: FunctionLibrarySummary,
    item: FunctionLibrarySummary['functions'][number]
  ): void => {
    if (!root || !document || session.saving) return
    const target = insertionTarget(root, selectedLocation)
    if (item.component) {
      session.apply({
        type: 'insert-node',
        parentId: target.parentId,
        index: target.index,
        node: structuredClone(item.component)
      })
      return
    }
    void session.insertFunctionCall(
      functionLocator(library, item.functionId),
      target.parentId,
      target.index
    )
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

  const openGeneration = async (): Promise<void> => {
    if (!document || session.saving) return
    if (session.dirty && !(await session.save())) return
    setGenerationOpen(true)
  }

  const toggleCollapsed = (nodeId: string): void => {
    const node = root ? locateNode(root, nodeId)?.node : null
    if (node?.type === 'frame' && containsDescendant(node, session.selectedNodeId)) {
      setCollapsedIds((current) => new Set(current).add(nodeId))
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

  const toggleLibrary = (key: string): void => {
    setCollapsedLibraryKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const openPageEditor = (nodeId: string): void => {
    session.selectNode(nodeId)
    setSelectedContentBlockId(null)
    setCenterView('page')
  }

  const openPreview = (): void => {
    if (!selectedNode || selectedNode.type === 'choice-question') return
    setPreviewTargetId(selectedNode.id)
    setSelectedPreviewIndex(0)
    setCenterView('preview')
  }

  const selectTemplateNode = (nodeId: string): void => {
    if (nodeId !== session.selectedNodeId) setSelectedContentBlockId(null)
    session.selectNode(nodeId)
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
          <Button
            icon={FileArchive}
            disabled={!document || session.saving}
            onClick={() => void openGeneration()}
          >
            生成试卷
          </Button>
        </div>
      </header>

      <ResizableSplit
        className={styles.workspace}
        initialSize={300}
        minFirst={240}
        minSecond={708}
        label="调整函数库宽度"
      >
        {visibleCenterView === 'preview' ? (
          <TemplatePreviewFilmstrip
            compiling={previewSession.compiling}
            error={previewSession.error}
            missingInstances={previewSession.missingInstances}
            preview={previewData}
            result={previewSession.result}
            selectedIndex={safePreviewIndex}
            snapshots={previewSnapshots}
            onSelect={setSelectedPreviewIndex}
          />
        ) : (
          <aside className={styles.library} aria-labelledby="function-library-heading">
            <section className={`${styles.inspectorSection} ${styles.librarySection}`}>
              <div className={styles.libraryHeading}>
                <h2 id="function-library-heading">函数库</h2>
                <span>组件素材</span>
              </div>
              <div className={styles.sourceTabs} role="tablist" aria-label="函数库来源">
                {LIBRARY_SOURCES.map(({ source, label }) => (
                  <button
                    aria-controls={`${source}-library-panel`}
                    aria-label={`${label}函数库`}
                    aria-selected={activeLibrarySource === source}
                    className={styles.sourceTab}
                    id={`${source}-library-tab`}
                    key={source}
                    role="tab"
                    type="button"
                    onClick={() => setActiveLibrarySource(source)}
                  >
                    <span>{label}</span>
                    <small aria-hidden="true">
                      {functionLibraries.filter((item) => item.source === source).length}
                    </small>
                  </button>
                ))}
              </div>
              <div className={styles.libraryGroups}>
                {libraryError ? (
                  <div className={styles.libraryNotice} role="alert">
                    <AlertCircle aria-hidden="true" />
                    <span>{libraryError}</span>
                  </div>
                ) : null}
                {libraryLoading ? (
                  <span className={styles.libraryStatus}>正在加载函数库...</span>
                ) : null}
                {!libraryLoading ? (
                  <section
                    aria-labelledby={`${activeLibrarySource}-library-tab`}
                    className={styles.libraryPanel}
                    id={`${activeLibrarySource}-library-panel`}
                    role="tabpanel"
                  >
                    {functionLibraries.filter((item) => item.source === activeLibrarySource)
                      .length === 0 ? (
                      <LibraryEmptyState source={activeLibrarySource} />
                    ) : (
                      <ul className={styles.libraryList}>
                        {functionLibraries
                          .filter((item) => item.source === activeLibrarySource)
                          .map((library) => {
                            const key = libraryKey(library)
                            const collapsed = collapsedLibraryKeys.has(key)
                            return (
                              <li className={styles.libraryGroup} key={key}>
                                <button
                                  type="button"
                                  className={styles.libraryButton}
                                  aria-expanded={!collapsed}
                                  aria-label={libraryButtonLabel(library)}
                                  onClick={() => toggleLibrary(key)}
                                >
                                  {collapsed ? (
                                    <ChevronRight aria-hidden="true" />
                                  ) : (
                                    <ChevronDown aria-hidden="true" />
                                  )}
                                  <span>{library.name || '未命名函数库'}</span>
                                  <small>
                                    {library.functions.length} 项
                                    {library.version ? ` · v${library.version}` : ''}
                                  </small>
                                </button>
                                {!collapsed ? (
                                  library.functions.length > 0 ? (
                                    <ul className={styles.functionList}>
                                      {library.functions.map((item) => (
                                        <li key={item.functionId}>
                                          <div
                                            className={styles.functionCard}
                                            title={item.name || '未命名函数'}
                                          >
                                            <span className={styles.functionIcon}>
                                              <NodeIcon type={item.component?.type ?? 'function'} />
                                            </span>
                                            <span className={styles.functionIdentity}>
                                              <strong>{item.name || '未命名函数'}</strong>
                                              <small>
                                                {item.component
                                                  ? nodeTypeLabel(item.component.type)
                                                  : '函数'}
                                              </small>
                                            </span>
                                            <IconButton
                                              icon={Plus}
                                              label={`添加${item.name || '未命名函数'}`}
                                              size="small"
                                              disabled={!document || session.saving}
                                              onClick={() => insertLibraryItem(library, item)}
                                            />
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className={styles.emptyLibrary}>暂无函数</span>
                                  )
                                ) : null}
                              </li>
                            )
                          })}
                      </ul>
                    )}
                  </section>
                ) : null}
              </div>
            </section>
          </aside>
        )}

        <ResizableSplit
          className={styles.editorMain}
          initialSize={340}
          minFirst={420}
          minSecond={280}
          label="调整属性栏宽度"
          sizeFrom="second"
        >
          <main className={styles.center} aria-labelledby="template-center-heading">
            <div className={styles.centerHeader}>
              <h2 className={styles.visuallyHidden} id="template-center-heading">
                {visibleCenterView === 'structure'
                  ? '结构'
                  : visibleCenterView === 'page'
                    ? '页面'
                    : '预览'}
              </h2>
              <div className={styles.centerTabs} role="tablist" aria-label="编辑视图">
                <button
                  aria-controls="template-structure-panel"
                  aria-selected={visibleCenterView === 'structure'}
                  className={styles.centerTab}
                  id="template-structure-tab"
                  role="tab"
                  type="button"
                  onClick={() => setCenterView('structure')}
                >
                  <Layers3 aria-hidden="true" />
                  <span>结构</span>
                </button>
                <button
                  aria-controls="template-page-panel"
                  aria-selected={visibleCenterView === 'page'}
                  className={styles.centerTab}
                  disabled={selectedNode?.type !== 'page'}
                  id="template-page-tab"
                  role="tab"
                  type="button"
                  onClick={() => setCenterView('page')}
                >
                  <LayoutTemplate aria-hidden="true" />
                  <span>页面</span>
                </button>
                <button
                  aria-controls="template-preview-panel"
                  aria-selected={visibleCenterView === 'preview'}
                  className={styles.centerTab}
                  disabled={!selectedNode || selectedNode.type === 'choice-question'}
                  id="template-preview-tab"
                  role="tab"
                  type="button"
                  onClick={openPreview}
                >
                  <Eye aria-hidden="true" />
                  <span>预览</span>
                </button>
              </div>
            </div>
            {visibleCenterView === 'structure' ? (
              <div
                aria-labelledby="template-structure-tab"
                className={styles.structure}
                id="template-structure-panel"
                role="tabpanel"
              >
                {root ? (
                  <NodeTree
                    node={root}
                    parent={null}
                    index={0}
                    rootId={root.id}
                    selectedNodeId={session.selectedNodeId}
                    collapsedIds={collapsedIds}
                    functions={document?.resources.functions ?? []}
                    variableCandidates={variableCandidates}
                    apply={session.apply}
                    onSelect={selectTemplateNode}
                    onToggle={toggleCollapsed}
                    onDelete={setPendingDeleteId}
                    onEditPage={openPageEditor}
                  />
                ) : (
                  <EmptyState
                    icon={Layers3}
                    title={session.loading ? '正在加载模板' : '模板不可用'}
                  />
                )}
              </div>
            ) : visibleCenterView === 'page' && selectedNode?.type === 'page' ? (
              <div
                aria-labelledby="template-page-tab"
                className={styles.pagePanel}
                id="template-page-panel"
                role="tabpanel"
              >
                <TemplatePageCanvas
                  apply={session.apply}
                  disabled={session.saving}
                  page={selectedNode}
                  selectedBlockId={selectedContentBlockId}
                  onSelectBlock={setSelectedContentBlockId}
                />
              </div>
            ) : visibleCenterView === 'preview' ? (
              <div
                aria-labelledby="template-preview-tab"
                className={styles.pagePanel}
                id="template-preview-panel"
                role="tabpanel"
              >
                <TemplatePreviewCanvas
                  position={safePreviewIndex}
                  preview={previewData}
                  resourceUrls={previewResourceUrls}
                  snapshot={selectedPreviewSnapshot}
                  total={previewSnapshots.length}
                />
              </div>
            ) : null}
          </main>

          {visibleCenterView === 'preview' ? (
            <TemplatePreviewInspector
              document={document}
              session={previewSession}
              snapshot={selectedPreviewSnapshot}
              snapshotCount={previewSnapshots.length}
              target={previewTarget}
            />
          ) : (
            <aside className={styles.properties} aria-label="属性">
              <TemplateInspectorSection title="全局属性" headingId="template-properties-heading">
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
                    onChange={(event) =>
                      editMetadata('set-template-description', event.target.value)
                    }
                  />
                </label>
                <TemplateInterfaceRequirements
                  disabled={!document || session.saving}
                  error={interfacesError}
                  loading={interfacesLoading}
                  manifests={interfaceManifests}
                  requirements={document?.content.interfaces ?? []}
                  apply={session.apply}
                />
              </TemplateInspectorSection>
              <TemplateInspectorSection title="评分 Schema" defaultExpanded={false}>
                <TemplateSchemaUses
                  apply={session.apply}
                  disabled={!document || session.saving}
                  uses={document?.content.schemaUses ?? []}
                  variableCandidates={variableCandidates}
                />
              </TemplateInspectorSection>
              {selectedNode ? (
                <TemplateInspectorSection title="节点属性" headingId="node-properties-heading">
                  <TemplateNodeInspector
                    node={selectedNode}
                    functions={document?.resources.functions ?? []}
                    variableCandidates={variableCandidates}
                    apply={session.apply}
                  />
                </TemplateInspectorSection>
              ) : null}
              {selectedNode?.type === 'page' && selectedContentBlock ? (
                <TemplateInspectorSection
                  title="内容块"
                  headingId="content-block-properties-heading"
                >
                  <TemplateContentBlockInspector
                    apply={session.apply}
                    block={selectedContentBlock}
                    choiceTargetPages={choiceTargetPages}
                    pageId={selectedNode.id}
                    variableCandidates={variableCandidates}
                    onBlockIdChange={setSelectedContentBlockId}
                  />
                </TemplateInspectorSection>
              ) : null}
            </aside>
          )}
        </ResizableSplit>
      </ResizableSplit>

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
      {document ? (
        <TemplateExamGenerationDialog
          application={application}
          document={document}
          open={generationOpen}
          onOpenChange={setGenerationOpen}
        />
      ) : null}
    </div>
  )
}

function functionLocator(library: FunctionLibrarySummary, functionId: string): FunctionLocator {
  if (library.source === 'imported') {
    return {
      library: { source: 'imported', libraryId: library.libraryId, version: library.version ?? 1 },
      functionId
    }
  }
  return { library: { source: library.source, libraryId: library.libraryId }, functionId }
}

function libraryKey(library: FunctionLibrarySummary): string {
  return `${library.source}:${library.libraryId}:${library.version ?? 'working'}`
}

function libraryButtonLabel(library: FunctionLibrarySummary): string {
  const name = library.name || '未命名函数库'
  return library.version ? `${name}，版本 ${library.version}` : name
}

function LibraryEmptyState({ source }: { source: FunctionLibrarySummary['source'] }): JSX.Element {
  const label = LIBRARY_SOURCES.find((item) => item.source === source)?.label ?? ''
  const description =
    source === 'builtin'
      ? '当前没有可用的内置组件'
      : source === 'imported'
        ? '导入函数库后会显示在这里'
        : '创建本地函数库后会显示在这里'

  return (
    <div className={styles.libraryEmptyState}>
      <span className={styles.libraryEmptyIcon}>
        <Braces aria-hidden="true" />
      </span>
      <strong>暂无{label}函数库</strong>
      <span>{description}</span>
    </div>
  )
}

interface NodeTreeProps {
  node: TemplateNode
  parent: FrameNode | null
  index: number
  rootId: string
  selectedNodeId: string
  collapsedIds: ReadonlySet<string>
  functions: readonly FunctionDef[]
  variableCandidates: readonly TemplateVariableCandidate[]
  apply(operation: TemplateDocumentOperation): boolean
  onSelect(nodeId: string): void
  onToggle(nodeId: string): void
  onDelete(nodeId: string): void
  onEditPage(nodeId: string): void
}

function NodeTree({
  node,
  parent,
  index,
  rootId,
  selectedNodeId,
  collapsedIds,
  functions,
  variableCandidates,
  apply,
  onSelect,
  onToggle,
  onDelete,
  onEditPage
}: NodeTreeProps): JSX.Element {
  const collapsible =
    (node.type === 'frame' && node.children.length > 0) || hasInlineNodeProperties(node)
  const collapsed = collapsedIds.has(node.id) && !containsDescendant(node, selectedNodeId)
  const selected = node.id === selectedNodeId
  const canMoveUp = Boolean(parent && index > 0)
  const canMoveDown = Boolean(parent && index < parent.children.length - 1)
  return (
    <ul className={styles.nodeList}>
      <li>
        <div className={styles.nodeCard} data-selected={selected || undefined}>
          <div className={styles.nodeRow}>
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
                <strong>{node.name?.trim() || nodeTypeLabel(node.type)}</strong>
                <small>
                  {node.id}
                  {node.id === rootId ? ' · 根节点' : ''}
                </small>
              </span>
            </button>
            {selected && parent ? (
              <div className={styles.nodeCardActions}>
                <IconButton
                  icon={ArrowUp}
                  label="上移节点"
                  size="small"
                  disabled={!canMoveUp}
                  onClick={() =>
                    apply({
                      type: 'move-node',
                      nodeId: node.id,
                      parentId: parent.id,
                      index: index - 1
                    })
                  }
                />
                <IconButton
                  icon={ArrowDown}
                  label="下移节点"
                  size="small"
                  disabled={!canMoveDown}
                  onClick={() =>
                    apply({
                      type: 'move-node',
                      nodeId: node.id,
                      parentId: parent.id,
                      index: index + 1
                    })
                  }
                />
                <IconButton
                  icon={Copy}
                  label="复制节点"
                  size="small"
                  onClick={() =>
                    apply({
                      type: 'copy-node',
                      nodeId: node.id,
                      parentId: parent.id,
                      index: index + 1
                    })
                  }
                />
                <IconButton
                  icon={Trash2}
                  label="删除节点"
                  size="small"
                  variant="danger"
                  onClick={() => onDelete(node.id)}
                />
              </div>
            ) : null}
          </div>
          {node.type === 'page' && !collapsed ? (
            <PageNodeSummary
              node={node}
              variableCandidates={variableCandidates}
              apply={apply}
              onEdit={() => onEditPage(node.id)}
            />
          ) : null}
          {node.type === 'function' && !collapsed ? (
            <div className={`${styles.nodeSummary} ${styles.functionNodeSummary}`}>
              <TemplateFunctionCallEditor
                compact
                node={node}
                definition={functions.find((definition) => definition.id === node.functionRef)}
                variableCandidates={variableCandidates}
                apply={apply}
              />
            </div>
          ) : null}
        </div>
        {node.type === 'frame' && !collapsed && node.children.length > 0 ? (
          <div className={styles.nodeChildren}>
            {node.children.map((child, childIndex) => (
              <NodeTree
                key={child.id}
                node={child}
                parent={node}
                index={childIndex}
                rootId={rootId}
                selectedNodeId={selectedNodeId}
                collapsedIds={collapsedIds}
                functions={functions}
                variableCandidates={variableCandidates}
                apply={apply}
                onSelect={onSelect}
                onToggle={onToggle}
                onDelete={onDelete}
                onEditPage={onEditPage}
              />
            ))}
          </div>
        ) : null}
      </li>
    </ul>
  )
}

function hasInlineNodeProperties(node: TemplateNode): boolean {
  return node.type === 'page' || node.type === 'function'
}

function PageNodeSummary({
  node,
  variableCandidates,
  apply,
  onEdit
}: {
  node: Extract<TemplateNode, { type: 'page' }>
  variableCandidates: readonly TemplateVariableCandidate[]
  apply: NodeTreeProps['apply']
  onEdit(): void
}): JSX.Element {
  const addMenuId = useId()
  const [adding, setAdding] = useState(false)

  const addStep = (type: TimelineStep['type']): void => {
    const step = createTimelineStep(type)
    if (apply({ type: 'insert-timeline-step', pageId: node.id, step })) setAdding(false)
  }

  return (
    <div className={styles.nodeSummary}>
      <div className={styles.nodeSummaryHeading}>
        <span>时间线</span>
        <div className={styles.nodeSummaryActions}>
          <small>{node.timeline.length} 项</small>
          <Button
            aria-label={`编辑节点 ${node.id} 页面内容`}
            className={styles.nodeContentEdit}
            icon={LayoutTemplate}
            size="small"
            variant="ghost"
            onClick={onEdit}
          >
            编辑内容
          </Button>
          <IconButton
            aria-controls={addMenuId}
            aria-expanded={adding}
            className={styles.nodeSummaryAdd}
            icon={Plus}
            label={`添加节点 ${node.id} 时间线项目`}
            size="small"
            variant="ghost"
            onClick={() => setAdding((current) => !current)}
          />
        </div>
      </div>
      {node.timeline.length > 0 || adding ? (
        <ol className={styles.timelineSummary} aria-label={`节点 ${node.id} 时间线`}>
          {node.timeline.map((step, index) => (
            <li className={styles.timelineSummaryItem} key={index}>
              <span
                aria-label={timelineStepLabel(step.type)}
                className={styles.timelineTypeIcon}
                title={timelineStepLabel(step.type)}
              >
                <TimelineStepIcon type={step.type} />
              </span>
              <TimelineStepFields
                index={index}
                nodeId={node.id}
                step={step}
                variableCandidates={variableCandidates}
                onChange={(nextStep) =>
                  apply({
                    type: 'update-timeline-step',
                    pageId: node.id,
                    index,
                    step: nextStep
                  })
                }
              />
              <IconButton
                className={styles.timelineRemove}
                icon={Trash2}
                label={`删除节点 ${node.id} 时间线项目 ${index + 1}`}
                size="small"
                variant="danger"
                onClick={() => apply({ type: 'remove-timeline-step', pageId: node.id, index })}
              />
            </li>
          ))}
          {adding ? (
            <li
              aria-label={`节点 ${node.id} 新增时间线项目`}
              className={styles.timelineAddRow}
              id={addMenuId}
            >
              <TimelineAddButton icon={Volume2} label="TTS 播放" onClick={() => addStep('play')} />
              <TimelineAddButton icon={Timer} label="倒计时" onClick={() => addStep('countdown')} />
              <TimelineAddButton icon={Mic} label="录音" onClick={() => addStep('record')} />
            </li>
          ) : null}
        </ol>
      ) : (
        <span className={styles.nodeSummaryEmpty}>暂无时间线</span>
      )}
    </div>
  )
}

function TimelineAddButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof Volume2
  label: string
  onClick(): void
}): JSX.Element {
  return (
    <IconButton
      className={styles.timelineAddOption}
      icon={Icon}
      label={`添加 ${label}`}
      size="small"
      variant="ghost"
      onClick={onClick}
    />
  )
}

function TimelineStepFields({
  nodeId,
  index,
  step,
  variableCandidates,
  onChange
}: {
  nodeId: string
  index: number
  step: TimelineStep
  variableCandidates: readonly TemplateVariableCandidate[]
  onChange(step: TimelineStep): void
}): JSX.Element {
  const fieldPrefix = `节点 ${nodeId} 时间线项目 ${index + 1}`

  if (step.type === 'play') {
    return (
      <div className={styles.timelineStepFields}>
        <TemplateVariableInput
          mode="text"
          ariaLabel={`${fieldPrefix} TTS 文本`}
          candidates={variableCandidates}
          placeholder="TTS 文本"
          value={step.text}
          onChange={(text) => onChange({ ...step, text })}
        />
      </div>
    )
  }

  if (step.type === 'countdown') {
    return (
      <div className={styles.timelineStepFields}>
        <TemplateVariableInput
          mode="value"
          ariaLabel={`${fieldPrefix} 倒计时时长`}
          candidates={variableCandidates}
          inputMode="decimal"
          min={0}
          placeholder="秒"
          value={step.seconds}
          valueType="number"
          onChange={(seconds) => onChange({ ...step, seconds })}
        />
      </div>
    )
  }

  return (
    <div className={styles.timelineStepFields} data-field-count="2">
      <TemplateVariableInput
        mode="value"
        ariaLabel={`${fieldPrefix} 录音时长`}
        candidates={variableCandidates}
        inputMode="decimal"
        min={0}
        placeholder="时长"
        value={step.duration}
        valueType="number"
        onChange={(duration) => onChange({ ...step, duration })}
      />
      <input
        aria-label={`${fieldPrefix} 录音输出名称`}
        placeholder="输出名称"
        value={step.outputName}
        onChange={(event) => onChange({ ...step, outputName: event.target.value })}
      />
    </div>
  )
}

function TimelineStepIcon({ type }: { type: TimelineStep['type'] }): JSX.Element {
  if (type === 'play') return <Volume2 aria-hidden="true" />
  if (type === 'countdown') return <Timer aria-hidden="true" />
  return <Mic aria-hidden="true" />
}

function timelineStepLabel(type: TimelineStep['type']): string {
  if (type === 'play') return 'TTS 播放'
  if (type === 'countdown') return '倒计时'
  return '录音'
}

function createTimelineStep(type: TimelineStep['type']): TimelineStep {
  if (type === 'play') {
    return { type: 'play', text: { type: 'string', parts: [{ type: 'literal', value: '' }] } }
  }
  if (type === 'countdown') {
    return { type: 'countdown', seconds: { type: 'number', source: 'literal', value: 1 } }
  }
  return {
    type: 'record',
    duration: { type: 'number', source: 'literal', value: 1 },
    outputName: 'recording'
  }
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

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'choice-question') return '选择题'
  return '函数'
}
