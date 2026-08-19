import type {
  FunctionDocument,
  FunctionInputDef,
  FunctionInputExpression,
  TemplateApplication,
  TemplatePreviewResult
} from '@ls101/template-editor'
import { useEffect, useMemo, useState } from 'react'

export interface FunctionPreviewSession {
  compiling: boolean
  error: string | null
  inputs: Readonly<Record<string, FunctionInputExpression>>
  result: TemplatePreviewResult | null
  refresh(): void
  setInput(name: string, value: FunctionInputExpression): void
}

interface StoredPreviewInput {
  definition: FunctionInputDef
  value: FunctionInputExpression
}

interface StoredPreviewState {
  ownerKey: string
  definitions: FunctionInputDef[]
  inputs: Record<string, StoredPreviewInput>
}

export function useFunctionPreview(
  application: TemplateApplication,
  libraryId: string,
  document: FunctionDocument | null,
  active: boolean
): FunctionPreviewSession {
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<TemplatePreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const ownerKey = document ? `${libraryId}:${document.functionId}` : ''
  const definitions = document?.content.inputs ?? []
  const [storedState, setStoredState] = useState<StoredPreviewState>(() => ({
    ownerKey,
    definitions: structuredClone(definitions),
    inputs: {}
  }))
  let storedInputs = storedState.inputs
  if (
    storedState.ownerKey !== ownerKey ||
    !sameInputDefinitions(storedState.definitions, definitions)
  ) {
    storedInputs =
      storedState.ownerKey === ownerKey
        ? compatibleStoredInputs(storedState.inputs, definitions)
        : {}
    setStoredState({
      ownerKey,
      definitions: structuredClone(definitions),
      inputs: storedInputs
    })
  }
  const inputs = useMemo(
    () =>
      Object.fromEntries(
        (document?.content.inputs ?? []).map((input) => {
          const stored = storedInputs[input.name]
          return [
            input.name,
            stored && isCompatibleInput(stored, input) ? stored.value : defaultInput(input)
          ]
        })
      ),
    [document?.content.inputs, storedInputs]
  )

  useEffect(() => {
    if (!active || !document) return
    let current = true
    void Promise.resolve()
      .then(async () => {
        if (!current) return null
        setCompiling(true)
        setError(null)
        setResult(null)
        return application.functionLibraries.local.preview(libraryId, document, inputs)
      })
      .then((nextResult) => {
        if (current && nextResult) setResult(nextResult)
      })
      .catch((reason: unknown) => {
        if (!current) return
        setResult(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (current) setCompiling(false)
      })
    return () => {
      current = false
    }
  }, [active, application, document, inputs, libraryId, refreshToken])

  return {
    compiling,
    error,
    inputs,
    result,
    refresh: () => setRefreshToken((value) => value + 1),
    setInput: (name, value) => {
      const definition = document?.content.inputs.find((input) => input.name === name)
      if (!definition) return
      setStoredState((current) => ({
        ownerKey,
        definitions: structuredClone(definitions),
        inputs: {
          ...(current.ownerKey === ownerKey ? current.inputs : {}),
          [name]: { definition: structuredClone(definition), value }
        }
      }))
    }
  }
}

function isCompatibleInput(stored: StoredPreviewInput, input: FunctionInputDef): boolean {
  if (stored.value.type !== input.type || stored.definition.type !== input.type) return false
  if (
    input.type !== 'choice-group' ||
    stored.value.type !== 'choice-group' ||
    stored.definition.type !== 'choice-group'
  ) {
    return true
  }
  if (stored.definition.shape.kind !== input.shape.kind) return false
  if (
    input.shape.kind !== 'question' &&
    (stored.definition.shape.kind === 'question' ||
      !samePageCounts(stored.definition.shape.pageCounts, input.shape.pageCounts))
  ) {
    return false
  }
  return stored.value.selection.kind === input.shape.kind
}

function compatibleStoredInputs(
  storedInputs: Readonly<Record<string, StoredPreviewInput>>,
  definitions: readonly FunctionInputDef[]
): Record<string, StoredPreviewInput> {
  return Object.fromEntries(
    definitions.flatMap((definition) => {
      const stored = storedInputs[definition.name]
      return stored && isCompatibleInput(stored, definition)
        ? [[definition.name, stored] as const]
        : []
    })
  )
}

function sameInputDefinitions(
  left: readonly FunctionInputDef[],
  right: readonly FunctionInputDef[]
): boolean {
  return (
    left.length === right.length &&
    left.every((input, index) => {
      const other = right[index]
      if (!other || input.name !== other.name || input.type !== other.type) return false
      if (input.type !== 'choice-group' || other.type !== 'choice-group') return true
      if (input.shape.kind !== other.shape.kind) return false
      return (
        input.shape.kind === 'question' ||
        (other.shape.kind !== 'question' &&
          samePageCounts(input.shape.pageCounts, other.shape.pageCounts))
      )
    })
  )
}

function samePageCounts(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((count, index) => count === right[index])
}

function defaultInput(input: FunctionInputDef): FunctionInputExpression {
  if (input.type === 'choice-group') {
    if (input.shape.kind === 'question') {
      return {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'question', pageIndex: 0, questionIndex: 0 }
      }
    }
    if (input.shape.kind === 'range') {
      return {
        type: 'choice-group',
        source: 'global',
        selection: { kind: 'range', startPage: 0 }
      }
    }
    return { type: 'choice-group', source: 'global', selection: { kind: 'all' } }
  }
  if (input.type === 'number') return { type: 'number', source: 'literal', value: 0 }
  return { type: input.type, source: 'literal', value: '' }
}
