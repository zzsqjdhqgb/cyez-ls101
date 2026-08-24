import type { ConfigStoreBridge } from '../shared/types'

declare global {
  interface Window {
    configStore: ConfigStoreBridge
  }
}

export function getConfigStoreBridge(): ConfigStoreBridge {
  if (!window.configStore) throw new Error('Config-store preload bridge is unavailable')
  return window.configStore
}
