import { describe, expect, it } from 'vitest'
import { createApplicationWorkerUrls } from '../../src/main/application-worker-urls'

describe('application worker URLs', () => {
  it('resolves every packaged worker beside the main application bundle', () => {
    expect(createApplicationWorkerUrls('file:///application/out/main/application.js')).toEqual({
      legacyData: new URL('file:///application/out/main/legacy-data-worker.js'),
      pocketTts: new URL('file:///application/out/main/pocket-tts-worker.js'),
      pronunciationAssessment: new URL(
        'file:///application/out/main/pronunciation-assessment-worker.js'
      ),
      speechRecognition: new URL('file:///application/out/main/qwen3-asr-worker.js')
    })
  })
})
