import type { ConfigScope } from './types'

const SCOPE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const CONFIG_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export function validateConfigScopeSegment(segment: string): void {
  if (typeof segment !== 'string' || !SCOPE_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`配置存储作用域片段无效：「${segment}」`)
  }
}

export function validateConfigScope(scope: ConfigScope): void {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new Error('配置存储作用域至少需要一个片段')
  }

  for (const segment of scope) validateConfigScopeSegment(segment)
}

export function validateConfigKey(key: string): void {
  if (typeof key !== 'string' || !CONFIG_KEY_PATTERN.test(key)) {
    throw new Error(`配置键无效：「${key}」`)
  }
}
