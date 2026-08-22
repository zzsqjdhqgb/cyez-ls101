import type { GradingInput } from '@ls101/submission-library'
import { describe, expect, it, vi } from 'vitest'
import {
  AIGradingError,
  executeAIGrading,
  parseAIGradingResponse,
  type AIGradingDependencies
} from '../index'

describe('AI grading engine', () => {
  it('recognizes and corrects every answer separately before one text grading call', async () => {
    const input = gradingInput()
    const recognize = vi.fn().mockResolvedValueOnce('Read won.').mockResolvedValueOnce('Free talk.')
    const assess = vi
      .fn()
      .mockImplementation(({ referenceText }: { referenceText: string }) =>
        Promise.resolve(pronunciationAssessment(referenceText))
      )
    const generate = vi
      .fn()
      .mockResolvedValueOnce(
        '{"summaryZh":"未发现可信问题。","feedbackItems":[],"withheldDifferences":[],"limitationsZh":[]}'
      )
      .mockResolvedValueOnce(
        '{"summaryZh":"自由表达未发现可信问题。","feedbackItems":[],"withheldDifferences":[],"limitationsZh":[]}'
      )
      .mockResolvedValueOnce('{"score":4.125,"comment":"Good answer"}')

    const execution = await executeAIGrading(input, dependencies({ recognize, assess, generate }))

    expect(recognize).toHaveBeenCalledTimes(2)
    expect(assess).toHaveBeenCalledTimes(2)
    expect(assess.mock.calls[0][0].referenceText).toBe('Read one.')
    expect(assess.mock.calls[1][0].referenceText).toBe('Free talk.')
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[0][0]).toContain('CMUdict 0.7b')
    expect(generate.mock.calls[0][0]).toContain('"phoneId": "W001-P01"')
    expect(generate.mock.calls[1][0]).toContain('"referenceSource": "asr-provisional-transcript"')
    expect(generate.mock.calls[2][0]).toContain('Read won.')
    expect(generate.mock.calls[2][0]).toContain('Free talk.')
    expect(generate.mock.calls[2][0]).not.toContain('correctionTrace')
    expect(execution.result).toEqual({ score: 4.125, comment: 'Good answer' })
    expect(execution.trace.answers.map((answer) => answer.answerId)).toEqual(['reading', 'talk'])
    expect(execution.trace.answers[0].correctionTrace.evidence?.words).toHaveLength(2)
    expect(execution.trace.answers[0].correctionTrace.rawResponse).toContain('feedbackItems')
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
    assess: AIGradingDependencies['pronunciationAssessor']['assess']
    generate: AIGradingDependencies['textModel']['generate']
  }> = {}
): AIGradingDependencies {
  return {
    recognizer: { recognize: overrides.recognize ?? vi.fn().mockResolvedValue('transcript') },
    pronunciationAssessor: {
      assess:
        overrides.assess ??
        vi
          .fn()
          .mockImplementation(({ referenceText }) =>
            Promise.resolve(pronunciationAssessment(referenceText))
          )
    },
    textModel: {
      generate: overrides.generate ?? vi.fn().mockResolvedValue('{"score":4,"comment":"comment"}')
    },
    speechRecognitionModel: { providerId: 'builtin', modelId: 'qwen3-asr' },
    textModelSelection: { providerId: 'provider', modelId: 'model' }
  }
}

function pronunciationAssessment(referenceText: string) {
  const words = referenceText.match(/[A-Za-z]+/g) ?? []
  return {
    referenceText,
    recognizedPhones: words.map(() => 'ə'),
    overallScore: 100,
    words: words.map((text, index) => ({
      text,
      expectedPhones: ['ə'],
      score: 100,
      startMs: index * 100,
      endMs: (index + 1) * 100,
      phones: [
        {
          expected: 'ə',
          score: 100,
          confidence: 1,
          startMs: index * 100,
          endMs: (index + 1) * 100
        }
      ]
    })),
    pauses: [],
    feedbackMarkdown: ''
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
        templateInputs: [
          { inputId: 'question-description', type: 'text', required: true },
          { inputId: 'reference-answer', type: 'text', required: true }
        ]
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
    inputs: [
      { inputId: 'question-description', type: 'text', value: 'Question' },
      { inputId: 'reference-answer', type: 'text', value: 'Reference answer' }
    ],
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
