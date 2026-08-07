// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateApplication, TemplateDocument } from '@ls101/template-editor'
import { useTemplateEditorSession } from '../features/templates/useTemplateEditorSession'

const TEMPLATE_ID = '10000000-0000-4000-8000-000000000001'

afterEach(cleanup)

function template(revision = 4): TemplateDocument {
  return {
    templateId: TEMPLATE_ID,
    revision,
    content: {
      name: '原模板',
      description: '',
      interfaces: [],
      root: { id: 'root', type: 'frame', children: [] },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function application(document: TemplateDocument = template()): TemplateApplication {
  return {
    browser: { listTemplates: vi.fn(), listFunctionLibraries: vi.fn() },
    templates: {
      create: vi.fn(),
      get: vi.fn().mockResolvedValue(document),
      save: vi.fn(),
      delete: vi.fn(),
      embedFunction: vi.fn(),
      insertFunctionCall: vi.fn(),
      pruneFunctionResources: vi.fn(),
      validate: vi.fn(),
      compile: vi.fn()
    },
    functionLibraries: {
      local: {}
    }
  } as unknown as TemplateApplication
}

describe('Template editor session', () => {
  it('preserves history and dirty state after save failure and permits retry', async () => {
    const source = template()
    const app = application(source)
    vi.mocked(app.templates.save)
      .mockRejectedValueOnce(new Error('Revision conflict'))
      .mockImplementationOnce(async (document) => ({ ...document, revision: 5 }))
    const { result } = renderHook(() => useTemplateEditorSession(app, TEMPLATE_ID))

    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => {
      result.current.apply({ type: 'set-template-name', value: '本地修改' })
    })
    const editedDocument = result.current.document

    let firstSave = true
    await act(async () => {
      firstSave = await result.current.save()
    })

    expect(firstSave).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(result.current.error).toBe('Revision conflict')
    expect(result.current.document).toBe(editedDocument)
    expect(result.current.document).toMatchObject({
      revision: 4,
      content: { name: '本地修改' }
    })
    expect(result.current.dirty).toBe(true)
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => result.current.undo())
    expect(result.current.document?.content.name).toBe('原模板')
    expect(result.current.dirty).toBe(false)
    act(() => result.current.redo())
    expect(result.current.document?.content.name).toBe('本地修改')
    expect(result.current.dirty).toBe(true)

    let retry = false
    await act(async () => {
      retry = await result.current.save()
    })

    expect(retry).toBe(true)
    expect(app.templates.save).toHaveBeenCalledTimes(2)
    expect(result.current.document?.revision).toBe(5)
    expect(result.current.document?.content.name).toBe('本地修改')
    expect(result.current.dirty).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('inserts a library function through the application and selects the saved node', async () => {
    const source = template()
    const app = application(source)
    const inserted: TemplateDocument = {
      ...source,
      revision: 5,
      content: {
        ...source.content,
        root: {
          ...source.content.root,
          children: [{ id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }]
        }
      }
    }
    vi.mocked(app.templates.insertFunctionCall).mockResolvedValue({
      template: inserted,
      functionRef: `sha256:${'a'.repeat(64)}`,
      callNodeId: 'page'
    })
    const { result } = renderHook(() => useTemplateEditorSession(app, TEMPLATE_ID))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let completed = false
    await act(async () => {
      completed = await result.current.insertFunctionCall(
        { source: 'builtin', libraryId: 'builtin:basic' },
        'root'
      )
    })

    expect(completed).toBe(true)
    expect(app.templates.insertFunctionCall).toHaveBeenCalledWith(
      TEMPLATE_ID,
      { source: 'builtin', libraryId: 'builtin:basic' },
      'root',
      undefined
    )
    expect(result.current.document).toEqual(inserted)
    expect(result.current.selectedNodeId).toBe('page')
    expect(result.current.dirty).toBe(false)
    expect(result.current.canUndo).toBe(true)
  })

  it('saves local edits before inserting a library function', async () => {
    const source = template()
    const app = application(source)
    vi.mocked(app.templates.save).mockImplementation(async (document) => ({
      ...document,
      revision: 5
    }))
    const inserted: TemplateDocument = {
      ...source,
      revision: 6,
      content: {
        ...source.content,
        name: '本地修改',
        root: {
          ...source.content.root,
          children: [{ id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }]
        }
      }
    }
    vi.mocked(app.templates.insertFunctionCall).mockResolvedValue({
      template: inserted,
      functionRef: `sha256:${'b'.repeat(64)}`,
      callNodeId: 'page'
    })
    const { result } = renderHook(() => useTemplateEditorSession(app, TEMPLATE_ID))

    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.apply({ type: 'set-template-name', value: '本地修改' }))
    await act(async () => {
      await result.current.insertFunctionCall(
        { source: 'builtin', libraryId: 'builtin:basic' },
        'root'
      )
    })

    expect(app.templates.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.objectContaining({ name: '本地修改' }) })
    )
    expect(app.templates.insertFunctionCall).toHaveBeenCalledWith(
      TEMPLATE_ID,
      { source: 'builtin', libraryId: 'builtin:basic' },
      'root',
      undefined
    )
    expect(result.current.document).toEqual(inserted)
    expect(result.current.dirty).toBe(false)
  })

  it('reports load failures without creating an editable history entry', async () => {
    const app = application()
    vi.mocked(app.templates.get).mockRejectedValueOnce(new Error('读取模板失败'))
    const { result } = renderHook(() => useTemplateEditorSession(app, TEMPLATE_ID))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.document).toBeNull()
    expect(result.current.error).toBe('读取模板失败')
    expect(result.current.dirty).toBe(false)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('does not add a history entry when a mutation is rejected', async () => {
    const source = template()
    const app = application(source)
    const { result } = renderHook(() => useTemplateEditorSession(app, TEMPLATE_ID))

    await waitFor(() => expect(result.current.loading).toBe(false))
    let applied = true
    act(() => {
      applied = result.current.apply({ type: 'remove-node', nodeId: 'root' })
    })

    expect(applied).toBe(false)
    expect(result.current.document).toBe(source)
    expect(result.current.document?.revision).toBe(4)
    expect(result.current.error).toBe('ROOT_NODE_IMMUTABLE: root')
    expect(result.current.dirty).toBe(false)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })
})
