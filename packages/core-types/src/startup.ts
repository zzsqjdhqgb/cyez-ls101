export const STARTUP_CHANNELS = {
  whenReady: 'startup:when-ready'
} as const

export interface StartupBridge {
  whenReady(): Promise<void>
}
