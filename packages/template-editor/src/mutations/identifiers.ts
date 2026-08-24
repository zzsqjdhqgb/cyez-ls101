import type { TemplateNode } from '../types'
import type { DocumentEditError, DocumentEditErrorCode } from './types'

export function allocateId(suggestion: string, fallback: string, used: Set<string>): string {
  const base = suggestion.trim() || fallback
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let suffix = 1
  while (used.has(`${base}-${suffix}`)) suffix += 1
  const value = `${base}-${suffix}`
  used.add(value)
  return value
}

export function allocateName(suggestion: string, fallback: string, used: Set<string>): string {
  const normalized = normalizeLocalName(suggestion) || fallback
  if (!used.has(normalized)) return reserveName(normalized, used)
  return allocateGeneratedName(normalized, used)
}

export function allocateGeneratedName(suggestion: string, used: Set<string>): string {
  const base = normalizeLocalName(suggestion) || 'output'
  let suffix = 1
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return reserveName(`${base}-${suffix}`, used)
}

export function reserveName(value: string, used: Set<string>): string {
  used.add(value)
  return value
}

export function normalizeLocalName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!normalized) return ''
  return /^[a-zA-Z_]/.test(normalized) ? normalized : `value-${normalized}`
}

export function nodeIdBase(type: TemplateNode['type']): string {
  return type === 'choice-question'
    ? 'choice-question'
    : type === 'function'
      ? 'function-call'
      : type
}

export function insertionIndex(index: number | undefined, length: number): number | null {
  const value = index ?? length
  return Number.isInteger(value) && value >= 0 && value <= length ? value : null
}

export function moveTargetIndex(index: number, length: number): number | null {
  return Number.isInteger(index) && index >= 0 && index < length ? index : null
}

export function hasIndex<T>(values: readonly T[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < values.length
}

export function insertAt<T>(values: readonly T[], index: number, value: T): T[] {
  return [...values.slice(0, index), value, ...values.slice(index)]
}

export function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((item, current) => (current === index ? value : item))
}

export function removeAt<T>(values: readonly T[], index: number): T[] {
  return values.filter((_item, current) => current !== index)
}

export function moveAt<T>(values: readonly T[], index: number, target: number): T[] {
  if (index === target) return [...values]
  const copy = [...values]
  const [value] = copy.splice(index, 1)
  copy.splice(target, 0, value)
  return copy
}

export function invalidIndex(path: string, index: number | undefined): DocumentEditError {
  return error('INVALID_INDEX', path, { index: index ?? -1 })
}

export function error(
  code: DocumentEditErrorCode,
  path: string,
  params: Readonly<Record<string, string | number>> = {}
): DocumentEditError {
  return { code, path, params }
}
