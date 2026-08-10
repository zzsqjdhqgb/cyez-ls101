export const APP_INFO_CHANNELS = {
  getVersion: 'app-info:get-version'
} as const

export interface AppInfoBridge {
  getVersion(): Promise<string>
}
