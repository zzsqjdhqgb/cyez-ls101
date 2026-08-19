import type { ExamPackage } from '@ls101/core-types'
import { decodeExamPackage } from '@ls101/exam-package'
import type {
  TemplateApplication,
  TemplateCompileOptions,
  TemplateDocument
} from '@ls101/template-editor'
import { describe, expect, it, vi } from 'vitest'
import {
  createExamGenerationSession,
  exportGeneratedExam,
  fetchExamResource,
  listSpeechGenerationSelections
} from '../features/templates/TemplateExamGeneration'

describe('TemplateExamGeneration', () => {
  it('通过 file-store IPC 读取本地试卷资源', async () => {
    const readAsset = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]))
    const fetcher = vi.fn()

    const response = await fetchExamResource(
      'asset://local/interfaces/published/interface-1/picture-1.png',
      new AbortController().signal,
      { readAsset },
      fetcher
    )

    expect(readAsset).toHaveBeenCalledWith(
      'asset-key://v1/interfaces/published/interface-1/picture-1.png'
    )
    expect(fetcher).not.toHaveBeenCalled()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]))
  })

  it('只列出同时启用的提供商、模型和音色组合', async () => {
    const client = {
      listSpeechProviderConfigs: vi.fn().mockResolvedValue([
        {
          id: 'speech',
          name: '本地语音',
          kind: 'local',
          type: 'pocket-tts',
          baseUrl: '',
          modelPackageId: 'package',
          modelPackageVersion: '1',
          models: [
            { id: 'enabled-model', enabled: true },
            { id: 'disabled-model', enabled: false }
          ],
          voices: [
            { id: 'enabled-voice', enabled: true },
            { id: 'disabled-voice', enabled: false }
          ],
          hasApiKey: false
        }
      ])
    }

    await expect(listSpeechGenerationSelections(client)).resolves.toEqual([
      {
        providerConfigId: 'speech',
        providerName: '本地语音',
        modelId: 'enabled-model',
        voiceId: 'enabled-voice'
      }
    ])
  })

  it('以一条语音一个任务生成试卷、收集资源并应用试卷名称', async () => {
    const synthesizeSpeech = vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
      format: 'wav'
    })
    const application = generationApplication(['Hello'])
    const session = createExamGenerationSession(
      {
        application,
        document: template(),
        examName: '英语听说 / 第一套',
        bindings: [],
        speech: speechRouting()
      },
      {
        speechClient: { synthesizeSpeech },
        fetchResource: vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5, 6])))
      }
    )

    const handle = session.start()
    const result = await handle.completion

    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(handle.getSnapshot().items.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: '准备试卷内容', status: 'completed' },
      { label: '合成语音 1：Hello', status: 'completed' },
      { label: '整理试卷资源', status: 'completed' },
      { label: '打包试卷', status: 'completed' }
    ])
    expect(synthesizeSpeech).toHaveBeenCalledWith(
      { text: 'Hello', routing: speechRouting(), format: 'wav' },
      { signal: expect.any(AbortSignal) }
    )
    const decoded = await decodeExamPackage(result.archive)
    expect(decoded.exam.examData.title).toBe('英语听说 / 第一套')
    expect(decoded.exam.submissionTemplate.meta.examTitle).toBe('英语听说 / 第一套')
    expect(decoded.resources.picture).toEqual(new Uint8Array([4, 5, 6]))
  })

  it('单条语音额外重试三次后中断，手动重试从失败项继续', async () => {
    const synthesizeSpeech = vi
      .fn()
      .mockResolvedValueOnce(generatedAudio(1))
      .mockRejectedValueOnce(new Error('服务繁忙'))
      .mockRejectedValueOnce(new Error('服务繁忙'))
      .mockRejectedValueOnce(new Error('服务繁忙'))
      .mockRejectedValueOnce(new Error('服务繁忙'))
      .mockResolvedValueOnce(generatedAudio(2))
    const application = generationApplication(['第一条', '第二条'])
    const session = createExamGenerationSession(
      {
        application,
        document: template(),
        examName: '断点重试试卷',
        bindings: [],
        speech: speechRouting()
      },
      {
        speechClient: { synthesizeSpeech },
        fetchResource: vi.fn()
      }
    )

    const firstHandle = session.start()
    await expect(firstHandle.completion).resolves.toMatchObject({
      status: 'failed',
      message: expect.stringContaining('服务繁忙')
    })
    expect(synthesizeSpeech).toHaveBeenCalledTimes(5)
    expect(firstHandle.getSnapshot().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'speech-page-0', status: 'completed' }),
        expect.objectContaining({
          id: 'speech-page-1',
          status: 'failed',
          log: expect.objectContaining({ content: expect.stringContaining('第 4 / 4 次尝试失败') })
        })
      ])
    )

    const retryHandle = session.start()
    const retried = await retryHandle.completion

    expect(retried.status).toBe('completed')
    expect(synthesizeSpeech).toHaveBeenCalledTimes(6)
    expect(synthesizeSpeech.mock.calls.map(([request]) => request.text)).toEqual([
      '第一条',
      '第二条',
      '第二条',
      '第二条',
      '第二条',
      '第二条'
    ])
  })

  it('无语音模板显示无需处理并且不要求语音配置', async () => {
    const synthesizeSpeech = vi.fn()
    const application = generationApplication([])
    const session = createExamGenerationSession(
      {
        application,
        document: template(),
        examName: '无语音试卷',
        bindings: []
      },
      { speechClient: { synthesizeSpeech }, fetchResource: vi.fn() }
    )

    const handle = session.start()
    await expect(handle.completion).resolves.toMatchObject({ status: 'completed' })
    expect(synthesizeSpeech).not.toHaveBeenCalled()
    expect(handle.getSnapshot().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'speech-none',
          status: 'completed',
          log: { format: 'text', content: '此模板无需合成语音' }
        })
      ])
    )
  })

  it('内置模板生成使用只读 builtin API，不按同名本地 ID 编译', async () => {
    const application = generationApplication([])
    const session = createExamGenerationSession(
      {
        application,
        document: template(),
        source: 'builtin',
        examName: '内置试卷',
        bindings: []
      },
      { speechClient: { synthesizeSpeech: vi.fn() }, fetchResource: vi.fn() }
    )

    await expect(session.start().completion).resolves.toMatchObject({ status: 'completed' })
    expect(application.builtinTemplates.preview).toHaveBeenCalledWith(template().templateId, [])
    expect(application.builtinTemplates.compile).toHaveBeenCalledWith(
      template().templateId,
      [],
      undefined
    )
    expect(application.templates.preview).not.toHaveBeenCalled()
    expect(application.templates.compile).not.toHaveBeenCalled()
  })

  it('导出生成结果时使用经过清理的试卷名称', async () => {
    const writeBinary = vi.fn().mockResolvedValue(true)
    await expect(
      exportGeneratedExam(new Uint8Array([1, 2, 3]), '英语听说 / 第一套', { writeBinary })
    ).resolves.toBe(true)
    expect(writeBinary).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      expect.objectContaining({ defaultName: '英语听说 - 第一套.lsexam', title: '导出试卷' })
    )
  })
})

