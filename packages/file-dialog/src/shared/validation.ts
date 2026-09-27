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
    throw new TypeError('文件对话框选项必须是对象')
  }
}

function validateTitle(title: string | undefined): void {
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    throw new TypeError('文件对话框标题必须是非空字符串')
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
    throw new TypeError('文件对话框默认文件名不能包含路径')
  }
}

function validateFilters(filters: readonly FileDialogFilter[] | undefined): void {
  if (filters === undefined) return
  if (!Array.isArray(filters) || filters.length === 0) {
    throw new TypeError('文件对话框筛选器必须是非空数组')
  }

  for (const filter of filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      throw new TypeError('文件对话框筛选器必须是对象')
    }
    if (typeof filter.name !== 'string' || filter.name.trim().length === 0) {
      throw new TypeError('文件对话框筛选器名称必须是非空字符串')
    }
    if (!Array.isArray(filter.extensions) || filter.extensions.length === 0) {
      throw new TypeError('文件对话框筛选器扩展名必须是非空数组')
    }
    for (const extension of filter.extensions) {
      if (typeof extension !== 'string' || !EXTENSION_PATTERN.test(extension)) {
        throw new TypeError(`文件对话框扩展名无效：「${String(extension)}」`)
      }
    }
  }
}
