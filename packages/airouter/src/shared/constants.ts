export const AIROUTER_CHANNELS = {
  listConfigs: 'airouter:list-configs',
  saveConfig: 'airouter:save-config',
  deleteConfig: 'airouter:delete-config',
  listModels: 'airouter:list-models',
  testConnection: 'airouter:test-connection',
  generateStart: 'airouter:generate-start',
  generateAbort: 'airouter:generate-abort',
  generateEvent: 'airouter:generate-event'
} as const

export type AIRouterChannel = (typeof AIROUTER_CHANNELS)[keyof typeof AIROUTER_CHANNELS]
