export const ASSET_PROTOCOL_SCHEME = 'asset'
export const ASSET_PROTOCOL_HOST = 'local'
export const BUILTIN_ASSET_PROTOCOL_SCHEME = 'builtin-asset'
export const BUILTIN_ASSET_PROTOCOL_HOST = 'local'

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

export const BUILTIN_FILE_STORE_CHANNELS = {
  readText: 'builtin-file:read-text',
  hasText: 'builtin-file:has-text',
  listText: 'builtin-file:list-text',
  readAsset: 'builtin-file:read-asset',
  hasAsset: 'builtin-file:has-asset',
  listAssets: 'builtin-file:list-assets',
  listScopes: 'builtin-file:list-scopes'
} as const

export type BuiltinFileStoreChannel =
  (typeof BUILTIN_FILE_STORE_CHANNELS)[keyof typeof BUILTIN_FILE_STORE_CHANNELS]
