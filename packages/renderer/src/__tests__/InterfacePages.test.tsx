// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskProgressSnapshot } from '@ls101/core-types'
import type {
  InterfaceAIGenerationHandle,
  InterfaceAIGenerationResult,
  InterfaceApplication,
  InterfaceDraft
} from '@ls101/interface-editor'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { AppToaster } from '../components/ui/ToastViewport'
import { toast } from '../components/ui/toast'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
import { InterfaceDetailsPage } from '../features/interfaces/InterfaceDetailsPage'
import { InterfaceExportPage } from '../features/interfaces/InterfaceExportPage'
import { InterfaceDraftEditorPage } from '../features/interfaces/InterfaceDraftEditorPage'
import { InterfaceDraftListRedirect } from '../features/interfaces/InterfaceDraftListPage'
import { InterfaceInstanceEditorPage } from '../features/interfaces/InterfaceInstanceEditorPage'
import { InterfaceListPage } from '../features/interfaces/InterfaceListPage'
import { BuiltinInterfaceMaintenanceDialog } from '../features/interfaces/BuiltinInterfaceMaintenanceDialog'
import type { BuiltinInterfaceMaintenance } from '../features/interfaces/BuiltinInterfaceMaintenance'

const imageInputMocks = vi.hoisted(() => ({
  readBinary: vi.fn(),
  writeBinary: vi.fn(),
  readClipboardImage: vi.fn()
}))

vi.mock('@ls101/file-dialog/renderer', () => ({
  fileDialog: {
    readBinary: imageInputMocks.readBinary,
    writeBinary: imageInputMocks.writeBinary
  }
}))

vi.mock('@ls101/clipboard/renderer', () => ({
  imageClipboard: { readImage: imageInputMocks.readClipboardImage }
}))

afterEach(() => {
  imageInputMocks.readBinary.mockReset()
  imageInputMocks.writeBinary.mockReset()
  imageInputMocks.readClipboardImage.mockReset()
  toast.dismiss()
  cleanup()
})

const draft: InterfaceDraft = {
  draftId: '10000000-0000-4000-8000-000000000001',
  name: '听说测试',
  description: '用于课堂练习',
  promptTemplate: '生成一套听说练习',
  fields: {
    order: ['question'],
    nodes: {
      question: {
        type: 'text',
        varName: 'questionText',
        description: '题干',
        example: 'What did the speaker say?'
      }
    }
  }
}

function application(overrides: Record<string, unknown> = {}): InterfaceApplication {
  return {
    browser: {
      listDrafts: vi.fn().mockResolvedValue([]),
      listPublished: vi.fn().mockResolvedValue([])
    },
    drafts: {
      create: vi.fn().mockResolvedValue(draft),
      get: vi.fn().mockResolvedValue(draft),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn()
    },
    published: {},
    instances: {},
    transfer: {},
    ...overrides
  } as unknown as InterfaceApplication
}

