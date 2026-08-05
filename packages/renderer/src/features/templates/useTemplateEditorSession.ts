import { useEffect, useRef, useState } from 'react'
import {
  editTemplateDocument,
  type DocumentEditError,
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
  clearError(): void
}

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
  templateId: string
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
    void application.templates
      .get(templateId)
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
  }, [application, templateId])

  const apply = (operation: TemplateDocumentOperation): boolean => {
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

  const document = history.present?.document ?? null
  return {
    document,
    selectedNode: document ? findNode(document.content.root, selectedNodeId) : null,
    selectedNodeId,
    loading,
    saving,
    dirty: history.present !== null && history.present.id !== history.cleanId,
    error,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    apply,
    selectNode,
    undo,
    redo,
    save,
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
