import { describe, expect, it } from 'vitest'
import { validateReadFileOptions, validateWriteFileOptions } from '../shared/validation'

describe('file-dialog option validation', () => {
  it('accepts valid filters and default names', () => {
    expect(() =>
      validateWriteFileOptions({
        title: 'Export',
        defaultName: 'interface.lsinterface',
        filters: [{ name: 'Interface package', extensions: ['lsinterface'] }]
      })
    ).not.toThrow()
  })

  it('rejects a default name containing a path', () => {
    expect(() => validateWriteFileOptions({ defaultName: '../export.json' })).toThrow(
      '文件对话框默认文件名不能包含路径'
    )
    expect(() => validateWriteFileOptions({ defaultName: 'folder\\export.json' })).toThrow(
      '文件对话框默认文件名不能包含路径'
    )
  })

  it('rejects invalid filter extensions', () => {
    expect(() =>
      validateReadFileOptions({ filters: [{ name: 'JSON', extensions: ['.json'] }] })
    ).toThrow('文件对话框扩展名无效')
    expect(() =>
      validateReadFileOptions({ filters: [{ name: 'JSON', extensions: ['../json'] }] })
    ).toThrow('文件对话框扩展名无效')
  })

  it('rejects empty titles and filter arrays', () => {
    expect(() => validateReadFileOptions({ title: ' ' })).toThrow('文件对话框标题必须是非空字符串')
    expect(() => validateReadFileOptions({ filters: [] })).toThrow('文件对话框筛选器必须是非空数组')
  })
})
