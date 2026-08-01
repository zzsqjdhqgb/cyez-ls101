import type { AIRouterBridge } from '../shared'

declare global {
  interface Window {
    airouter?: AIRouterBridge
  }
}

export function getAIRouterBridge(): AIRouterBridge {
  if (!window.airouter) throw new Error('AI Router preload bridge is unavailable')
  return window.airouter
}