function generationApplication(speechTexts: readonly string[]): TemplateApplication {
  const compileImplementation = async (
    _templateId: string,
    _bindings: unknown,
    options?: TemplateCompileOptions
  ) => {
    const generated = []
    for (const text of speechTexts) {
      const audio = await options?.synthesizeSpeech?.(text)
      if (audio) generated.push(audio)
    }
    return {
      success: true as const,
      examPackage: exam(speechTexts.length),
      resourceSources: [
        ...generated.map((audio, index) => ({ assetKey: `speech-${index}`, data: audio.data })),
        ...(speechTexts.length === 1 ? [{ assetKey: 'picture', sourceUrl: 'asset://picture' }] : [])
      ]
    }
  }
  const compile = vi.fn(compileImplementation)
  const preview = {
    success: true,
    preview: {
      title: '模板',
      pages: [
        {
          id: 'page',
          sourceNodeId: 'page',
          callPath: [],
          content: [],
          timeline: speechTexts.map((text) => ({ type: 'play', text }))
        }
      ],
      recordingIndices: [],
      resources: {}
    },
    resourceSources: []
  }
  return {
    templates: {
      preview: vi.fn().mockResolvedValue(preview),
      compile
    },
    builtinTemplates: {
      preview: vi.fn().mockResolvedValue(preview),
      compile: vi.fn(compileImplementation)
    }
  } as unknown as TemplateApplication
}

function template(): TemplateDocument {
  return {
    templateId: 'template-1',
    revision: 1,
    content: {
      name: '模板',
      description: '',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [{ id: 'page', type: 'page', content: { blocks: [] }, timeline: [] }]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function speechRouting() {
  return {
    default: { providerConfigId: 'default-provider', modelId: 'default-model', voiceId: 'default' },
    man: { providerConfigId: 'man-provider', modelId: 'man-model', voiceId: 'man' },
    woman: { providerConfigId: 'woman-provider', modelId: 'woman-model', voiceId: 'woman' }
  }
}

function generatedAudio(value: number) {
  return {
    data: new Uint8Array([value]),
    mediaType: 'audio/wav',
    format: 'wav' as const
  }
}

function exam(speechCount: number): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-1',
    examData: {
      title: '模板',
      player: {
        pages: [
          {
            id: 'page',
            content: [],
            timeline: speechCount
              ? Array.from({ length: speechCount }, (_, index) => ({
                  type: 'play' as const,
                  src: `resource:speech-${index}`
                }))
              : [{ type: 'countdown', seconds: 1 }]
          }
        ],
        recordingIndices: []
      },
      resources: Object.fromEntries([
        ...Array.from({ length: speechCount }, (_, index) => [
          `speech-${index}`,
          {
            filename: `speech-${index}.wav`,
            packagePath: `resources/speech-${index}/speech-${index}.wav`,
            mediaType: 'audio/wav'
          }
        ]),
        ...(speechCount === 1
          ? [
              [
                'picture',
                {
                  filename: 'picture.png',
                  packagePath: 'resources/picture/picture.png',
                  mediaType: 'image/png'
                }
              ]
            ]
          : [])
      ])
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-1', examTitle: '模板' },
      schemaUses: [],
      resources: {}
    }
  }
}
