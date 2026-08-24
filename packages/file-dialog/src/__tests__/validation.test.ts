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
      'File-dialog default name must be a filename without a path'
    )
    expect(() => validateWriteFileOptions({ defaultName: 'folder\\export.json' })).toThrow(
      'File-dialog default name must be a filename without a path'
    )
  })

  it('rejects invalid filter extensions', () => {
    expect(() =>
      validateReadFileOptions({ filters: [{ name: 'JSON', extensions: ['.json'] }] })
    ).toThrow('Invalid file-dialog extension')
    expect(() =>
      validateReadFileOptions({ filters: [{ name: 'JSON', extensions: ['../json'] }] })
    ).toThrow('Invalid file-dialog extension')
  })

  it('rejects empty titles and filter arrays', () => {
    expect(() => validateReadFileOptions({ title: ' ' })).toThrow(
      'File-dialog title must be a non-empty string'
    )
    expect(() => validateReadFileOptions({ filters: [] })).toThrow(
      'File-dialog filters must be a non-empty array'
    )
  })
})
