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
  // 预览需求取自文档声明的 Interface 列表；memo 让同一列表引用下的结果保持稳定，
  // 供实例查询与绑定构造复用，而不是每次渲染都生成新数组。
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
  // 依赖包含整个 document：任一编辑都会重新加载候选实例并重建绑定。
  // 注意：instancesReady 在微任务中才失效，而编译 effect 会在同一轮 effect 执行中
  // 紧接着运行，此时读到的仍是 true，因此可能先用上一次加载的实例选择发起一次
  // 预览（interfaceId 已来自当前文档，instanceId 仍是旧值）；该次编译随后会被
  // 失效，但结果可能已发布并保留到下一次编译开始。修复方向见
  // TODO-template-preview-stale-bindings.md。
  // 加载逻辑放进微任务，可让同步抛错同样落到 catch 分支。
  useEffect(() => {
    if (!active || !document) return
    let current = true
    void Promise.resolve()
      .then(async () => {
        if (!current) return []
        setInstancesLoading(true)
        setInstancesReady(false)
        // 各题型并行查询，任何一次失败都会让整批结果作废并转为错误提示。
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
        // 按当前需求整体重建选择表：已失效的别名被丢弃，新别名取得默认值。
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
  // missingInstances 是预览的等待条件：任一别名为空时编译 effect 直接跳过，
  // 下面用 '' 占位的绑定不会真正发给应用层。
  // selections 变化会生成新的 bindings 引用，作为编译 effect 的重新编译信号。
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
    // 这里用 instancesReady 尽量等到候选实例加载完成再编译，避免把当前文档的
    // interfaceId 与上一次加载的实例选择搭配预览；但该标记在微任务中才失效，切换文档
    // 或重新进入预览视图的那一轮 effect 执行仍可能读到旧值，见
    // TODO-template-preview-stale-bindings.md。
    // 编译前先清空上一次结果，防止旧文档的预览残留在界面上；refreshToken 让用户可在
    // 文档与绑定都未变化时手动重编。
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
        // 切换文档或绑定后，旧编译迟到的结果会被丢弃。
        if (current && nextResult) setResult(nextResult)
      })
      .catch((reason: unknown) => {
        if (!current) return
        // 依赖读取等异常走 error；文档未通过校验则体现为 result.success === false。
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

  // 只记录选择，不主动触发编译：bindings 引用变化会让编译 effect 自动重跑。
  // 传入空字符串即清除该别名的绑定，预览回到等待选择的状态。
  const selectInstance = useCallback((alias: string, instanceId: string): void => {
    setSelections((current) => ({ ...current, [alias]: instanceId }))
  }, [])

  // 界面按两类失败分别展示：error 是直接抛出的异常（实例查询、依赖读取失败，
  // 或编译流程未按约定返回的意外错误），result.success === false 是编译流程返回的
  // 失败（模板校验、绑定或实例化失败）；TemplatePreview 的刷新按钮由 compiling、
  // instancesLoading、missingInstances 共同禁用，实例下拉框只由 instancesLoading 禁用。
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

/** 把未预期的拒绝值统一成可直接展示的错误文案。 */
function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
