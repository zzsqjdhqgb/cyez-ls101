import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  TemplateApplication,
  TemplateDocument,
  TemplatePreviewResult
} from '@ls101/template-editor'

type InstanceOptions = Record<
  string,
  Awaited<ReturnType<TemplateApplication['browser']['listInterfaceInstances']>>
>

export interface TemplatePreviewSession {
  compiling: boolean
  error: string | null
  instanceOptions: InstanceOptions
  instancesLoading: boolean
  missingInstances: boolean
  result: TemplatePreviewResult | null
  selections: Readonly<Record<string, string>>
  refresh(): void
  selectInstance(alias: string, instanceId: string): void
}

export function useTemplatePreview(
  application: TemplateApplication,
  document: TemplateDocument | null,
  active: boolean
): TemplatePreviewSession {
  const requirements = useMemo(
    () => document?.content.interfaces ?? [],
    [document?.content.interfaces]
  )
  const [instanceOptions, setInstanceOptions] = useState<InstanceOptions>({})
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [instancesReady, setInstancesReady] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [result, setResult] = useState<TemplatePreviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!active || !document) return
    let current = true
    void Promise.resolve()
      .then(async () => {
        if (!current) return []
        setInstancesLoading(true)
        setInstancesReady(false)
        return Promise.all(
          requirements.map(
            async (requirement) =>
              [
                requirement.alias,
                await application.browser.listInterfaceInstances(requirement.interfaceId)
              ] as const
          )
        )
      })
      .then((entries) => {
        if (!current) return
        const nextOptions = Object.fromEntries(entries)
        setInstanceOptions(nextOptions)
        setSelections((previous) =>
          Object.fromEntries(
            requirements.map((requirement) => {
              const options = nextOptions[requirement.alias] ?? []
              const retained = options.some(
                (instance) => instance.instanceId === previous[requirement.alias]
              )
                ? previous[requirement.alias]
                : (options[0]?.instanceId ?? '')
              return [requirement.alias, retained]
            })
          )
        )
        setError(null)
        setInstancesReady(true)
      })
      .catch((reason: unknown) => {
        if (!current) return
        setError(errorMessage(reason))
        setInstancesReady(false)
      })
      .finally(() => {
        if (current) setInstancesLoading(false)
      })
    return () => {
      current = false
    }
  }, [active, application, document, requirements])

  const missingInstances = requirements.some((requirement) => !selections[requirement.alias])
  const bindings = useMemo(
    () =>
      requirements.map((requirement) => ({
        alias: requirement.alias,
        interfaceId: requirement.interfaceId,
        instanceId: selections[requirement.alias] ?? ''
      })),
    [requirements, selections]
  )

  useEffect(() => {
    if (!active || !document || !instancesReady || missingInstances) return
    let current = true
    void Promise.resolve()
      .then(async () => {
        if (!current) return null
        setCompiling(true)
        setError(null)
        setResult(null)
        return application.templates.preview(document, bindings)
      })
      .then((nextResult) => {
        if (current && nextResult) setResult(nextResult)
      })
      .catch((reason: unknown) => {
        if (!current) return
        setResult(null)
        setError(errorMessage(reason))
      })
      .finally(() => {
        if (current) setCompiling(false)
      })
    return () => {
      current = false
    }
  }, [active, application, bindings, document, instancesReady, missingInstances, refreshToken])

  const selectInstance = useCallback((alias: string, instanceId: string): void => {
    setSelections((current) => ({ ...current, [alias]: instanceId }))
  }, [])

  return {
    compiling,
    error,
    instanceOptions,
    instancesLoading,
    missingInstances,
    result,
    selections,
    refresh: () => setRefreshToken((value) => value + 1),
    selectInstance
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
