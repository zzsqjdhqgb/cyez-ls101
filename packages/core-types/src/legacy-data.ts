export const LEGACY_DATA_CHANNELS = {
  getInfo: 'legacy-data:get-info',
  exportArchive: 'legacy-data:export-archive',
  cleanup: 'legacy-data:cleanup',
  retry: 'legacy-data:retry'
} as const

export type LegacyDataStatus = 'none' | 'archiving' | 'archived' | 'cleaning' | 'cleaned' | 'error'

export interface LegacyDataSourceInfo {
  name: string
  fileCount: number
  sizeBytes: number
}

export interface LegacyDataInfo {
  status: LegacyDataStatus
  archivePath: string | null
  archiveSizeBytes: number | null
  sourceDirectories: LegacyDataSourceInfo[]
  error?: string
}

export interface LegacyDataBridge {
  getInfo(): Promise<LegacyDataInfo>
  exportArchive(): Promise<boolean>
  cleanup(): Promise<LegacyDataInfo>
  retry(): Promise<LegacyDataInfo>
}
