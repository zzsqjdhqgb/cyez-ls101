import type { ExamPackage } from '@ls101/core-types'
import type { ExamArchive } from '@ls101/exam-package'
import { describe, expect, it } from 'vitest'
import { createLocalExamTransport } from '../features/exams/localExamTransport'

describe('createLocalExamTransport', () => {
  it('通过 GET 提供 manifest 和声明的资源', async () => {
    const archive: ExamArchive = {
      exam: exam(),
      resources: { speech: new Uint8Array([1, 2, 3]) }
    }
    const transport = createLocalExamTransport(archive)

    const manifest = await transport.fetcher(new URL('manifest.json', transport.baseUrl))
    const resource = await transport.fetcher(
      new URL('resources/speech/speech.wav', transport.baseUrl)
    )
    const missing = await transport.fetcher(new URL('unknown.wav', transport.baseUrl))
    const post = await transport.fetcher(new URL('manifest.json', transport.baseUrl), {
      method: 'POST'
    })

    expect(await manifest.json()).toEqual(archive.exam)
    expect(new Uint8Array(await resource.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(resource.headers.get('content-type')).toBe('audio/wav')
    expect(missing.status).toBe(404)
    expect(post.status).toBe(405)
  })
})

function exam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-package-1',
    examData: {
      title: 'Test exam',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'title', type: 'text', x: 10, y: 10, text: 'Start' }],
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
        }
      }
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-package-1', examTitle: 'Test exam' },
      schemaUses: [],
      resources: {}
    }
  }
}
