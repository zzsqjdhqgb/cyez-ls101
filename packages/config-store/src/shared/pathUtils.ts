import type { ConfigScope } from './types'

const SCOPE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export function validateConfigScopeSegment(segment: string): void {
  if (typeof segment !== 'string' || !SCOPE_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`Invalid config-store scope segment: ${segment}`)
  }
}

export function validateConfigScope(scope: ConfigScope): void {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new Error('Config-store scope must contain at least one segment')
  }

  for (const segment of scope) validateConfigScopeSegment(segment)
}

export function validateConfigKey(key: string): void {
  if (typeof key !== 'string' || !CONFIG_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid config-store key: ${key}`)
  }
}
