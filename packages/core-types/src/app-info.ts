export const APP_INFO_CHANNELS = {
  getVersion: 'app-info:get-version',
  ensureInstallationMarker: 'app-info:ensure-installation-marker'
} as const

export interface AppInfoBridge {
  getVersion(): Promise<string>
  ensureInstallationMarker(): Promise<void>
}
