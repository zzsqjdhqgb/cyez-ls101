const SCOPE_SEGMENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/
const FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/

export function validateScopeSegment(segment: string): void {
  if (typeof segment !== 'string' || !SCOPE_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`文件存储作用域片段无效：「${segment}」`)
  }
}

export function validateScope(scope: readonly string[]): void {
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new Error('文件存储作用域至少需要一个片段')
  }

  for (const segment of scope) validateScopeSegment(segment)
}

export function validateFilename(filename: string): void {
  if (typeof filename !== 'string' || !FILENAME_PATTERN.test(filename)) {
    throw new Error(`文件存储文件名无效：「${filename}」`)
  }
}
