export const ASSET_PROTOCOL_SCHEME = 'asset'
export const ASSET_PROTOCOL_HOST = 'local'

export const TEXT_DIRECTORY = '.text'
export const ASSET_DIRECTORY = '.assets'

export const FILE_STORE_CHANNELS = {
  readText: 'file:read-text',
  writeText: 'file:write-text',
  compareAndSwapText: 'file:compare-and-swap-text',
  deleteText: 'file:delete-text',
  hasText: 'file:has-text',
  listText: 'file:list-text',
  readAsset: 'file:read-asset',
  writeAsset: 'file:write-asset',
  deleteAsset: 'file:delete-asset',
  hasAsset: 'file:has-asset',
  listAssets: 'file:list-assets',
  listScopes: 'file:list-scopes',
  clearScope: 'file:clear-scope'
} as const

export type FileStoreChannel = (typeof FILE_STORE_CHANNELS)[keyof typeof FILE_STORE_CHANNELS]
