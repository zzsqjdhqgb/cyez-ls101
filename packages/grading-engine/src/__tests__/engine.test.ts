import type { GradingInput } from '@ls101/submission-library'
import { describe, expect, it, vi } from 'vitest'
import {
  AIGradingError,
  executeAIGrading,
  noDictionaryCoverageError,
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
      .mockResolvedValueOnce('这批证据多为弱读或连读造成的低 GOP，未见可确认的发音问题。')
      .mockResolvedValueOnce('自由表达部分未观察到可确认的发音问题，建议保持慢速清晰朗读。')
      .mockResolvedValueOnce('{"score":4.125,"comment":"Good answer"}')

    const execution = await executeAIGrading(input, dependencies({ recognize, assess, generate }))

    expect(recognize).toHaveBeenCalledTimes(2)
    expect(assess).toHaveBeenCalledTimes(2)
    expect(assess.mock.calls[0][0].referenceText).toBe('Read won.')
    expect(assess.mock.calls[1][0].referenceText).toBe('Free talk.')
    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[0][0]).toContain('"evidence_id": "GOP-0000"')
    expect(generate.mock.calls[0][0]).toContain('"transcript": "Read won."')
    expect(generate.mock.calls[0][0]).toContain('"context_text": "Read won"')
    expect(generate.mock.calls[0][0]).not.toContain('Read one.')
    expect(generate.mock.calls[1][0]).toContain('"context_text": "Free talk"')
    expect(generate.mock.calls[2][0]).toContain('Read won.')
    expect(generate.mock.calls[2][0]).toContain('Free talk.')
    expect(generate.mock.calls[2][0]).toContain('未见可确认的发音问题')
    expect(generate.mock.calls[2][0]).not.toContain('correctionTrace')
    expect(execution.result).toEqual({ score: 4.125, comment: 'Good answer' })
    expect(execution.trace.answers.map((answer) => answer.answerId)).toEqual(['reading', 'talk'])
    expect(execution.trace.answers[0].correction).toBe(
      '这批证据多为弱读或连读造成的低 GOP，未见可确认的发音问题。'
    )
    expect(execution.trace.answers[0].correctionTrace.evidence?.word_contexts).toHaveLength(1)
    expect(execution.trace.answers[0].correctionTrace.rawResponse).toBe(
      '这批证据多为弱读或连读造成的低 GOP，未见可确认的发音问题。'
    )
  })

  it('flows partial dictionary gaps through the correction and grading prompts', async () => {
    const input = gradingInput()
    const recognize = vi.fn().mockResolvedValue('overweigh three.')
    const assess = vi.fn().mockImplementation(({ referenceText }) =>
      Promise.resolve({
        ...pronunciationAssessment(referenceText),
        uncovered_words: ['overweigh']
      })
    )
    const generate = vi
      .fn()
      .mockResolvedValueOnce('这批证据多为弱读造成的低 GOP，未见可确认的发音问题。')
      .mockResolvedValueOnce('自由表达部分未观察到可确认的发音问题。')
      .mockResolvedValueOnce('{"score":4,"comment":"Good answer"}')

    const execution = await executeAIGrading(input, dependencies({ recognize, assess, generate }))

    expect(generate).toHaveBeenCalledTimes(3)
    expect(generate.mock.calls[0][0]).toContain('补充：以下单词不在标准发音词典中')
    expect(generate.mock.calls[0][0]).toContain('overweigh')
    const gradingPayload = generate.mock.calls[2][0]
    expect(gradingPayload).toContain('"uncoveredWords"')
    expect(gradingPayload).toContain('overweigh')
    expect(gradingPayload).not.toContain('评分政策')
    expect(execution.result).toEqual({ score: 4, comment: 'Good answer' })
    expect(execution.trace.answers.map((answer) => answer.uncoveredWords)).toEqual([
      ['overweigh'],
      ['overweigh']
    ])
  })

  it('degrades to a forced zero score when a whole answer is outside the dictionary', async () => {
    const input = gradingInput()
    const recognize = vi.fn().mockResolvedValue('overweigh flumberz')
    const assess = vi.fn().mockRejectedValue(noDictionaryCoverageError(['overweigh', 'flumberz']))
    const generate = vi.fn().mockResolvedValue('{"score":3,"comment":"内容尚可"}')

    const execution = await executeAIGrading(input, dependencies({ recognize, assess, generate }))

    // 两段录音全部缺词：① 不再调用，只保留 ② 的一次评分调用。
    expect(generate).toHaveBeenCalledTimes(1)
    const gradingPrompt = generate.mock.calls[0][0]
    expect(gradingPrompt).toContain('评分政策')
    expect(gradingPrompt).toContain('本题 score 必须为 0')
    expect(gradingPrompt).toContain('「Reading」')
    expect(gradingPrompt).toContain('「Talk」')
    expect(gradingPrompt).toContain('如果只根据内容评分')
    expect(execution.result).toEqual({ score: 0, comment: '内容尚可' })
    expect(
      execution.trace.answers.every((answer) => answer.allWordsOutsideDictionary === true)
    ).toBe(true)
    expect(execution.trace.answers[0].correction).toContain('均不在标准发音词典中')
    expect(execution.trace.answers[0].uncoveredWords).toEqual(['overweigh', 'flumberz'])
    expect(execution.trace.answers[0].correctionTrace).toEqual({})
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
  const phoneRows = words.map((text, index) => ({
    index,
    word_index: index,
    phone_index: 0,
    word: text,
    expected: 'AH',
    expected_ipa: 'ʌ',
    acoustic_winner: index === 0 ? 'AE' : 'AH',
    acoustic_winner_ipa: index === 0 ? 'æ' : 'ʌ',
    best_alternative: 'AE',
    best_alternative_ipa: 'æ',
    expected_log_p: index === 0 ? -2 : -0.01,
    alternative_log_p: index === 0 ? -0.01 : -2,
    gop_log_ratio: index === 0 ? -1 : 1,
    confidence: 0.25,
    start_ms: index * 100,
    end_ms: (index + 1) * 100
  }))
  return {
    schema_version: 2 as const,
    reference_text: referenceText,
    audio_duration_ms: Math.max(1, words.length * 100),
    frame_count: 100,
    recognized_phones: phoneRows.map((phone) => phone.acoustic_winner),
    recognized_phones_ipa: phoneRows.map((phone) => phone.acoustic_winner_ipa),
    gop_method: 'viterbi' as const,
    alignment_path_score: -0.5,
    acoustic_model: 'test model',
    acoustic_phone_inventory: '39 CMU phones',
    reference_source: 'CMUdict test reference',
    dictionary_source: 'test dictionary',
    uncovered_words: [] as string[],
    phones: phoneRows,
    words: words.map((text, index) => ({
      word_index: index,
      text,
      expected_arpabet: ['AH'],
      expected_ipa: ['ʌ'],
      start_ms: index * 100,
      end_ms: (index + 1) * 100,
      phones: [phoneRows[index]]
    }))
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
