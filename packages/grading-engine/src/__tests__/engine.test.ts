import type { GradingInput } from '@ls101/submission-library'
import { describe, expect, it, vi } from 'vitest'
import {
  AIGradingError,
  PLACEHOLDER_SPEECH_CORRECTION,
  createPlaceholderSpeechCorrector,
  executeAIGrading,
  parseAIGradingResponse,
  type AIGradingDependencies
} from '../index'

describe('AI grading engine', () => {
  it('recognizes and corrects every answer separately before one text grading call', async () => {
    const input = gradingInput()
    const recognize = vi
      .fn()
      .mockResolvedValueOnce('first transcript')
      .mockResolvedValueOnce('second transcript')
    const correct = vi.fn().mockResolvedValue('no speech errors')
    const generate = vi.fn().mockResolvedValue('{"score":4.125,"comment":"Good answer"}')

    const execution = await executeAIGrading(input, dependencies({ recognize, correct, generate }))

    expect(recognize).toHaveBeenCalledTimes(2)
    expect(correct).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ referenceText: 'Read one.' }),
      { signal: undefined }
    )
    expect(correct.mock.calls[1][0]).not.toHaveProperty('referenceText')
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0][0]).toContain('first transcript')
    expect(generate.mock.calls[0][0]).toContain('second transcript')
    expect(execution.result).toEqual({ score: 4.125, comment: 'Good answer' })
    expect(execution.trace.answers.map((answer) => answer.answerId)).toEqual(['reading', 'talk'])
  })

  it('provides the agreed placeholder speech correction', async () => {
    const answer = gradingInput().answers[0]
    if (answer.type === 'text') throw new Error('Expected an audio answer')
    await expect(createPlaceholderSpeechCorrector().correct({ audio: answer.audio })).resolves.toBe(
      PLACEHOLDER_SPEECH_CORRECTION
    )
  })

  it('stops the item before text grading when speech processing fails', async () => {
    const generate = vi.fn()
    const recognize = vi.fn().mockRejectedValue(new Error('ASR unavailable'))
    await expect(
      executeAIGrading(gradingInput(), dependencies({ recognize, generate }))
    ).rejects.toThrow('ASR unavailable')
    expect(generate).not.toHaveBeenCalled()
  })

  it('rejects non-strict JSON, extra fields, out-of-range scores, and excess decimals', () => {
    for (const response of [
      '```json\n{"score":4,"comment":"ok"}\n```',
      '{"score":4,"comment":"ok","reason":"extra"}',
      '{"score":6,"comment":"ok"}',
      '{"score":4.1234,"comment":"ok"}',
      '{"score":4.1230,"comment":"ok"}',
      '{"score":1.2e-3,"comment":"ok"}'
    ]) {
      expect(() => parseAIGradingResponse(response, 5)).toThrow(AIGradingError)
    }
    expect(parseAIGradingResponse('{"score":0.001,"comment":"ok"}', 5)).toEqual({
      score: 0.001,
      comment: 'ok'
    })
    expect(parseAIGradingResponse('{"score":1e-3,"comment":"ok"}', 5)).toEqual({
      score: 0.001,
      comment: 'ok'
    })
  })
})

function dependencies(
  overrides: Partial<{
    recognize: AIGradingDependencies['recognizer']['recognize']
    correct: AIGradingDependencies['corrector']['correct']
    generate: AIGradingDependencies['textModel']['generate']
  }> = {}
): AIGradingDependencies {
  return {
    recognizer: { recognize: overrides.recognize ?? vi.fn().mockResolvedValue('transcript') },
    corrector: { correct: overrides.correct ?? vi.fn().mockResolvedValue('correction') },
    textModel: {
      generate: overrides.generate ?? vi.fn().mockResolvedValue('{"score":4,"comment":"comment"}')
    },
    speechRecognitionModel: { providerId: 'builtin', modelId: 'qwen3-asr' },
    textModelSelection: { providerId: 'provider', modelId: 'model' }
  }
}

function gradingInput(): GradingInput {
  const audio = (resourceKey: string) => ({
    resourceKey,
    filename: `${resourceKey}.wav`,
    mediaType: 'audio/wav',
    kind: 'recording' as const,
    data: new Uint8Array([1, 2, 3]),
    durationMs: 1000
  })
  return {
    submission: {
      submissionId: 'submission',
      examPackageId: 'exam',
      examTitle: 'Exam',
      candidate: { candidateId: 'student', displayName: 'Student' },
      startedAt: '2026-08-14T00:00:00Z',
      submittedAt: '2026-08-14T00:10:00Z'
    },
    instanceId: 'instance',
    schema: {
      formatVersion: 2,
      schemaId: 'schema',
      sourceDraftId: 'draft',
      structureHash: `sha256:${'1'.repeat(64)}`,
      revision: 1,
      structure: {
        questionType: 'fixed-reading',
        answerFormat: [
          { answerId: 'reading', type: 'fixed-speech' },
          { answerId: 'talk', type: 'free-speech' }
        ],
        templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
      },
      data: {
        name: 'Speaking',
        description: '',
        maxScore: 5,
        answerDescriptions: { reading: 'Reading', talk: 'Talk' },
        inputDescriptions: {},
        rubricMarkdown: 'Rubric',
        extraPromptMarkdown: 'Extra instruction'
      }
    },
    inputs: [{ inputId: 'question-description', type: 'text', value: 'Question' }],
    answers: [
      {
        answerId: 'reading',
        description: 'Reading',
        type: 'fixed-speech',
        text: 'Read one.',
        audio: audio('audio-1')
      },
      {
        answerId: 'talk',
        description: 'Talk',
        type: 'free-speech',
        audio: audio('audio-2')
      }
    ],
    resources: {}
  }
}
