export const WINDOW_CONTROL_CHANNELS = {
  minimize: 'window-controls:minimize',
  toggleMaximize: 'window-controls:toggle-maximize',
  close: 'window-controls:close',
  getMaximized: 'window-controls:get-maximized'
} as const

export const WINDOW_CONTROL_EVENTS = {
  maximizedChanged: 'window-controls:maximized-changed'
} as const

export interface WindowControlsBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  getMaximized(): Promise<boolean>
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
}
