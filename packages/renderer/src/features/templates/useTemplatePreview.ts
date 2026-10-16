import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  TemplateApplication,
  TemplateDocument,
  TemplatePreviewResult
} from '@ls101/template-editor'

/** 按模板声明的题型别名索引可供预览绑定的实例。 */
type InstanceOptions = Record<
  string,
  Awaited<ReturnType<TemplateApplication['browser']['listInterfaceInstances']>>
>

/** 汇总预览编译状态、实例候选和当前绑定选择。 */
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

/** 仅在预览激活时加载题型实例，并在绑定齐全后编译当前文档。 */
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

  // 文档变化时重新查询各题型实例；清理标记阻止旧请求覆盖新状态。
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
              // 保留仍然有效的选择，否则默认选中首个实例；无实例时使用空值。
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

  // 所有必需别名都选定实例后，才能构造完整的预览绑定。
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
    // 等待候选加载完成，避免使用上一次文档的绑定发起预览。
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
        // 切换文档或绑定后，即使旧编译已完成，也不再采用其结果。
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
    // 递增令牌可在文档与绑定未变化时手动触发重新编译。
    refresh: () => setRefreshToken((value) => value + 1),
    selectInstance
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
