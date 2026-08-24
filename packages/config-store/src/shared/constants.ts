export const CONFIG_STORE_CHANNELS = {
  read: 'config:read',
  write: 'config:write',
  delete: 'config:delete',
  clear: 'config:clear'
} as const

export type ConfigStoreChannel = (typeof CONFIG_STORE_CHANNELS)[keyof typeof CONFIG_STORE_CHANNELS]
