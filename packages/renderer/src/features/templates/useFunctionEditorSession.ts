import { useEffect, useRef, useState } from 'react'
import {
  editFunctionDocument,
  type DocumentEditError,
  type FunctionDocument,
  type FunctionDocumentOperation,
  type FunctionLocator,
  type LocalFunctionLibraryDocument,
  type TemplateApplication,
  type TemplateNode
} from '@ls101/template-editor'
import { templateErrorMessage } from './templateUi'

interface HistoryEntry {
  id: number
  document: FunctionDocument
  selectedNodeId: string
}

interface EditorHistory {
  past: HistoryEntry[]
  present: HistoryEntry | null
  future: HistoryEntry[]
  cleanId: number | null
  nextId: number
}

export interface FunctionEditorSession {
  library: LocalFunctionLibraryDocument | null
  document: FunctionDocument | null
  selectedNode: TemplateNode | null
  selectedNodeId: string
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string | null
  canUndo: boolean
  canRedo: boolean
  apply(operation: FunctionDocumentOperation): boolean
  selectNode(nodeId: string): void
  undo(): void
  redo(): void
  save(): Promise<boolean>
  insertFunctionCall(locator: FunctionLocator, parentId: string, index?: number): Promise<boolean>
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

export function useFunctionEditorSession(
  application: TemplateApplication,
  libraryId: string,
  functionId: string
): FunctionEditorSession {
  const [history, setHistory] = useState<EditorHistory>(EMPTY_HISTORY)
  const historyRef = useRef(history)
  const [library, setLibrary] = useState<LocalFunctionLibraryDocument | null>(null)
  const libraryRef = useRef(library)
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

  const replaceLibrary = (value: LocalFunctionLibraryDocument | null): void => {
    libraryRef.current = value
    setLibrary(value)
  }

  const replaceSelection = (nodeId: string): void => {
    selectedNodeIdRef.current = nodeId
    setSelectedNodeId(nodeId)
  }

  useEffect(() => {
    mountedRef.current = true
    let active = true
    void application.functionLibraries.local
      .get(libraryId)
      .then((loadedLibrary) => {
        if (!active) return
        if (!loadedLibrary) {
          setError('本地函数库不存在。')
          return
        }
        const document = projectFunctionDocument(loadedLibrary, functionId)
        if (!document) {
          setError('本地函数不存在。')
          return
        }
        replaceLibrary(loadedLibrary)
        replaceHistory({
          past: [],
          present: { id: 0, document, selectedNodeId: document.content.body.id },
          future: [],
          cleanId: 0,
          nextId: 1
        })
        replaceSelection(document.content.body.id)
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
  }, [application, functionId, libraryId])

  const apply = (operation: FunctionDocumentOperation): boolean => {
    const current = historyRef.current
    if (!current.present) return false
    const result = editFunctionDocument(current.present.document, operation)
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
    if (!document || !findNode(document.content.body, nodeId)) return
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
    const librarySnapshot = libraryRef.current
    if (!snapshot || !librarySnapshot || savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const savedLibrary = await application.functionLibraries.local.saveFunction(
        librarySnapshot,
        snapshot.document
      )
      if (!mountedRef.current) return false
      replaceLibrary(savedLibrary)
      const savedDocument = projectFunctionDocument(savedLibrary, functionId)
      const current = historyRef.current
      replaceHistory({
        ...current,
        past: current.past.map((entry) => rebaseEntry(entry, snapshot.id, savedDocument)),
        present: current.present ? rebaseEntry(current.present, snapshot.id, savedDocument) : null,
        future: current.future.map((entry) => rebaseEntry(entry, snapshot.id, savedDocument)),
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
      const result = await application.functionLibraries.local.insertFunctionCall(
        libraryId,
        functionId,
        locator,
        parentId,
        index
      )
      if (!mountedRef.current) return false
      replaceLibrary(result.library)
      const current = historyRef.current
      const id = current.nextId
      const selectedNodeId = normalizeSelection(result.function, result.callNodeId)
      replaceHistory({
        past: current.present
          ? [...current.past, current.present].slice(-HISTORY_LIMIT)
          : current.past,
        present: { id, document: result.function, selectedNodeId },
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
    library,
    document,
    selectedNode: document ? findNode(document.content.body, selectedNodeId) : null,
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
    insertFunctionCall,
    clearError: () => setError(null)
  }
}

function projectFunctionDocument(
  library: LocalFunctionLibraryDocument,
  functionId: string
): FunctionDocument | null {
  const entry = library.content.functions.find((item) => item.functionId === functionId)
  if (!entry) return null
  return {
    functionId,
    content: structuredClone(entry.content),
    editorState: structuredClone(library.editorState.functions[functionId] ?? {})
  }
}

function rebaseEntry(
  entry: HistoryEntry,
  savedEntryId: number,
  saved: FunctionDocument | null
): HistoryEntry {
  return entry.id === savedEntryId && saved ? { ...entry, document: saved } : entry
}

function normalizeSelection(document: FunctionDocument, nodeId: string): string {
  return findNode(document.content.body, nodeId)?.id ?? document.content.body.id
}

function findNode(root: TemplateNode, nodeId: string): TemplateNode | null {
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
