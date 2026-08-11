import { describe, expect, it, vi } from 'vitest'
import type { LocalFunctionLibraryDocument, TemplateApplication } from '@ls101/template-editor'
import {
  exportLocalFunctionLibraryFile,
  importFunctionLibraryFile
} from '../features/templates/TemplateFunctionLibraryFiles'

const LIBRARY_ID = '10000000-0000-4000-8000-000000000001'

describe('Template function library files', () => {
  it('keeps the release version for unchanged content and increments it after edits', async () => {
    let stored = library()
    const save = vi.fn().mockImplementation(async (next: LocalFunctionLibraryDocument) => {
      stored = { ...next, revision: next.revision + 1 }
      return stored
    })
    const application = functionLibraryApplication({
      get: vi.fn().mockImplementation(async () => stored),
      save
    })
    const written: string[] = []
    const dialog = {
      readText: vi.fn(),
      writeText: vi.fn().mockImplementation(async (data: string) => {
        written.push(data)
        return true
      })
    }

    expect((await exportLocalFunctionLibraryFile(application, LIBRARY_ID, dialog))?.version).toBe(1)
    expect((await exportLocalFunctionLibraryFile(application, LIBRARY_ID, dialog))?.version).toBe(1)
    expect(save).toHaveBeenCalledTimes(1)

    stored = { ...stored, content: { ...stored.content, name: '已修改函数库' } }
    expect((await exportLocalFunctionLibraryFile(application, LIBRARY_ID, dialog))?.version).toBe(2)
    expect(save).toHaveBeenCalledTimes(2)
    expect(written.map((value) => JSON.parse(value).version)).toEqual([1, 1, 2])
  })

  it('registers a selected release and rejects malformed files', async () => {
    const register = vi.fn().mockImplementation(async (release) => release)
    const application = functionLibraryApplication({}, { register })
    const release = {
      libraryId: LIBRARY_ID,
      version: 3,
      contentHash: `sha256:${'a'.repeat(64)}`,
      content: { name: '导入库', functions: [] }
    }
    const dialog = {
      readText: vi
        .fn()
        .mockResolvedValue({ name: 'library.lsfunclib', data: JSON.stringify(release) }),
      writeText: vi.fn()
    }

    await expect(importFunctionLibraryFile(application, dialog)).resolves.toEqual(release)
    expect(register).toHaveBeenCalledWith(release)

    dialog.readText.mockResolvedValue({ name: 'broken.lsfunclib', data: '{' })
    await expect(importFunctionLibraryFile(application, dialog)).rejects.toThrow(
      '函数库文件不是有效的 JSON'
    )
  })
})

function library(): LocalFunctionLibraryDocument {
  return {
    libraryId: LIBRARY_ID,
    revision: 1,
    content: { name: '本地函数库', functions: [] },
    editorState: { library: {}, functions: {} }
  }
}

function functionLibraryApplication(
  local: Record<string, unknown> = {},
  imported: Record<string, unknown> = {}
): TemplateApplication {
  return {
    functionLibraries: {
      local,
      imported
    }
  } as unknown as TemplateApplication
}
