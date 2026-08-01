import { useSyncExternalStore, type ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SettingsGroupRegistration {
  id: string
  label: string
  order?: number
}

export interface SettingsPageRegistration {
  id: string
  title: string
  description?: string
  icon: LucideIcon
  group: SettingsGroupRegistration
  order?: number
  component: ComponentType
}

export class SettingsPageRegistry {
  private pages: readonly SettingsPageRegistration[] = []
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): readonly SettingsPageRegistration[] => this.pages

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  register(registration: SettingsPageRegistration): () => void {
    if (this.pages.some((page) => page.id === registration.id)) {
      throw new Error(`Settings page id is already registered: ${registration.id}`)
    }

    const existingGroup = this.pages.find((page) => page.group.id === registration.group.id)
    if (
      existingGroup &&
      (existingGroup.group.label !== registration.group.label ||
        existingGroup.group.order !== registration.group.order)
    ) {
      throw new Error(`Settings group metadata conflicts: ${registration.group.id}`)
    }

    this.pages = [...this.pages, registration]
    this.emitChange()

    return () => {
      const nextPages = this.pages.filter((page) => page.id !== registration.id)
      if (nextPages.length === this.pages.length) return

      this.pages = nextPages
      this.emitChange()
    }
  }

  private emitChange(): void {
    this.listeners.forEach((listener) => listener())
  }
}

export const settingsPageRegistry = new SettingsPageRegistry()

export function registerSettingsPage(registration: SettingsPageRegistration): () => void {
  return settingsPageRegistry.register(registration)
}

export function useRegisteredSettingsPages(): readonly SettingsPageRegistration[] {
  return useSyncExternalStore(
    settingsPageRegistry.subscribe,
    settingsPageRegistry.getSnapshot,
    settingsPageRegistry.getSnapshot
  )
}
