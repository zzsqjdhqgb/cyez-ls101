/* eslint-disable react-hooks/immutability -- MemoryRouter exposes no navigation blocker API. */
import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'

interface PendingNavigation {
  run(): void
}

export interface UnsavedChangesGuard {
  allowNextNavigation(): void
  navigationPending: boolean
  cancelNavigation(): void
  confirmNavigation(): void
}

export function useUnsavedChangesGuard(active: boolean): UnsavedChangesGuard {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const bypassRef = useRef(false)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)

  useEffect(() => {
    if (!active) return
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [active])

  useEffect(() => {
    const originalPush = navigator.push.bind(navigator)
    const originalReplace = navigator.replace.bind(navigator)
    const originalGo = navigator.go.bind(navigator)
    const guard = (run: () => void): void => {
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

    // Declarative MemoryRouter has no blocker API, so guard its three navigation entry points.
    navigator.push = guardedPush
    navigator.replace = guardedReplace
    navigator.go = guardedGo
    return () => {
      if (navigator.push === guardedPush) navigator.push = originalPush
      if (navigator.replace === guardedReplace) navigator.replace = originalReplace
      if (navigator.go === guardedGo) navigator.go = originalGo
    }
  }, [active, navigator])

  return {
    allowNextNavigation: () => {
      bypassRef.current = true
    },
    navigationPending: pendingNavigation !== null,
    cancelNavigation: () => setPendingNavigation(null),
    confirmNavigation: () => {
      const navigation = pendingNavigation
      setPendingNavigation(null)
      navigation?.run()
    }
  }
}
