import { useSyncExternalStore, type ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

export type RouteLayout = 'standard' | 'focus' | 'immersive'

export interface NavigationRegistration {
  label: string
  icon: LucideIcon
  placement?: 'main' | 'footer'
  group?: string
  order?: number
}

export interface AppRouteRegistration {
  id: string
  path: `/${string}`
  component: ComponentType
  layout?: RouteLayout
  navigation?: NavigationRegistration
}

export class AppRouteRegistry {
  private routes: readonly AppRouteRegistration[] = []
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): readonly AppRouteRegistration[] => this.routes

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(registration: AppRouteRegistration): () => void {
    if (this.routes.some((route) => route.id === registration.id)) {
      throw new Error(`Route id is already registered: ${registration.id}`)
    }

    if (this.routes.some((route) => route.path === registration.path)) {
      throw new Error(`Route path is already registered: ${registration.path}`)
    }

    this.routes = [...this.routes, registration]
    this.emitChange()

    return () => {
      const nextRoutes = this.routes.filter((route) => route.id !== registration.id)
      if (nextRoutes.length === this.routes.length) return

      this.routes = nextRoutes
      this.emitChange()
    }
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener())
  }
}

export const appRouteRegistry = new AppRouteRegistry()

export function registerAppRoute(registration: AppRouteRegistration): () => void {
  return appRouteRegistry.register(registration)
}

export function useRegisteredRoutes(): readonly AppRouteRegistration[] {
  return useSyncExternalStore(
    appRouteRegistry.subscribe,
    appRouteRegistry.getSnapshot,
    appRouteRegistry.getSnapshot
  )
}
