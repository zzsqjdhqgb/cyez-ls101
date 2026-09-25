import type { ConfigStoreBridge } from '../shared/types'

declare global {
  interface Window {
    configStore: ConfigStoreBridge
  }
}

export function getConfigStoreBridge(): ConfigStoreBridge {
  if (!window.configStore) throw new Error('配置存储预加载桥接不可用')
  return window.configStore
}
