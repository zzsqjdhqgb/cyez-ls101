import { describe, expect, it, vi } from 'vitest'
import type { PronunciationAssessmentResult } from '../pronunciation'
import {
  correctSpeechWithLLM,
  createSpeechCorrectionEvidence,
  parseSpeechCorrectionResponse
} from '../speech-correction'

describe('LLM speech correction', () => {
  it('creates complete unscored CMUdict CTC evidence with stable phone IDs', () => {
    const evidence = createSpeechCorrectionEvidence({
      transcript: 'reliable',
      referenceText: 'reliable',
      referenceSource: 'known-script',
      assessment: assessment([
        {
          text: 'reliable',
          phones: [
            phone('ɹ', undefined, 0, 80),
            phone('ə', 'əl', 80, 160),
            phone('l', undefined, 160, 220)
          ]
        }
      ])
    })

    expect(evidence.referencePhones).toContain('CMUdict')
    expect(evidence.words[0].phones).toEqual([
      {
        phoneId: 'W001-P01',
        expectedPhone: 'ɹ',
        acousticWinner: 'ɹ',
        startMs: 0,
        endMs: 80
      },
      {
        phoneId: 'W001-P02',
        expectedPhone: 'ə',
        acousticWinner: 'əl',
        startMs: 80,
        endMs: 160
      },
      {
        phoneId: 'W001-P03',
        expectedPhone: 'l',
        acousticWinner: 'l',
        startMs: 160,
        endMs: 220
      }
    ])
    expect(JSON.stringify(evidence)).not.toMatch(/score|confidence|threshold|pause/i)
  })

  it('always sends the complete alignment to the LLM and retains the audit trace', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        summaryZh: '未发现需要纠正的问题。',
        feedbackItems: [],
        withheldDifferences: [
          {
            phoneIds: ['W001-P02'],
            word: 'reliable',
            reasonZh: '/ə/ + /l/ 与复合 token /əl/ 很可能是等价表示。'
          }
        ],
        limitationsZh: ['声学赢家不是人工听辨真值。']
      })
    )
    const result = await correctSpeechWithLLM(
      {
        transcript: 'reliable',
        referenceText: 'reliable',
        referenceSource: 'known-script',
        assessment: assessment([
          {
            text: 'reliable',
            phones: [phone('ɹ'), phone('ə', 'əl'), phone('l')]
          }
        ])
      },
      { generate }
    )

    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0][0]).toContain('完整词级对齐 JSON')
    expect(generate.mock.calls[0][0]).toContain('/ə/ + /l/ 对 /əl/')
    expect(generate.mock.calls[0][0]).toContain('"phoneId": "W001-P03"')
    expect(result.correction).toContain('未发现有充分证据')
    expect(result.correction).not.toContain('reliable')
    expect(result.trace.rawResponse).toContain('withheldDifferences')
  })

  it('still asks the LLM to review a fully matching acoustic alignment', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        summaryZh: '完整对齐未显示有教学价值的问题。',
        feedbackItems: [],
        withheldDifferences: [],
        limitationsZh: []
      })
    )

    await correctSpeechWithLLM(
      {
        transcript: 'three',
        referenceText: 'three',
        referenceSource: 'known-script',
        assessment: assessment([{ text: 'three', phones: [phone('θ'), phone('ɹ'), phone('iː')] }])
      },
      { generate }
    )

    expect(generate).toHaveBeenCalledOnce()
  })

  it('rejects unknown, duplicate, or cross-word evidence IDs', () => {
    const evidence = createSpeechCorrectionEvidence({
      transcript: 'three free',
      referenceText: 'three free',
      referenceSource: 'known-script',
      assessment: assessment([
        { text: 'three', phones: [phone('θ')] },
        { text: 'free', phones: [phone('f')] }
      ])
    })
    const response = (feedbackItems: unknown[], withheldDifferences: unknown[] = []): string =>
      JSON.stringify({ summaryZh: 'x', feedbackItems, withheldDifferences, limitationsZh: [] })
    const item = (phoneIds: string[], word = 'three') => ({
      phoneIds,
      word,
      decision: 'needs_listening',
      findingZh: 'x',
      rationaleZh: 'x',
      practiceZh: 'x'
    })

    expect(() => parseSpeechCorrectionResponse(response([item(['W999-P01'])]), evidence)).toThrow(
      '证据 ID'
    )
    expect(() =>
      parseSpeechCorrectionResponse(
        response([item(['W001-P01'])], [{ phoneIds: ['W001-P01'], word: 'three', reasonZh: 'x' }]),
        evidence
      )
    ).toThrow('证据 ID')
    expect(() =>
      parseSpeechCorrectionResponse(response([item(['W002-P01'], 'three')]), evidence)
    ).toThrow('证据 ID')
  })
})

function phone(
  expected: string,
  observed?: string,
  startMs = 0,
  endMs = 100
): PronunciationAssessmentResult['words'][number]['phones'][number] {
  return { expected, ...(observed ? { observed } : {}), score: 50, confidence: 0.5, startMs, endMs }
}

function assessment(
  words: Array<{
    text: string
    phones: PronunciationAssessmentResult['words'][number]['phones']
  }>
): PronunciationAssessmentResult {
  return {
    referenceText: words.map((word) => word.text).join(' '),
    recognizedPhones: words.flatMap((word) =>
      word.phones.map((item) => item.observed ?? item.expected)
    ),
    overallScore: 50,
    words: words.map((word) => ({
      text: word.text,
      expectedPhones: word.phones.map((item) => item.expected),
      score: 50,
      startMs: word.phones[0]?.startMs ?? 0,
      endMs: word.phones.at(-1)?.endMs ?? 0,
      phones: word.phones
    })),
    pauses: [],
    feedbackMarkdown: 'ignored'
  }
}
