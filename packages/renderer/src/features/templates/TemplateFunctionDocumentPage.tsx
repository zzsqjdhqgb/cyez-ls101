import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  FrameNode,
  FunctionDef,
  FunctionDocumentOperation,
  FunctionLibrarySummary,
  FunctionLocator,
  FunctionLibraryEntry,
  TemplateDocumentOperation,
  TemplateNode
} from '@ls101/template-editor'
import {
  AlertCircle,
  ArrowLeft,
  Braces,
  FileText,
  Layers3,
  LayoutTemplate,
  Redo2,
  Save,
  Undo2
} from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { ResizableSplit } from '../../components/ui/ResizableSplit'
import { FunctionSignatureEditor } from './FunctionSignatureEditor'
import { useTemplateApplication } from './TemplateApplicationContext'
import { collectTemplateChoiceTargetPages } from './TemplateChoiceTargets'
import { TemplateContentBlockInspector } from './TemplateContentBlockInspector'
import { TemplateNodeTree } from './TemplateDocumentPage'
import { TemplateInspectorSection } from './TemplateInspectorSection'
import { TemplateNodeInspector } from './TemplateNodeInspector'
import { TemplatePageCanvas } from './TemplatePageCanvas'
import { TemplateSchemaUses } from './TemplateSchemaUses'
import {
  collectTemplateVariableCandidates,
  type TemplateVariableCandidate
} from './TemplateVariableInputModel'
import { templateErrorMessage } from './templateUi'
import { useFunctionEditorSession } from './useFunctionEditorSession'
import styles from './TemplateFunctionDocumentPage.module.css'

interface NodeLocation {
  node: TemplateNode
  parent: FrameNode | null
  index: number
}

interface FunctionEditorLocationState {
  templateId?: string
}

export function TemplateFunctionDocumentPage(): JSX.Element {
  const { libraryId = '', functionId = '' } = useParams()
  return (
    <TemplateFunctionDocumentEditor
      key={`${libraryId}:${functionId}`}
      functionId={functionId}
      libraryId={libraryId}
    />
  )
}

