export const DATA_DIRECTORY_CHANNELS = {
  getInfo: 'data-directory:get-info',
  choose: 'data-directory:choose',
  chooseDefault: 'data-directory:choose-default',
  resetDefault: 'data-directory:reset-default',
  migrate: 'data-directory:migrate',
  useExisting: 'data-directory:use-existing',
  deleteOld: 'data-directory:delete-old'
} as const

export type DataDirectoryCandidateKind = 'empty' | 'managed' | 'current'

export interface DataDirectoryInfo {
  currentPath: string
  defaultPath: string
  sizeBytes: number
  oldDataDirectory: DataDirectoryOldLocation | null
}

export interface DataDirectoryOldLocation {
  path: string
  sizeBytes: number | null
  deleting: boolean
}

export interface DataDirectoryCandidate {
  path: string
  kind: DataDirectoryCandidateKind
  sizeBytes: number
}

export interface DataDirectoryBridge {
  getInfo(): Promise<DataDirectoryInfo>
  choose(): Promise<DataDirectoryCandidate | null>
  chooseDefault(): Promise<DataDirectoryCandidate>
  resetDefault(): Promise<void>
  migrate(path: string): Promise<void>
  useExisting(path: string): Promise<void>
  deleteOld(): Promise<void>
}