describe('Interface pages', () => {
  it('offers delete or backup when a bundled Interface is removed', async () => {
    const previous = { ...draft, id: `sha256:${'a'.repeat(64)}` }
    const plan = {
      kind: 'removal' as const,
      builtinKey: 'speaking',
      previous,
      instanceIds: ['10000000-0000-4000-8000-000000000001'],
      referenceCount: 2
    }
    const resolve = vi.fn().mockResolvedValue(undefined)
    const snapshot = [plan]
    const maintenance: BuiltinInterfaceMaintenance = {
      initialize: vi.fn(),
      resolve,
      dismiss: vi.fn(),
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot
    }

    render(<BuiltinInterfaceMaintenanceDialog maintenance={maintenance} />)

    expect(screen.getByRole('heading', { name: '内置题型已从应用中移除' })).toBeInTheDocument()
    expect(screen.getByText(/1 个题组/)).toBeInTheDocument()
    expect(screen.getByText(/2 处引用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保留旧版' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(plan, 'delete'))
  })

  it('shows builtin Interfaces and reloads after builtin maintenance changes', async () => {
    const interfaceId = `sha256:${'9'.repeat(64)}`
    const listPublished = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          interfaceId,
          name: '上海高考听说',
          description: '内置题型',
          source: { type: 'builtin' as const, builtinKey: 'shanghai-gaokao-speaking' },
          instanceCount: 0
        }
      ])
    const app = application({
      browser: { listDrafts: vi.fn().mockResolvedValue([]), listPublished }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces']}>
          <InterfaceListPage />
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByText('暂无题型')).toBeInTheDocument()
    window.dispatchEvent(new Event('interface-builtins-changed'))

    expect(await screen.findByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(listPublished).toHaveBeenCalledTimes(2)
  })

  it('edits a nested field tree and reports publish validation before succeeding', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const publish = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'invalid',
        errors: [{ code: 'EMPTY_VAR_NAME', path: 'group1.field1' }]
      })
      .mockResolvedValueOnce({
        status: 'published',
        interface: {
          interfaceId: `sha256:${'8'.repeat(64)}`,
          name: '听说测试',
          description: '用于课堂练习',
          source: { type: 'published' },
          instanceCount: 0
        }
      })
    const app = application({
      drafts: {
        create: vi.fn().mockResolvedValue(draft),
        get: vi.fn().mockResolvedValue(draft),
        save,
        delete: vi.fn(),
        publish
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/drafts/${draft.draftId}`]}>
          <Routes>
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
            <Route path="/interfaces/:interfaceId" element={<div>已发布题型</div>} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    const structure = within(screen.getByRole('region', { name: '字段结构' }))
    fireEvent.click(screen.getByRole('button', { name: '添加字段组' }))
    expect(structure.getByText('选中此字段组后，新字段会添加到组内。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加字段' }))

    const field = structure.getByRole('button', { name: /field1/ })
    fireEvent.click(field)
    fireEvent.change(structure.getByLabelText('类型'), { target: { value: 'image' } })
    fireEvent.change(structure.getByLabelText('变量名'), { target: { value: 'pictureText' } })
    fireEvent.change(structure.getByLabelText('描述'), { target: { value: '配图提示词' } })
    fireEvent.change(structure.getByLabelText('示例'), { target: { value: '示例图片提示词' } })
    const keyInput = structure.getByLabelText('字段标识')
    fireEvent.change(keyInput, { target: { value: 'picture' } })
    fireEvent.blur(keyInput)
    expect(structure.getByRole('button', { name: /picture/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '发布当前题型草稿？' })).getByRole('button', {
        name: '发布题型'
      })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('变量名不能为空')
    expect(publish).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ draftId: draft.draftId }))

    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '发布当前题型草稿？' })).getByRole('button', {
        name: '发布题型'
      })
    )
    expect(await screen.findByText('已发布题型')).toBeInTheDocument()
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('saves an instance, replaces values from JSON, and preserves invalid state', async () => {
    const interfaceId = `sha256:${'7'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000005'
    const initial = {
      interfaceId,
      instance: {
        instanceId,
        name: '原题组',
        generatedAt: '2026-08-05T00:00:00.000Z',
        values: { questionText: '旧内容' }
      },
      assetUrls: {}
    }
    const saved = {
      ...initial,
      instance: { ...initial.instance, name: '已保存题组', values: { questionText: '手动内容' } }
    }
    const replaced = {
      ...saved,
      instance: { ...saved.instance, values: { questionText: 'JSON 内容' } }
    }
    const save = vi.fn().mockResolvedValue(saved)
    const replaceFromJson = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'invalid-json',
        errors: [{ path: '', message: 'JSON 格式不合法' }]
      })
      .mockResolvedValueOnce({ status: 'replaced', instance: replaced })
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        })
      },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listImageGenerationProviders: vi.fn().mockResolvedValue([]),
        save,
        replaceFromJson,
        startAIGeneration: vi.fn(),
        generateImage: vi.fn()
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '原题组' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('题组名称'), { target: { value: '已保存题组' } })
    fireEvent.change(screen.getByLabelText('question 内容'), { target: { value: '手动内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(interfaceId, instanceId, {
        name: '已保存题组',
        values: { questionText: '手动内容' },
        imagePrompts: {},
        imageFiles: {}
      })
    )
    expect(await screen.findByText('题组已保存')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '高级操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '从 JSON 覆盖' }))
    fireEvent.change(screen.getByLabelText('JSON 内容'), { target: { value: '{broken' } })
    fireEvent.click(screen.getByRole('button', { name: '校验并覆盖' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '校验并覆盖'
      })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('JSON 格式不合法')
    expect(screen.getByDisplayValue('手动内容')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('JSON 内容'), {
      target: { value: '{"question":"JSON 内容"}' }
    })
    fireEvent.click(screen.getByRole('button', { name: '校验并覆盖' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '校验并覆盖'
      })
    )
    expect(await screen.findByDisplayValue('JSON 内容')).toBeInTheDocument()
    expect(await screen.findByText('已从 JSON 更新题组')).toBeInTheDocument()
    expect(replaceFromJson).toHaveBeenNthCalledWith(1, interfaceId, instanceId, '{broken')
    expect(replaceFromJson).toHaveBeenNthCalledWith(
      2,
      interfaceId,
      instanceId,
      '{"question":"JSON 内容"}'
    )
  })

  it('deletes an instance from the details page after confirmation', async () => {
    const interfaceId = `sha256:${'6'.repeat(64)}`
    const instance = {
      instanceId: '20000000-0000-4000-8000-000000000006',
      name: '待删除题组',
      generatedAt: '2026-08-06T00:00:00.000Z'
    }
    const listInstances = vi.fn().mockResolvedValueOnce([instance]).mockResolvedValueOnce([])
    const deleteInstance = vi.fn().mockResolvedValue(undefined)
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        }),
        listInstances,
        getPrompts: vi.fn().mockResolvedValue(null),
        createBlankInstance: vi.fn(),
        copyToDraft: vi.fn()
      },
      instances: { delete: deleteInstance }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}`]}>
          <Routes>
            <Route path="/interfaces/:interfaceId" element={<InterfaceDetailsPage />} />
            <Route path="/interfaces/:interfaceId/export" element={<InterfaceExportPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('button', { name: '待删除题组' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '题组操作：待删除题组' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '删除题组' }))
    expect(screen.getByRole('alertdialog', { name: '删除题组“待删除题组”？' })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(deleteInstance).toHaveBeenCalledWith(interfaceId, instance.instanceId)
    )
    expect(await screen.findByText('暂无题组')).toBeInTheDocument()
    expect(screen.getByText('已删除题组“待删除题组”')).toBeInTheDocument()
  })

  it('guards leaving an instance with unsaved changes', async () => {
    const interfaceId = `sha256:${'5'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000007'
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        })
      },
      instances: {
        get: vi.fn().mockResolvedValue({
          interfaceId,
          instance: {
            instanceId,
            name: '离开确认题组',
            generatedAt: '2026-08-07T00:00:00.000Z',
            values: { questionText: '原内容' }
          },
          assetUrls: {}
        }),
        listImageGenerationProviders: vi.fn().mockResolvedValue([])
      }
    })

    function DetailsRoute(): JSX.Element {
      const navigate = useNavigate()
      return <button onClick={() => navigate(`/interfaces/${interfaceId}`)}>题型详情</button>
    }

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
            <Route path="/interfaces/:interfaceId" element={<DetailsRoute />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByDisplayValue('原内容')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('question 内容'), { target: { value: '未保存内容' } })
    fireEvent.click(screen.getByRole('button', { name: '返回题型详情' }))
    const dialog = screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })
    expect(dialog).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByDisplayValue('未保存内容')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回题型详情' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: '放弃修改' })
    )
    expect(await screen.findByRole('button', { name: '题型详情' })).toBeInTheDocument()
  })

  it('shows published interfaces and the draft entry', async () => {
    const app = application({
      browser: {
        listDrafts: vi.fn().mockResolvedValue([]),
        listPublished: vi.fn().mockResolvedValue([
          {
            interfaceId: `sha256:${'a'.repeat(64)}`,
            name: '上海高考听说',
            description: '高考听说模拟题型',
            source: { type: 'published' },
            instanceCount: 3
          }
        ])
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces']}>
          <InterfaceListPage />
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(screen.getByRole('heading', { name: '题型库' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '草稿' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    expect(screen.getByText('3 个题组')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '进入' })).not.toBeInTheDocument()
    expect(screen.queryByText('正式')).not.toBeInTheDocument()
  })

  it('switches between published interfaces and drafts without reloading the library', async () => {
    const listDrafts = vi.fn().mockResolvedValue([draft])
    const listPublished = vi.fn().mockResolvedValue([
      {
        interfaceId: `sha256:${'a'.repeat(64)}`,
        name: '上海高考听说',
        description: '高考听说模拟题型',
        source: { type: 'published' as const },
        instanceCount: 3
      }
    ])
    const app = application({ browser: { listDrafts, listPublished } })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces']}>
          <InterfaceListPage />
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '草稿' }))
    expect(screen.getByRole('button', { name: '听说测试' })).toBeInTheDocument()
    expect(screen.queryByText('正在加载草稿...')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '题型' }))
    expect(screen.getByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    expect(listPublished).toHaveBeenCalledOnce()
    expect(listDrafts).toHaveBeenCalledOnce()
  })

  it('creates a real draft and enters the focus editor route', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces?view=drafts']}>
          <Routes>
            <Route path="/interfaces" element={<InterfaceListPage />} />
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    await waitFor(() => expect(screen.queryByText('正在加载草稿...')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新建题型' }))

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    expect(app.drafts.create).toHaveBeenCalledOnce()
    expect(app.drafts.get).toHaveBeenCalledWith(draft.draftId)
    expect(screen.getByRole('region', { name: '字段结构' })).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })

  it('redirects the previous draft list route to the unified library view', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces/drafts']}>
          <Routes>
            <Route path="/interfaces" element={<InterfaceListPage />} />
            <Route path="/interfaces/drafts" element={<InterfaceDraftListRedirect />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('tab', { name: '草稿' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('button', { name: '新建题型' })).toBeInTheDocument()
  })

  it('uses a toast for draft save completion', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/drafts/${draft.draftId}`]}>
          <Routes>
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '听说测试更新' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(app.drafts.save).toHaveBeenCalledOnce())
    expect(await screen.findByText('草稿已保存')).toBeInTheDocument()
    expect(screen.queryByText('已保存')).not.toBeInTheDocument()
  })

  it('copies each prompt artifact from interface details', async () => {
    const interfaceId = `sha256:${'a'.repeat(64)}`
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        }),
        listInstances: vi.fn().mockResolvedValue([]),
        getPrompts: vi.fn().mockResolvedValue({
          prompt: '单独提示词',
          formatInstructions: '格式说明',
          fullPrompt: '完整提示词',
          jsonSchema: '{"type":"object"}',
          jsonExample: '{"question":"example"}'
        })
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}`]}>
          <Routes>
            <Route path="/interfaces/:interfaceId" element={<InterfaceDetailsPage />} />
            <Route path="/interfaces/:interfaceId/export" element={<InterfaceExportPage />} />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByText('题型定义')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '题型定义' }))
    expect(screen.getByRole('button', { name: '复制完整提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制单独提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Schema' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Example' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制 JSON Schema' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"type":"object"}'))
    expect(await screen.findByText('已复制JSON Schema')).toBeInTheDocument()
  })

  it('does not report a successful export when the save dialog is cancelled', async () => {
    const interfaceId = `sha256:${'f'.repeat(64)}`
    const exportInterface = vi.fn().mockResolvedValue({ status: 'cancelled' })
    const successToast = vi.spyOn(toast, 'success')
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        }),
        listInstances: vi.fn().mockResolvedValue([
          {
            instanceId: '20000000-0000-4000-8000-000000000099',
            name: '导出测试题组',
            generatedAt: '2026-08-10T00:00:00.000Z'
          }
        ]),
        getPrompts: vi.fn().mockResolvedValue(null)
      },
      transfer: { export: exportInterface }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}`]}>
          <Routes>
            <Route path="/interfaces/:interfaceId" element={<InterfaceDetailsPage />} />
            <Route path="/interfaces/:interfaceId/export" element={<InterfaceExportPage />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('tab', { name: '题型定义' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '题型定义' }))
    fireEvent.click(screen.getByRole('button', { name: '导出题型' }))

    expect(await screen.findByRole('heading', { name: '选择要交付的题组' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导出题型' }))
    await waitFor(() =>
      expect(exportInterface).toHaveBeenCalledWith(interfaceId, {
        mode: 'selected',
        instanceIds: ['20000000-0000-4000-8000-000000000099']
      })
    )
    expect(successToast).not.toHaveBeenCalledWith('题型已导出')
  })

  it('runs AI generation, locks editing, and applies the completed instance', async () => {
    const interfaceId = `sha256:${'b'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000001'
    const initial = {
      interfaceId,
      instance: {
        instanceId,
        name: '第一套题组',
        generatedAt: '2026-08-02T00:00:00.000Z',
        values: { questionText: '旧题目' }
      },
      assetUrls: {}
    }
    const completed = {
      ...initial,
      instance: {
        ...initial.instance,
        values: { questionText: 'AI 新题目' }
      }
    }
    let resolveCompletion: (result: InterfaceAIGenerationResult) => void = () => undefined
    const completion = new Promise<InterfaceAIGenerationResult>((resolve) => {
      resolveCompletion = resolve
    })
    let snapshot: TaskProgressSnapshot = {
      items: [
        { id: 'ai', label: 'AI 生成', status: 'running' },
        { id: 'validate', label: '校验生成结果', status: 'waiting' },
        { id: 'save', label: '保存实例', status: 'waiting' }
      ]
    }
    const progressListeners = new Set<() => void>()
    const publishSnapshot = (next: TaskProgressSnapshot): void => {
      snapshot = next
      for (const listener of progressListeners) listener()
    }
    const handle: InterfaceAIGenerationHandle = {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        progressListeners.add(listener)
        return () => progressListeners.delete(listener)
      },
      cancel: vi.fn(),
      retry: vi.fn(),
      completion
    }
    const models = [
      { providerId: 'provider-a', providerName: 'Provider A', modelId: 'model-a' },
      { providerId: 'provider-b', providerName: 'Provider B', modelId: 'model-b' }
    ]
    const listAIGenerationModels = vi.fn().mockResolvedValue(models)
    const startAIGeneration = vi.fn().mockResolvedValue(handle)
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        })
      },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listAIGenerationModels,
        save: vi.fn(),
        replaceFromJson: vi.fn(),
        startAIGeneration
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '第一套题组' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '高级操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '从 JSON 覆盖' }))
    const jsonDialog = screen.getByRole('dialog', { name: '从 JSON 覆盖题组' })
    expect(jsonDialog).toBeInTheDocument()
    fireEvent.click(within(jsonDialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '从 JSON 覆盖题组' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成并覆盖' }))

    expect(screen.getByRole('dialog', { name: 'AI 生成并覆盖' })).toBeInTheDocument()
    await waitFor(() => expect(listAIGenerationModels).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('生成模型'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '生成并覆盖' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '生成并覆盖'
      })
    )

    await waitFor(() =>
      expect(startAIGeneration).toHaveBeenCalledWith(interfaceId, instanceId, {
        model: { providerId: 'provider-b', modelId: 'model-b' }
      })
    )
    expect(screen.getByRole('region', { name: 'AI 生成进度' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('旧题目')).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回题型详情' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '高级操作' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '生成中' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '返回题组' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消生成' })).toBeEnabled()

    act(() => {
      publishSnapshot({
        items: [
          { id: 'ai', label: 'AI 生成', status: 'completed' },
          { id: 'validate', label: '校验生成结果', status: 'completed' },
          { id: 'save', label: '保存实例', status: 'running' }
        ]
      })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '正在保存' })).toBeDisabled())
    expect(screen.queryByRole('button', { name: '取消生成' })).not.toBeInTheDocument()

    await act(async () => {
      resolveCompletion({ status: 'completed', instance: completed })
      await completion
    })

    expect(await screen.findByDisplayValue('AI 新题目')).toBeEnabled()
    expect(await screen.findByText('AI 生成内容已保存')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'AI 生成并覆盖' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI 生成进度' })).toBeInTheDocument()
    expect(screen.getByText('生成完成')).toBeInTheDocument()
    expect(screen.getByLabelText('生成模型')).toBeEnabled()
    expect(screen.getByRole('button', { name: '返回题型详情' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '高级操作' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'AI 生成并覆盖' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '生成并覆盖'
      })
    )
    await waitFor(() => expect(startAIGeneration).toHaveBeenCalledTimes(2))
    expect(startAIGeneration).toHaveBeenNthCalledWith(2, interfaceId, instanceId, {
      model: { providerId: 'provider-b', modelId: 'model-b' }
    })
    expect(await screen.findByRole('button', { name: '重新生成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '返回题组' }))

    expect(screen.queryByRole('dialog', { name: 'AI 生成并覆盖' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'AI 生成进度' })).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('AI 新题目')).toBeEnabled()
  })

  it('keeps image prompts while selecting, replacing, and removing an image', async () => {
    const interfaceId = `sha256:${'d'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000003'
    const definition = {
      ...draft,
      id: interfaceId,
      fields: {
        order: ['picture'],
        nodes: {
          picture: {
            type: 'image' as const,
            varName: 'questionImage',
            description: '题目配图',
            example: '一名学生站在操场上'
          }
        }
      }
    }
    const initial = {
      interfaceId,
      instance: {
        instanceId,
        name: '图片题组',
        generatedAt: '2026-08-03T00:00:00.000Z',
        values: { questionImage: '' },
        imagePrompts: { questionImage: '原始图片提示词' }
      },
      assetUrls: {}
    }
    const fileBytes = new Uint8Array([1, 2, 3])
    const clipboardBytes = new Uint8Array([4, 5, 6])
    const generatedBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    imageInputMocks.readBinary.mockResolvedValue({ name: 'local.png', data: fileBytes })
    imageInputMocks.readClipboardImage.mockResolvedValue(clipboardBytes)
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:file-preview')
      .mockReturnValueOnce('blob:clipboard-preview')
      .mockReturnValueOnce('blob:generated-preview')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    let savedFilename = ''
    const save = vi.fn().mockImplementation(
      async (
        _interfaceId: string,
        _instanceId: string,
        edit: {
          values: Record<string, string>
          imagePrompts?: Record<string, string>
          imageFiles?: Record<string, Uint8Array | null>
        }
      ) => {
        if (Object.hasOwn(edit.imageFiles ?? {}, 'questionImage')) {
          savedFilename = edit.imageFiles?.questionImage ? 'questionImage-saved.png' : ''
        }
        return {
          ...initial,
          instance: {
            ...initial.instance,
            values: { questionImage: savedFilename },
            imagePrompts: edit.imagePrompts
          },
          assetUrls: savedFilename ? { [savedFilename]: `asset://local/${savedFilename}` } : {}
        }
      }
    )
    const replaceFromJson = vi.fn().mockResolvedValue({ status: 'replaced', instance: initial })
    const app = application({
      published: { get: vi.fn().mockResolvedValue({ definition, source: { type: 'published' } }) },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listAIGenerationModels: vi.fn().mockResolvedValue([]),
        listImageGenerationProviders: vi
          .fn()
          .mockResolvedValue([{ providerId: 'manual', providerName: '手动生成' }]),
        save,
        replaceFromJson,
        startAIGeneration: vi.fn(),
        generateImage: vi.fn().mockResolvedValue(generatedBytes)
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByDisplayValue('原始图片提示词')).toBeInTheDocument()
    expect(screen.getByText('尚未选择图片')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '高级操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '从 JSON 覆盖' }))
    expect(screen.getByLabelText('图像 Provider')).toBeInTheDocument()
    expect(screen.queryByLabelText('生成模型')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('JSON 内容'), {
      target: { value: '{"picture":"JSON 图片提示词"}' }
    })
    const replaceButton = screen.getByRole('button', { name: '校验并覆盖' })
    await waitFor(() => expect(replaceButton).toBeEnabled())
    fireEvent.click(replaceButton)
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '校验并覆盖'
      })
    )
    await waitFor(() =>
      expect(replaceFromJson).toHaveBeenCalledWith(
        interfaceId,
        instanceId,
        '{"picture":"JSON 图片提示词"}',
        { imageProvider: { providerId: 'manual' } }
      )
    )

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }))
    await waitFor(() => expect(imageInputMocks.readBinary).toHaveBeenCalledOnce())
    expect(await screen.findByAltText('picture预览')).toHaveAttribute('src', 'blob:file-preview')

    fireEvent.click(screen.getByRole('button', { name: '从剪贴板读取' }))
    await waitFor(() => expect(imageInputMocks.readClipboardImage).toHaveBeenCalledOnce())
    expect(await screen.findByAltText('picture预览')).toHaveAttribute(
      'src',
      'blob:clipboard-preview'
    )
    expect(screen.getByText('剪贴板图片.png')).toBeInTheDocument()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:file-preview')

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith(interfaceId, instanceId, {
      name: '图片题组',
      values: { questionImage: '' },
      imagePrompts: { questionImage: '原始图片提示词' },
      imageFiles: { questionImage: clipboardBytes }
    })
    expect(await screen.findByAltText('picture预览')).toHaveAttribute(
      'src',
      'asset://local/questionImage-saved.png'
    )

    expect(screen.getByDisplayValue('原始图片提示词')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('picture图片提示词'), {
      target: { value: '新的图片提示词' }
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenLastCalledWith(interfaceId, instanceId, {
      name: '图片题组',
      values: { questionImage: 'questionImage-saved.png' },
      imagePrompts: { questionImage: '新的图片提示词' },
      imageFiles: {}
    })
    expect(screen.getByAltText('picture预览')).toHaveAttribute(
      'src',
      'asset://local/questionImage-saved.png'
    )

    const removeImageButton = screen.getByRole('button', { name: '移除图片' })
    await waitFor(() => expect(removeImageButton).toBeEnabled())
    fireEvent.click(removeImageButton)
    expect(screen.getByDisplayValue('新的图片提示词')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.queryByAltText('picture预览')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('新的图片提示词')).toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await waitFor(() =>
      expect(app.instances.generateImage).toHaveBeenCalledWith('新的图片提示词', {
        signal: expect.any(AbortSignal),
        provider: { providerId: 'manual' }
      })
    )
    expect(await screen.findByAltText('picture预览')).toHaveAttribute(
      'src',
      'blob:generated-preview'
    )
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(save).toHaveBeenLastCalledWith(interfaceId, instanceId, {
      name: '图片题组',
      values: { questionImage: 'questionImage-saved.png' },
      imagePrompts: { questionImage: '新的图片提示词' },
      imageFiles: { questionImage: generatedBytes }
    })
  })

  it('generates prompted images sequentially and saves them as one replacement', async () => {
    const interfaceId = `sha256:${'e'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000004'
    const definition = {
      ...draft,
      id: interfaceId,
      fields: {
        order: ['first', 'second', 'third'],
        nodes: {
          first: {
            type: 'image' as const,
            varName: 'firstImage',
            description: '第一张图',
            example: '一座山'
          },
          second: {
            type: 'image' as const,
            varName: 'secondImage',
            description: '第二张图',
            example: '一片海'
          },
          third: {
            type: 'image' as const,
            varName: 'thirdImage',
            description: '没有提示词的图片',
            example: '一片森林'
          }
        }
      }
    }
    const initial = {
      interfaceId,
      instance: {
        instanceId,
        name: '批量生图题组',
        generatedAt: '2026-08-04T00:00:00.000Z',
        values: {
          firstImage: 'first-old.png',
          secondImage: 'second-old.png',
          thirdImage: 'third-old.png'
        },
        imagePrompts: {
          firstImage: '山的提示词',
          secondImage: '海的提示词',
          thirdImage: '森林的提示词'
        }
      },
      assetUrls: {
        'first-old.png': 'asset://local/first-old.png',
        'second-old.png': 'asset://local/second-old.png',
        'third-old.png': 'asset://local/third-old.png'
      }
    }
    const firstImage = new Uint8Array([1, 2, 3])
    const secondImage = new Uint8Array([4, 5, 6])
    const thirdImage = new Uint8Array([7, 8, 9])
    let resolveFirst!: (data: Uint8Array) => void
    const firstPending = new Promise<Uint8Array>((resolve) => {
      resolveFirst = resolve
    })
    const generateImage = vi
      .fn()
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce(secondImage)
      .mockResolvedValueOnce(thirdImage)
    const saved = {
      ...initial,
      instance: {
        ...initial.instance,
        values: {
          firstImage: 'first-new.png',
          secondImage: 'second-new.png',
          thirdImage: 'third-old.png'
        }
      },
      assetUrls: {
        ...initial.assetUrls,
        'first-new.png': 'asset://local/first-new.png',
        'second-new.png': 'asset://local/second-new.png'
      }
    }
    const save = vi.fn().mockResolvedValue(saved)
    const app = application({
      published: { get: vi.fn().mockResolvedValue({ definition, source: { type: 'published' } }) },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listImageGenerationProviders: vi
          .fn()
          .mockResolvedValue([
            { providerId: 'image-api', providerName: '图片 API', modelId: 'image-1' }
          ]),
        save,
        generateImage
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '批量生图题组' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '批量生图' }))
    expect(screen.getByRole('dialog', { name: 'AI 生图' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始生图' }))
    await waitFor(() => expect(generateImage).toHaveBeenCalledOnce())
    expect(generateImage).toHaveBeenCalledWith('山的提示词', {
      signal: expect.any(AbortSignal),
      provider: { providerId: 'image-api', modelId: 'image-1' }
    })
    expect(generateImage).toHaveBeenCalledTimes(1)

    resolveFirst(firstImage)
    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(3))
    expect(generateImage).toHaveBeenNthCalledWith(2, '海的提示词', {
      signal: expect.any(AbortSignal),
      provider: { providerId: 'image-api', modelId: 'image-1' }
    })
    expect(generateImage).toHaveBeenNthCalledWith(3, '森林的提示词', {
      signal: expect.any(AbortSignal),
      provider: { providerId: 'image-api', modelId: 'image-1' }
    })
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith(interfaceId, instanceId, {
      name: '批量生图题组',
      values: initial.instance.values,
      imagePrompts: initial.instance.imagePrompts,
      imageFiles: { firstImage, secondImage, thirdImage }
    })
    expect(await screen.findByText('生图完成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回题组' })).toBeInTheDocument()
  })

  it('keeps AI failures in the AI pane and allows retrying', async () => {
    const interfaceId = `sha256:${'c'.repeat(64)}`
    const instanceId = '20000000-0000-4000-8000-000000000002'
    const initial = {
      interfaceId,
      instance: {
        instanceId,
        name: '失败测试题组',
        generatedAt: '2026-08-02T00:00:00.000Z',
        values: { questionText: '原题目' }
      },
      assetUrls: {}
    }
    const result: InterfaceAIGenerationResult = {
      status: 'failed',
      message: '生成服务暂时不可用'
    }
    const snapshot: TaskProgressSnapshot = {
      items: [{ id: 'ai', label: 'AI 生成', status: 'completed' }]
    }
    let rejectRetryStart: (reason: Error) => void = () => undefined
    const retryStarting = new Promise<InterfaceAIGenerationHandle>((_resolve, reject) => {
      rejectRetryStart = reject
    })
    const cancel = vi.fn()
    const retry = vi.fn()
    const handle: InterfaceAIGenerationHandle = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      cancel,
      retry,
      completion: Promise.resolve(result)
    }
    retry.mockReturnValueOnce(retryStarting).mockResolvedValueOnce(handle)
    const startAIGeneration = vi.fn().mockResolvedValue(handle)
    const app = application({
      published: {
        get: vi.fn().mockResolvedValue({
          definition: { ...draft, id: interfaceId },
          source: { type: 'published' }
        })
      },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listAIGenerationModels: vi
          .fn()
          .mockResolvedValue([
            { providerId: 'provider-a', providerName: 'Provider A', modelId: 'model-a' }
          ]),
        save: vi.fn(),
        replaceFromJson: vi.fn(),
        startAIGeneration
      }
    })

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={[`/interfaces/${interfaceId}/instances/${instanceId}`]}>
          <Routes>
            <Route
              path="/interfaces/:interfaceId/instances/:instanceId"
              element={<InterfaceInstanceEditorPage />}
            />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByRole('heading', { name: '失败测试题组' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成并覆盖' }))
    await waitFor(() => expect(screen.getByLabelText('生成模型')).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '生成并覆盖' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: '覆盖当前题组内容？' })).getByRole('button', {
        name: '生成并覆盖'
      })
    )

    expect(await screen.findByText('生成失败')).toBeInTheDocument()
    expect(screen.getByText('生成服务暂时不可用')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从失败位置重试' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回题组' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '从失败位置重试' }))
    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '正在启动' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '取消生成' })).not.toBeInTheDocument()
    expect(cancel).not.toHaveBeenCalled()
    await act(async () => {
      rejectRetryStart(new Error('实例暂时忙碌'))
      await retryStarting.catch(() => undefined)
    })
    expect(await screen.findByText(/续跑启动失败：实例暂时忙碌/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从失败位置重试' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '从失败位置重试' }))
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(2))
    expect(startAIGeneration).toHaveBeenCalledOnce()
  })
})
