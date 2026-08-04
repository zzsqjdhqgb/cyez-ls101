// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskProgressHandle, TaskProgressSnapshot } from '@ls101/core-types'
import type {
  InterfaceAIGenerationResult,
  InterfaceApplication,
  InterfaceDraft
} from '@ls101/interface-editor'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppToaster } from '../components/ui/ToastViewport'
import { toast } from '../components/ui/toast'
import { InterfaceApplicationProvider } from '../features/interfaces/InterfaceApplicationProvider'
import { InterfaceDetailsPage } from '../features/interfaces/InterfaceDetailsPage'
import { InterfaceDraftEditorPage } from '../features/interfaces/InterfaceDraftEditorPage'
import { InterfaceDraftListPage } from '../features/interfaces/InterfaceDraftListPage'
import { InterfaceInstanceEditorPage } from '../features/interfaces/InterfaceInstanceEditorPage'
import { InterfaceListPage } from '../features/interfaces/InterfaceListPage'

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

    expect(screen.getByRole('heading', { name: '题型' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '草稿' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '上海高考听说' })).toBeInTheDocument()
    expect(screen.getByText('3 个题组')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '进入' })).toBeInTheDocument()
    expect(screen.queryByText('正式')).not.toBeInTheDocument()
  })

  it('creates a real draft and enters the focus editor route', async () => {
    const app = application()

    render(
      <InterfaceApplicationProvider application={app}>
        <MemoryRouter initialEntries={['/interfaces/drafts']}>
          <Routes>
            <Route path="/interfaces/drafts" element={<InterfaceDraftListPage />} />
            <Route path="/interfaces/drafts/:draftId" element={<InterfaceDraftEditorPage />} />
          </Routes>
        </MemoryRouter>
      </InterfaceApplicationProvider>
    )

    await waitFor(() => expect(screen.queryByText('正在加载草稿...')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '新建草稿' }))

    expect(await screen.findByRole('heading', { name: '听说测试' })).toBeInTheDocument()
    expect(app.drafts.create).toHaveBeenCalledOnce()
    expect(app.drafts.get).toHaveBeenCalledWith(draft.draftId)
    expect(screen.getByRole('region', { name: '字段结构' })).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(2)
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
          </Routes>
        </MemoryRouter>
        <AppToaster />
      </InterfaceApplicationProvider>
    )

    expect(await screen.findByText('题型定义')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制完整提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制单独提示词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Schema' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制 JSON Example' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制 JSON Schema' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"type":"object"}'))
    expect(await screen.findByText('已复制JSON Schema')).toBeInTheDocument()
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
    const snapshot: TaskProgressSnapshot = {
      items: [
        { id: 'ai', label: 'AI 生成', status: 'running' },
        { id: 'validate', label: '校验生成结果', status: 'waiting' },
        { id: 'save', label: '保存实例', status: 'waiting' }
      ]
    }
    const handle: TaskProgressHandle<InterfaceAIGenerationResult> = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      cancel: vi.fn(),
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
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    expect(screen.getByRole('complementary', { name: 'JSON 覆盖' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }))

    expect(screen.queryByRole('complementary', { name: 'JSON 覆盖' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'AI 生成' })).toBeInTheDocument()
    await waitFor(() => expect(listAIGenerationModels).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('生成模型'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    await waitFor(() =>
      expect(startAIGeneration).toHaveBeenCalledWith(interfaceId, instanceId, {
        model: { providerId: 'provider-b', modelId: 'model-b' }
      })
    )
    expect(screen.getByRole('region', { name: 'AI 生成进度' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('旧题目')).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回题型详情' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '生成中' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument()

    await act(async () => {
      resolveCompletion({ status: 'completed', instance: completed })
      await completion
    })

    expect(await screen.findByDisplayValue('AI 新题目')).toBeEnabled()
    expect(await screen.findByText('AI 生成内容已保存')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'AI 生成' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI 生成进度' })).toBeInTheDocument()
    expect(screen.getByText('生成完成')).toBeInTheDocument()
    expect(screen.getByLabelText('生成模型')).toBeEnabled()
    expect(screen.getByRole('button', { name: '返回题型详情' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'AI 生成' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(startAIGeneration).toHaveBeenCalledTimes(2))
    expect(startAIGeneration).toHaveBeenNthCalledWith(2, interfaceId, instanceId, {
      model: { providerId: 'provider-b', modelId: 'model-b' }
    })
    expect(await screen.findByRole('button', { name: '重新生成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(screen.queryByRole('complementary', { name: 'AI 生成' })).not.toBeInTheDocument()
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
    const app = application({
      published: { get: vi.fn().mockResolvedValue({ definition, source: { type: 'published' } }) },
      instances: {
        get: vi.fn().mockResolvedValue(initial),
        listAIGenerationModels: vi.fn().mockResolvedValue([]),
        save,
        replaceFromJson: vi.fn(),
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

    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.getByDisplayValue('新的图片提示词')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(save).toHaveBeenLastCalledWith(interfaceId, instanceId, {
      name: '图片题组',
      values: { questionImage: 'questionImage-saved.png' },
      imagePrompts: { questionImage: '新的图片提示词' },
      imageFiles: { questionImage: null }
    })
    expect(screen.queryByAltText('picture预览')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('新的图片提示词')).toBeInTheDocument()
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '生成图片' }))
    await waitFor(() =>
      expect(app.instances.generateImage).toHaveBeenCalledWith('新的图片提示词', {
        signal: expect.any(AbortSignal)
      })
    )
    expect(await screen.findByAltText('picture预览')).toHaveAttribute(
      'src',
      'blob:generated-preview'
    )
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
    const handle: TaskProgressHandle<InterfaceAIGenerationResult> = {
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      cancel: vi.fn(),
      completion: Promise.resolve(result)
    }
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
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }))
    await waitFor(() => expect(screen.getByLabelText('生成模型')).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }))

    expect(await screen.findByText('生成失败')).toBeInTheDocument()
    expect(screen.getByText('生成服务暂时不可用')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(startAIGeneration).toHaveBeenCalledTimes(2))
  })
})
