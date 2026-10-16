import { useEffect, useRef, useState } from 'react'
import {
  editTemplateDocument,
  type DocumentEditError,
  type FunctionLocator,
  type TemplateApplication,
  type TemplateDocument,
  type TemplateDocumentOperation,
  type TemplateNode
} from '@ls101/template-editor'
import { templateErrorMessage } from './templateUi'

/** 每个历史快照同时保存文档与选中节点，撤销时恢复对应的编辑上下文。 */
interface HistoryEntry {
  id: number
  document: TemplateDocument
  selectedNodeId: string
}

/** cleanId 指向最近保存的快照；快照编号独立于持久化的 revision。 */
interface EditorHistory {
  past: HistoryEntry[]
  present: HistoryEntry | null
  future: HistoryEntry[]
  cleanId: number | null
  nextId: number
}

/** 提供模板文档、编辑状态以及撤销、保存等会话操作。 */
export interface TemplateEditorSession {
  document: TemplateDocument | null
  selectedNode: TemplateNode | null
  selectedNodeId: string
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string | null
  canUndo: boolean
  canRedo: boolean
  apply(operation: TemplateDocumentOperation): boolean
  selectNode(nodeId: string): void
  undo(): void
  redo(): void
  save(): Promise<boolean>
  insertFunctionCall(locator: FunctionLocator, parentId: string, index?: number): Promise<boolean>
  clearError(): void
}

export type TemplateEditorSource = 'local' | 'builtin'

const EMPTY_HISTORY: EditorHistory = {
  past: [],
  present: null,
  future: [],
  cleanId: null,
  nextId: 1
}

// 限制撤销栈长度，避免长时间编辑导致快照无限增长。
const HISTORY_LIMIT = 200

