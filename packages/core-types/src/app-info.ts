export const APP_INFO_CHANNELS = {
  getVersion: 'app-info:get-version',
  ensureInstallationMarker: 'app-info:ensure-installation-marker',
  claimReleaseNotesVersion: 'app-info:claim-release-notes-version'
} as const

export interface AppInfoBridge {
  getVersion(): Promise<string>
  ensureInstallationMarker(): Promise<void>
  claimReleaseNotesVersion(version: string): Promise<boolean>
}
