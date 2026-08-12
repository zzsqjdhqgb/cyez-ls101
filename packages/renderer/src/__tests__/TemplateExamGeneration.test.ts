import { decodeExamPackage } from '@ls101/exam-package'
import type { ExamPackage } from '@ls101/core-types'
import type { TemplateApplication, TemplateCompileOptions } from '@ls101/template-editor'
import { describe, expect, it, vi } from 'vitest'
import {
  generateExamArchive,
  listSpeechGenerationSelections
} from '../features/templates/TemplateExamGeneration'

describe('TemplateExamGeneration', () => {
  it('只列出同时启用的 Provider、Model 和 Voice 组合', async () => {
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

  it('使用本次选择合成语音、收集资源并导出合法试卷包', async () => {
    const synthesizeSpeech = vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/wav',
      format: 'wav'
    })
    const compile = vi.fn(
      async (_templateId: string, _bindings: unknown, options?: TemplateCompileOptions) => {
        const audio = await options?.synthesizeSpeech?.('Hello')
        return {
          success: true as const,
          examPackage: exam(),
          resourceSources: [
            { assetKey: 'speech', data: audio?.data ?? new Uint8Array() },
            { assetKey: 'picture', sourceUrl: 'asset://picture' }
          ]
        }
      }
    )
    const application = {
      templates: { compile }
    } as unknown as TemplateApplication
    const writeBinary = vi.fn().mockResolvedValue(true)

    await expect(
      generateExamArchive(
        {
          application,
          templateId: 'template-1',
          templateName: '英语听说 / 第一套',
          bindings: [],
          speech: {
            default: {
              providerConfigId: 'speech-provider',
              modelId: 'speech-model',
              voiceId: 'speech-voice'
            },
            man: {
              providerConfigId: 'speech-provider',
              modelId: 'speech-model',
              voiceId: 'man-voice'
            },
            woman: {
              providerConfigId: 'speech-provider',
              modelId: 'speech-model',
              voiceId: 'woman-voice'
            }
          }
        },
        {
          speechClient: { synthesizeSpeech },
          fileDialog: { writeBinary } as never,
          fetchResource: vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5, 6])))
        }
      )
    ).resolves.toBe('exported')

    expect(synthesizeSpeech).toHaveBeenCalledWith({
      text: 'Hello',
      routing: {
        default: {
          providerConfigId: 'speech-provider',
          modelId: 'speech-model',
          voiceId: 'speech-voice'
        },
        man: {
          providerConfigId: 'speech-provider',
          modelId: 'speech-model',
          voiceId: 'man-voice'
        },
        woman: {
          providerConfigId: 'speech-provider',
          modelId: 'speech-model',
          voiceId: 'woman-voice'
        }
      },
      format: 'wav'
    })
    expect(writeBinary).toHaveBeenCalledOnce()
    expect(writeBinary.mock.calls[0][1]).toMatchObject({
      defaultName: '英语听说 - 第一套.lsexam'
    })
    const decoded = await decodeExamPackage(writeBinary.mock.calls[0][0])
    expect(decoded.exam.examData.player.pages[0].timeline).toEqual([
      { type: 'play', src: 'resource:speech' }
    ])
    expect(decoded.resources.picture).toEqual(new Uint8Array([4, 5, 6]))
  })

  it('没有播放动作时不要求或调用 TTS', async () => {
    const synthesizeSpeech = vi.fn()
    const compile = vi.fn().mockResolvedValue({
      success: true,
      examPackage: examWithoutSpeech(),
      resourceSources: [{ assetKey: 'picture', sourceUrl: 'asset://picture' }]
    })
    const writeBinary = vi.fn().mockResolvedValue(true)

    await expect(
      generateExamArchive(
        {
          application: { templates: { compile } } as unknown as TemplateApplication,
          templateId: 'template-1',
          templateName: '无听力动作',
          bindings: []
        },
        {
          speechClient: { synthesizeSpeech },
          fileDialog: { writeBinary } as never,
          fetchResource: vi.fn().mockResolvedValue(new Response(new Uint8Array([4, 5, 6])))
        }
      )
    ).resolves.toBe('exported')

    expect(compile).toHaveBeenCalledWith('template-1', [], undefined)
    expect(synthesizeSpeech).not.toHaveBeenCalled()
    const decoded = await decodeExamPackage(writeBinary.mock.calls[0][0])
    expect(decoded.exam.examData.player.pages[0].timeline).toEqual([
      { type: 'countdown', seconds: 1 }
    ])
  })

  it('生成失败时显示语音合成的底层错误', async () => {
    const application = {
      templates: {
        compile: vi.fn().mockResolvedValue({
          success: false,
          errors: [
            {
              stage: 'compile',
              code: 'SPEECH_SYNTHESIS_FAILED',
              path: 'root.children[0].timeline[0].text',
              params: { message: 'Pocket TTS 不支持当前文本' }
            }
          ]
        })
      }
    } as unknown as TemplateApplication

    await expect(
      generateExamArchive(
        {
          application,
          templateId: 'template-1',
          templateName: 'Template',
          bindings: [],
          speech: {
            default: {
              providerConfigId: 'speech-provider',
              modelId: 'speech-model',
              voiceId: 'speech-voice'
            }
          }
        },
        {
          speechClient: { synthesizeSpeech: vi.fn() },
          fileDialog: { writeBinary: vi.fn() } as never,
          fetchResource: vi.fn()
        }
      )
    ).rejects.toThrow(
      'SPEECH_SYNTHESIS_FAILED：root.children[0].timeline[0].text\nPocket TTS 不支持当前文本'
    )
  })
})

function exam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-1',
    examData: {
      title: '英语听说',
      player: {
        pages: [
          {
            id: 'page',
            content: [
              {
                id: 'picture',
                type: 'image',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                src: 'resource:picture'
              }
            ],
            timeline: [{ type: 'play', src: 'resource:speech' }]
          }
        ],
        recordingIndices: []
      },
      resources: {
        speech: {
          filename: 'speech.wav',
          packagePath: 'resources/speech/speech.wav',
          mediaType: 'audio/wav'
        },
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        }
      }
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-1', examTitle: '英语听说' },
      schemaUses: [],
      resources: {}
    }
  }
}

function examWithoutSpeech(): ExamPackage {
  const value = exam()
  value.examData.player.pages[0].timeline = [{ type: 'countdown', seconds: 1 }]
  delete value.examData.resources.speech
  return value
}
