import { requireCondition } from './errors'

export interface RuntimeConfig {
  schemaVersion: 1
  port: number
  host: '0.0.0.0' | '127.0.0.1'
}
export function validateRuntimeConfig(value: unknown): RuntimeConfig {
  const config = value as RuntimeConfig
  requireCondition(
    config?.schemaVersion === 1 &&
      Number.isInteger(config.port) &&
      config.port >= 1 &&
      config.port <= 65535 &&
      ['0.0.0.0', '127.0.0.1'].includes(config.host) &&
      Object.keys(config).every((key) => ['schemaVersion', 'port', 'host'].includes(key)),
    'INVALID_REQUEST'
  )
  return config
}
