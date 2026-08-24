import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExamPackage } from '@ls101/core-types'
import { loadExam } from '../loading'

afterEach(() => vi.restoreAllMocks())

describe('loadExam', () => {
  it('GET 清单和全部资源并缓存为播放器 URL', async () => {
    const exam = fixtureExam()
    const requested: string[] = []
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('manifest.json')) return Response.json(exam)
      if (url.endsWith('picture.png')) return new Response(new Uint8Array([1, 2, 3]))
      if (url.endsWith('speech.wav')) return new Response(new Uint8Array([4, 5, 6]))
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (source) => `blob:${source instanceof Blob ? source.size : 0}`
    )
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const loaded = await loadExam('https://exam.test/paper/', fetcher)

    expect(requested).toEqual([
      'https://exam.test/paper/manifest.json',
      'https://exam.test/paper/resources/picture/picture.png',
      'https://exam.test/paper/resources/speech/speech.wav'
    ])
    expect(loaded.resources.picture).toEqual(new Uint8Array([1, 2, 3]))
    expect(loaded.resourceUrls).toEqual({ picture: 'blob:3', speech: 'blob:3' })
    loaded.dispose()
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('任一资源不存在时拒绝进入考试', async () => {
    const exam = fixtureExam()
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith('manifest.json')
        ? Response.json(exam)
        : new Response(null, { status: 404 })
    ) as unknown as typeof fetch
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resource')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    await expect(loadExam('https://exam.test/paper/', fetcher)).rejects.toThrow(
      '资源 picture加载失败（HTTP 404）'
    )
  })

  it('要求目录形式的 base URL', async () => {
    await expect(
      loadExam('https://exam.test/paper', vi.fn() as unknown as typeof fetch)
    ).rejects.toThrow('examBaseUrl 必须以 / 结尾')
  })
})

export function fixtureExam(overrides: Partial<ExamPackage> = {}): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-1',
    examData: {
      title: '测试考试',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [
              { id: 'title', type: 'text', x: 10, y: 10, text: '请作答' },
              {
                id: 'picture',
                type: 'image',
                x: 10,
                y: 20,
                width: 80,
                height: 50,
                src: 'resource:picture'
              }
            ],
            timeline: [{ type: 'play', src: 'resource:speech' }]
          }
        ],
        recordingIndices: []
      },
      resources: {
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        },
        speech: {
          filename: 'speech.wav',
          packagePath: 'resources/speech/speech.wav',
          mediaType: 'audio/wav'
        }
      }
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-1', examTitle: '测试考试' },
      schemaUses: [],
      resources: {}
    },
    ...overrides
  }
}
