export const AIROUTER_CHANNELS = {
  listConfigs: 'airouter:list-configs',
  saveConfig: 'airouter:save-config',
  deleteConfig: 'airouter:delete-config',
  readApiKey: 'airouter:read-api-key',
  listModels: 'airouter:list-models',
  testConnection: 'airouter:test-connection',
  listImageConfigs: 'airouter:list-image-configs',
  saveImageConfig: 'airouter:save-image-config',
  deleteImageConfig: 'airouter:delete-image-config',
  readImageApiKey: 'airouter:read-image-api-key',
  listImageModels: 'airouter:list-image-models',
  testImageConnection: 'airouter:test-image-connection',
  imageGenerateStart: 'airouter:image-generate-start',
  imageGenerateAbort: 'airouter:image-generate-abort',
  imageGenerateEvent: 'airouter:image-generate-event',
  generateStart: 'airouter:generate-start',
  generateAbort: 'airouter:generate-abort',
  generateEvent: 'airouter:generate-event'
} as const

export type AIRouterChannel = (typeof AIROUTER_CHANNELS)[keyof typeof AIROUTER_CHANNELS]
