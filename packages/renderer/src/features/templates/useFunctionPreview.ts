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

export function useFunctionPreview(
  application: TemplateApplication,
  libraryId: string,
  document: FunctionDocument | null,
  active: boolean
): FunctionPreviewSession {
  const [storedInputs, setStoredInputs] = useState<Record<string, FunctionInputExpression>>({})
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<TemplatePreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const inputs = useMemo(
    () =>
      Object.fromEntries(
        (document?.content.inputs ?? []).map((input) => {
          const stored = storedInputs[input.name]
          return [input.name, stored?.type === input.type ? stored : defaultInput(input)]
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
    setInput: (name, value) => setStoredInputs((current) => ({ ...current, [name]: value }))
  }
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