/** 管理模板编辑会话；内置模板以只读文档形式加载。 */
export function useTemplateEditorSession(
  application: TemplateApplication,
  templateId: string,
  source: TemplateEditorSource = 'local'
): TemplateEditorSession {
  const [history, setHistory] = useState<EditorHistory>(EMPTY_HISTORY)
  // 同步引用让连续操作立即读到最新历史，不必等待 React 重新渲染。
  const historyRef = useRef(history)
  const [selectedNodeId, setSelectedNodeId] = useState('root')
  const selectedNodeIdRef = useRef(selectedNodeId)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const replaceHistory = (value: EditorHistory): void => {
    historyRef.current = value
    setHistory(value)
  }

  const replaceSelection = (nodeId: string): void => {
    selectedNodeIdRef.current = nodeId
    setSelectedNodeId(nodeId)
  }

  useEffect(() => {
    mountedRef.current = true
    let active = true
    const loadDocument = async (): Promise<TemplateDocument | null> => {
      if (source === 'local') return application.templates.get(templateId)
      // 内置发布内容需深拷贝为编辑器文档，避免会话状态引用发布对象。
      const release = await application.builtinTemplates.get(templateId)
      return release
        ? {
            templateId: release.templateId,
            revision: 0,
            content: structuredClone(release.document.content),
            resources: structuredClone(release.document.resources),
            editorState: structuredClone(release.document.editorState)
          }
        : null
    }
    void loadDocument()
      .then((document) => {
        // 模板切换或组件卸载后，忽略本次加载的迟到结果。
        if (!active) return
        if (!document) {
          setError('模板不存在。')
          return
        }
        replaceHistory({
          past: [],
          present: { id: 0, document, selectedNodeId: document.content.root.id },
          future: [],
          cleanId: 0,
          nextId: 1
        })
        replaceSelection(document.content.root.id)
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      mountedRef.current = false
    }
  }, [application, source, templateId])

  // 编辑成功后创建新快照并清空重做栈；插入操作优先选中新节点。
  const apply = (operation: TemplateDocumentOperation): boolean => {
    if (source === 'builtin') return false
    const current = historyRef.current
    if (!current.present) return false
    const result = editTemplateDocument(current.present.document, operation)
    if (!result.applied) {
      setError(editErrorMessage(result.error))
      return false
    }
    const insertedNodeId = result.changes.find(
      (change) => change.kind === 'insert' && change.subjectId
    )?.subjectId
    const nextSelection = normalizeSelection(
      result.document,
      insertedNodeId ?? selectedNodeIdRef.current
    )
    const entry: HistoryEntry = {
      id: current.nextId,
      document: result.document,
      selectedNodeId: nextSelection
    }
    replaceHistory({
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: entry,
      future: [],
      cleanId: current.cleanId,
      nextId: current.nextId + 1
    })
    replaceSelection(nextSelection)
    setError(null)
    return true
  }

  // 仅更新当前快照的选区，单独选择节点不会新增撤销步骤。
  const selectNode = (nodeId: string): void => {
    const document = historyRef.current.present?.document
    if (!document || !findNode(document.content.root, nodeId)) return
    const current = historyRef.current
    if (current.present) {
      replaceHistory({
        ...current,
        present: { ...current.present, selectedNodeId: nodeId }
      })
    }
    replaceSelection(nodeId)
  }

  // 撤销和重做在 past、present、future 之间移动完整快照。
  const undo = (): void => {
    if (source === 'builtin') return
    const current = historyRef.current
    const previous = current.past.at(-1)
    if (!current.present || !previous) return
    replaceHistory({
      ...current,
      past: current.past.slice(0, -1),
      present: previous,
      future: [current.present, ...current.future]
    })
    replaceSelection(normalizeSelection(previous.document, previous.selectedNodeId))
    setError(null)
  }

  const redo = (): void => {
    if (source === 'builtin') return
    const current = historyRef.current
    const next = current.future[0]
    if (!current.present || !next) return
    replaceHistory({
      ...current,
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: next,
      future: current.future.slice(1)
    })
    replaceSelection(normalizeSelection(next.document, next.selectedNodeId))
    setError(null)
  }

  const save = async (): Promise<boolean> => {
    if (source === 'builtin') return false
    // 保存固定快照；请求期间继续产生的编辑仍应保留为未保存状态。
    const snapshot = historyRef.current.present
    if (!snapshot || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const saved = await application.templates.save(snapshot.document)
      if (!mountedRef.current) return false
      const current = historyRef.current
      replaceHistory({
        ...current,
        // 将各快照的 revision 更新为服务端返回值，只把本次保存的快照标为干净。
        past: current.past.map((entry) => rebaseEntry(entry, snapshot.id, saved)),
        present: current.present ? rebaseEntry(current.present, snapshot.id, saved) : null,
        future: current.future.map((entry) => rebaseEntry(entry, snapshot.id, saved)),
        cleanId: snapshot.id
      })
      return true
    } catch (reason) {
      if (mountedRef.current) setError(templateErrorMessage(reason))
      return false
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  // 函数调用由应用服务直接持久化，因此先保存本地修改，再接收新的文档快照。
  const insertFunctionCall = async (
    locator: FunctionLocator,
    parentId: string,
    index?: number
  ): Promise<boolean> => {
    if (source === 'builtin') return false
    let snapshot = historyRef.current.present
    if (!snapshot || savingRef.current) return false
    if (snapshot.id !== historyRef.current.cleanId) {
      if (!(await save())) return false
      snapshot = historyRef.current.present
      if (!snapshot || snapshot.id !== historyRef.current.cleanId) return false
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await application.templates.insertFunctionCall(
        templateId,
        locator,
        parentId,
        index
      )
      if (!mountedRef.current) return false
      const current = historyRef.current
      const id = current.nextId
      const selectedNodeId = normalizeSelection(result.template, result.callNodeId)
      replaceHistory({
        past: current.present
          ? [...current.past, current.present].slice(-HISTORY_LIMIT)
          : current.past,
        present: { id, document: result.template, selectedNodeId },
        future: [],
        cleanId: id,
        nextId: id + 1
      })
      replaceSelection(selectedNodeId)
      return true
    } catch (reason) {
      if (mountedRef.current) setError(templateErrorMessage(reason))
      return false
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const document = history.present?.document ?? null
  return {
    document,
    selectedNode: document ? findNode(document.content.root, selectedNodeId) : null,
    selectedNodeId,
    loading,
    saving,
    dirty: source === 'local' && history.present !== null && history.present.id !== history.cleanId,
    error,
    canUndo: source === 'local' && history.past.length > 0,
    canRedo: source === 'local' && history.future.length > 0,
    apply,
    selectNode,
    undo,
    redo,
    save,
    insertFunctionCall,
    clearError: () => setError(null)
  }
}

/** 同步保存后的修订号，保留其他历史快照各自的内容。 */
function rebaseEntry(
  entry: HistoryEntry,
  savedEntryId: number,
  saved: TemplateDocument
): HistoryEntry {
  return {
    ...entry,
    document: entry.id === savedEntryId ? saved : { ...entry.document, revision: saved.revision }
  }
}

/** 节点被删除或历史选区失效时回退到根节点。 */
function normalizeSelection(document: TemplateDocument, nodeId: string): string {
  return findNode(document.content.root, nodeId)?.id ?? document.content.root.id
}

/** 深度优先查找节点；只有 frame 节点可以继续向子节点递归。 */
export function findNode(root: TemplateNode, nodeId: string): TemplateNode | null {
  if (root.id === nodeId) return root
  if (root.type !== 'frame') return null
  for (const child of root.children) {
    const found = findNode(child, nodeId)
    if (found) return found
  }
  return null
}

function editErrorMessage(error: DocumentEditError): string {
  return `${error.code}: ${error.path}`
}
