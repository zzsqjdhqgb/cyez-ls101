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

interface HistoryEntry {
  id: number
  document: TemplateDocument
  selectedNodeId: string
}

interface EditorHistory {
  past: HistoryEntry[]
  present: HistoryEntry | null
  future: HistoryEntry[]
  cleanId: number | null
  nextId: number
}

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

const HISTORY_LIMIT = 200

export function useTemplateEditorSession(
  application: TemplateApplication,
  templateId: string,
  source: TemplateEditorSource = 'local'
): TemplateEditorSession {
  const [history, setHistory] = useState<EditorHistory>(EMPTY_HISTORY)
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

function normalizeSelection(document: TemplateDocument, nodeId: string): string {
  return findNode(document.content.root, nodeId)?.id ?? document.content.root.id
}

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
