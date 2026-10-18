/* eslint-disable react-hooks/immutability -- MemoryRouter 未提供导航阻塞接口，需要包装导航方法。 */
import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'

/** 暂存用户尝试执行的导航，在确认放弃修改后继续执行。 */
interface PendingNavigation {
  run(): void
}

export interface UnsavedChangesGuard {
  allowNextNavigation(): void
  navigationPending: boolean
  cancelNavigation(): void
  confirmNavigation(): void
}

/** 拦截页面卸载与应用内导航；应用内导航会先请求确认，页面卸载仅阻止离开。 */
export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const bypassRef = useRef(false)
  const removeBeforeUnloadRef = useRef<(() => void) | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)

  // 关闭窗口或重新加载会被 beforeunload 静默拦截，Electron 下不会弹出浏览器的离开确认框。
  // 若产品需要确认框，可由主进程监听 will-prevent-unload 并显式提示。
  useEffect(() => {
    if (!active) return
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    const removeBeforeUnload = (): void => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (removeBeforeUnloadRef.current === removeBeforeUnload) {
        removeBeforeUnloadRef.current = null
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    removeBeforeUnloadRef.current = removeBeforeUnload
    return removeBeforeUnload
  }, [active])

  useEffect(() => {
    // MemoryRouter 没有可用的阻塞接口，临时包装导航方法并在清理时恢复。
    const originalPush = navigator.push.bind(navigator)
    const originalReplace = navigator.replace.bind(navigator)
    const originalGo = navigator.go.bind(navigator)
    const guard = (run: () => void): void => {
      // 保存成功等场景可放行下一次导航，放行标记只消费一次。
      if (bypassRef.current) {
        bypassRef.current = false
        run()
      } else if (active) {
        setPendingNavigation({ run })
      } else {
        run()
      }
    }
    const guardedPush: typeof navigator.push = (...args) => guard(() => originalPush(...args))
    const guardedReplace: typeof navigator.replace = (...args) =>
      guard(() => originalReplace(...args))
    const guardedGo: typeof navigator.go = (...args) => guard(() => originalGo(...args))

    navigator.push = guardedPush
    navigator.replace = guardedReplace
    navigator.go = guardedGo
    return () => {
      // 仅恢复本 Hook 仍持有的方法，避免覆盖后来安装的其他包装。
      if (navigator.push === guardedPush) navigator.push = originalPush
      if (navigator.replace === guardedReplace) navigator.replace = originalReplace
      if (navigator.go === guardedGo) navigator.go = originalGo
    }
  }, [active, navigator])

  return {
    allowNextNavigation: () => {
      bypassRef.current = true
      // 主动离开时同步解除卸载监听，避免随后关闭窗口时再次被静默拦截。
      removeBeforeUnloadRef.current?.()
    },
    navigationPending: pendingNavigation !== null,
    cancelNavigation: () => setPendingNavigation(null),
    confirmNavigation: () => {
      const navigation = pendingNavigation
      setPendingNavigation(null)
      // 暂存的回调直接调用原导航方法，确认后无需再次经过拦截。
      navigation?.run()
    }
  }
}