function TemplateFunctionDocumentEditor({
  libraryId,
  functionId
}: {
  libraryId: string
  functionId: string
}): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const location = useLocation()
  const session = useFunctionEditorSession(application, libraryId, functionId)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [centerView, setCenterView] = useState<'structure' | 'page'>('structure')
  const [selectedContentBlockId, setSelectedContentBlockId] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [functionLibraries, setFunctionLibraries] = useState<FunctionLibrarySummary[]>([])
  const [paletteError, setPaletteError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void application.browser
      .listFunctionLibraries()
      .then((libraries) => {
        if (!active) return
        setFunctionLibraries(libraries)
      })
      .catch((reason: unknown) => {
        if (active) setPaletteError(templateErrorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [application])

  const document = session.document
  const root = document?.content.body ?? null
  const selectedLocation = root ? locateNode(root, session.selectedNodeId) : null
  const selectedNode = selectedLocation?.node ?? null
  const selectedContentBlock =
    selectedNode?.type === 'page'
      ? (selectedNode.content.blocks.find((block) => block.id === selectedContentBlockId) ?? null)
      : null
  const visibleCenterView =
    centerView === 'page' && selectedNode?.type === 'page' ? 'page' : 'structure'
  const siblingEntries = useMemo(
    () =>
      session.library?.content.functions.filter((entry) => entry.functionId !== functionId) ?? [],
    [functionId, session.library]
  )
  const siblingDefinitions = useMemo(() => siblingEntries.map(functionDefinition), [siblingEntries])
  const variableCandidates = useMemo(
    () =>
      root && document
        ? collectFunctionVariableCandidates(root, siblingDefinitions, document.content.inputs)
        : [],
    [document, root, siblingDefinitions]
  )
  const choiceTargetPages = useMemo(
    () => (root ? collectTemplateChoiceTargetPages(root, siblingDefinitions) : []),
    [root, siblingDefinitions]
  )
  const backTarget = functionBackTarget(location.state)

  const applyDefinition = (operation: TemplateDocumentOperation): boolean =>
    session.apply(operation as FunctionDocumentOperation)

  const insertNode = (node: TemplateNode): void => {
    if (!root || session.saving) return
    const target = insertionTarget(root, selectedLocation)
    session.apply({
      type: 'insert-node',
      parentId: target.parentId,
      index: target.index,
      node: structuredClone(node)
    })
  }

  const insertFunction = (library: FunctionLibrarySummary, sourceFunctionId: string): void => {
    if (!root || session.saving) return
    const target = insertionTarget(root, selectedLocation)
    void session.insertFunctionCall(
      functionLocator(library, sourceFunctionId),
      target.parentId,
      target.index
    )
  }

  const leave = (): void => {
    if (session.dirty) {
      setConfirmLeave(true)
      return
    }
    navigate(backTarget)
  }

  const deleteSelected = (): void => {
    if (!root || !pendingDeleteId) return
    const found = locateNode(root, pendingDeleteId)
    if (!found?.parent) {
      setPendingDeleteId(null)
      return
    }
    if (session.apply({ type: 'remove-node', nodeId: pendingDeleteId })) {
      session.selectNode(found.parent.id)
    }
    setPendingDeleteId(null)
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

  const selectNode = (nodeId: string): void => {
    if (nodeId !== session.selectedNodeId) setSelectedContentBlockId(null)
    session.selectNode(nodeId)
  }

  const openPageEditor = (nodeId: string): void => {
    session.selectNode(nodeId)
    setSelectedContentBlockId(null)
    setCenterView('page')
  }

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton icon={ArrowLeft} label="返回模板编辑" onClick={leave} />
          <div>
            <h1>{document?.content.name || '未命名函数'}</h1>
            <span>
              {document && session.library
                ? `${session.library.content.name || '未命名函数库'} · Revision ${session.library.revision}${session.dirty ? ' · 未保存' : ''}`
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

      <ResizableSplit
        className={styles.workspace}
        initialSize={270}
        minFirst={220}
        minSecond={720}
        label="调整组件栏宽度"
      >
        <aside className={styles.palette} aria-labelledby="function-palette-heading">
          <div className={styles.paletteHeader}>
            <div>
              <h2 id="function-palette-heading">函数正文</h2>
              <span>添加到当前选择之后</span>
            </div>
            <Braces aria-hidden="true" />
          </div>
          {paletteError ? (
            <div className={styles.notice} role="alert">
              <AlertCircle aria-hidden="true" />
              <span>{paletteError}</span>
            </div>
          ) : null}
          {functionLibraries
            .filter((library) => library.functions.some((item) => item.component))
            .map((library) => (
              <section className={styles.paletteGroup} key={library.libraryId}>
                <h3>{library.name}</h3>
                <div className={styles.paletteList}>
                  {library.functions
                    .filter((item) => item.component)
                    .map((item) => (
                      <Button
                        aria-label={`添加${item.name || '未命名组件'}`}
                        className={styles.paletteButton}
                        icon={nodeIcon(item.component?.type)}
                        key={item.functionId}
                        disabled={!document || session.saving}
                        onClick={() => {
                          if (item.component) insertNode(item.component)
                        }}
                      >
                        {item.name || '未命名组件'}
                      </Button>
                    ))}
                </div>
              </section>
            ))}
          <section className={styles.paletteGroup}>
            <h3>可调用函数</h3>
            <div className={styles.callableLibraries}>
              {functionLibraries
                .map((library) => ({
                  library,
                  functions: library.functions.filter(
                    (item) =>
                      !item.component &&
                      (library.source !== 'local' ||
                        library.libraryId !== libraryId ||
                        item.functionId !== functionId)
                  )
                }))
                .filter(({ functions }) => functions.length > 0)
                .map(({ library, functions }) => (
                  <div className={styles.callableLibrary} key={functionLibraryKey(library)}>
                    <span>{library.name || '未命名函数库'}</span>
                    <div className={styles.paletteList}>
                      {functions.map((item) => (
                        <Button
                          aria-label={`调用${item.name || '未命名函数'}`}
                          className={styles.paletteButton}
                          icon={Braces}
                          key={item.functionId}
                          disabled={!document || session.saving}
                          onClick={() => insertFunction(library, item.functionId)}
                        >
                          {item.name || '未命名函数'}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            {functionLibraries.every((library) =>
              library.functions.every(
                (item) =>
                  item.component ||
                  (library.source === 'local' &&
                    library.libraryId === libraryId &&
                    item.functionId === functionId)
              )
            ) ? (
              <p className={styles.paletteEmpty}>没有其他可调用函数</p>
            ) : null}
          </section>
        </aside>

        <ResizableSplit
          className={styles.editorMain}
          initialSize={350}
          minFirst={420}
          minSecond={300}
          label="调整属性栏宽度"
          sizeFrom="second"
        >
          <main className={styles.center} aria-labelledby="function-center-heading">
            <div className={styles.centerHeader}>
              <h2 className={styles.visuallyHidden} id="function-center-heading">
                {visibleCenterView === 'structure' ? '结构' : '页面'}
              </h2>
              <div className={styles.centerTabs} role="tablist" aria-label="编辑视图">
                <button
                  aria-controls="function-structure-panel"
                  aria-selected={visibleCenterView === 'structure'}
                  className={styles.centerTab}
                  id="function-structure-tab"
                  role="tab"
                  type="button"
                  onClick={() => setCenterView('structure')}
                >
                  <Layers3 aria-hidden="true" />
                  <span>结构</span>
                </button>
                <button
                  aria-controls="function-page-panel"
                  aria-selected={visibleCenterView === 'page'}
                  className={styles.centerTab}
                  disabled={selectedNode?.type !== 'page'}
                  id="function-page-tab"
                  role="tab"
                  type="button"
                  onClick={() => setCenterView('page')}
                >
                  <LayoutTemplate aria-hidden="true" />
                  <span>页面</span>
                </button>
              </div>
            </div>
            {visibleCenterView === 'structure' ? (
              <div
                aria-labelledby="function-structure-tab"
                className={styles.structure}
                id="function-structure-panel"
                role="tabpanel"
              >
                {root ? (
                  <TemplateNodeTree
                    apply={applyDefinition}
                    collapsedIds={collapsedIds}
                    functions={siblingDefinitions}
                    index={0}
                    node={root}
                    parent={null}
                    rootId={root.id}
                    selectedNodeId={session.selectedNodeId}
                    variableCandidates={variableCandidates}
                    onDelete={setPendingDeleteId}
                    onEditPage={openPageEditor}
                    onSelect={selectNode}
                    onToggle={toggleCollapsed}
                  />
                ) : (
                  <EmptyState
                    icon={Layers3}
                    title={session.loading ? '正在加载函数' : '函数不可用'}
                  />
                )}
              </div>
            ) : selectedNode?.type === 'page' ? (
              <div
                aria-labelledby="function-page-tab"
                className={styles.pagePanel}
                id="function-page-panel"
                role="tabpanel"
              >
                <TemplatePageCanvas
                  apply={applyDefinition}
                  disabled={session.saving}
                  page={selectedNode}
                  selectedBlockId={selectedContentBlockId}
                  onSelectBlock={setSelectedContentBlockId}
                />
              </div>
            ) : null}
          </main>

          <aside className={styles.properties} aria-labelledby="function-properties-heading">
            {session.error ? (
              <div className={styles.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{session.error}</span>
              </div>
            ) : null}
            <TemplateInspectorSection title="函数" headingId="function-properties-heading">
              <label>
                函数名称
                <input
                  disabled={!document || session.saving}
                  value={document?.content.name ?? ''}
                  onChange={(event) =>
                    session.apply({ type: 'set-function-name', value: event.target.value })
                  }
                />
              </label>
              <FunctionSignatureEditor
                apply={session.apply}
                disabled={!document || session.saving}
                inputs={document?.content.inputs ?? []}
                outputs={document?.content.outputs ?? []}
                variableCandidates={variableCandidates}
              />
            </TemplateInspectorSection>
            <TemplateInspectorSection title="评分 Schema" defaultExpanded={false}>
              <TemplateSchemaUses
                apply={applyDefinition}
                disabled={!document || session.saving}
                uses={document?.content.schemaUses ?? []}
                variableCandidates={variableCandidates}
              />
            </TemplateInspectorSection>
            {selectedNode ? (
              <TemplateInspectorSection title="节点属性" headingId="function-node-heading">
                <TemplateNodeInspector
                  apply={applyDefinition}
                  functions={siblingDefinitions}
                  node={selectedNode}
                  variableCandidates={variableCandidates}
                />
              </TemplateInspectorSection>
            ) : null}
            {selectedNode?.type === 'page' && selectedContentBlock ? (
              <TemplateInspectorSection title="内容块" headingId="function-content-block-heading">
                <TemplateContentBlockInspector
                  apply={applyDefinition}
                  block={selectedContentBlock}
                  choiceTargetPages={choiceTargetPages}
                  pageId={selectedNode.id}
                  variableCandidates={variableCandidates}
                  onBlockIdChange={setSelectedContentBlockId}
                />
              </TemplateInspectorSection>
            ) : null}
          </aside>
        </ResizableSplit>
      </ResizableSplit>

      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的函数修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate(backTarget)}
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

function functionBackTarget(state: unknown): string {
  const templateId = (state as FunctionEditorLocationState | null)?.templateId
  return templateId ? `/templates/${templateId}` : '/templates'
}

function functionLocator(library: FunctionLibrarySummary, functionId: string): FunctionLocator {
  if (library.source === 'imported') {
    return {
      library: {
        source: 'imported',
        libraryId: library.libraryId,
        version: library.version ?? 1
      },
      functionId
    }
  }
  return { library: { source: library.source, libraryId: library.libraryId }, functionId }
}

function functionLibraryKey(library: FunctionLibrarySummary): string {
  return `${library.source}:${library.libraryId}:${library.version ?? 'working'}`
}

function functionDefinition(entry: FunctionLibraryEntry): FunctionDef {
  return { id: entry.functionId, ...entry.content }
}

function collectFunctionVariableCandidates(
  root: FrameNode,
  functions: readonly FunctionDef[],
  inputs: readonly { name: string; type: 'string' | 'number' | 'file' }[]
): TemplateVariableCandidate[] {
  const inputCandidates: TemplateVariableCandidate[] = inputs.map((input) => ({
    key: `local:${input.name}`,
    label: input.name,
    sourceLabel: '函数输入',
    type: input.type,
    ref: { scope: 'local', name: input.name }
  }))
  const bodyCandidates = collectTemplateVariableCandidates(root, functions, [], [])
  const used = new Set(inputCandidates.map((candidate) => candidate.key))
  return [...inputCandidates, ...bodyCandidates.filter((candidate) => !used.has(candidate.key))]
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

function containsDescendant(node: TemplateNode, nodeId: string): boolean {
  if (node.type !== 'frame') return false
  return node.children.some((child) => child.id === nodeId || containsDescendant(child, nodeId))
}

function nodeIcon(type: TemplateNode['type'] | undefined): typeof Layers3 {
  if (type === 'page') return FileText
  if (type === 'function') return Braces
  return Layers3
}
