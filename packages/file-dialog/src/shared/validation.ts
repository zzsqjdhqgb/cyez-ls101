import type { FileDialogFilter, ReadFileOptions, WriteFileOptions } from './types'

const EXTENSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export function validateReadFileOptions(options: ReadFileOptions | undefined): void {
  if (options === undefined) return
  validateOptionsObject(options)
  validateTitle(options.title)
  validateFilters(options.filters)
}

export function validateWriteFileOptions(options: WriteFileOptions | undefined): void {
  if (options === undefined) return
  validateOptionsObject(options)
  validateTitle(options.title)
  validateDefaultName(options.defaultName)
  validateFilters(options.filters)
}

function validateOptionsObject(options: unknown): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('File-dialog options must be an object')
  }
}

function validateTitle(title: string | undefined): void {
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    throw new TypeError('File-dialog title must be a non-empty string')
  }
}

function validateDefaultName(defaultName: string | undefined): void {
  if (defaultName === undefined) return
  if (
    typeof defaultName !== 'string' ||
    defaultName.length === 0 ||
    defaultName === '.' ||
    defaultName === '..' ||
    defaultName.includes('/') ||
    defaultName.includes('\\') ||
    defaultName.includes('\0')
  ) {
    throw new TypeError('File-dialog default name must be a filename without a path')
  }
}

function validateFilters(filters: readonly FileDialogFilter[] | undefined): void {
  if (filters === undefined) return
  if (!Array.isArray(filters) || filters.length === 0) {
    throw new TypeError('File-dialog filters must be a non-empty array')
  }

  for (const filter of filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new TypeError('File-dialog filter must be an object')
    }
    if (typeof filter.name !== 'string' || filter.name.trim().length === 0) {
      throw new TypeError('File-dialog filter name must be a non-empty string')
    }
    if (!Array.isArray(filter.extensions) || filter.extensions.length === 0) {
      throw new TypeError('File-dialog filter extensions must be a non-empty array')
    }
    for (const extension of filter.extensions) {
      if (typeof extension !== 'string' || !EXTENSION_PATTERN.test(extension)) {
        throw new TypeError(`Invalid file-dialog extension: ${String(extension)}`)
      }
    }
  }
}
