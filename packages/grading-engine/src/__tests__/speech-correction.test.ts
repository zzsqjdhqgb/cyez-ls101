import { describe, expect, it, vi } from 'vitest'
import {
  correctSpeechWithLLM,
  createSpeechCorrectionEvidence,
  parseSpeechCorrectionResponse
} from '../speech-correction'

describe('LLM speech correction', () => {
  it('aligns reference and ASR words and attaches CMUdict ARPAbet evidence', () => {
    const evidence = createSpeechCorrectionEvidence(
      'Three weather reports.',
      'Free weather report.'
    )

    expect(evidence.phonemeSource).toBe('CMUdict 0.7b ARPAbet')
    expect(
      evidence.alignment.map(({ evidenceId, operation }) => ({ evidenceId, operation }))
    ).toEqual([
      { evidenceId: 'W001', operation: 'substitution' },
      { evidenceId: 'W002', operation: 'match' },
      { evidenceId: 'W003', operation: 'substitution' }
    ])
    expect(evidence.alignment[0].referencePronunciations[0]).toEqual(['TH', 'R', 'IY1'])
    expect(evidence.alignment[0].transcriptPronunciations[0]).toEqual(['F', 'R', 'IY1'])
    expect(JSON.stringify(evidence).toLowerCase()).not.toContain('espeak')
  })

  it('represents word deletion and insertion explicitly', () => {
    const deletion = createSpeechCorrectionEvidence('I really like it.', 'I like it.')
    const insertion = createSpeechCorrectionEvidence('I like it.', 'I really like it.')

    expect(deletion.alignment.map((item) => item.operation)).toEqual([
      'match',
      'deletion',
      'match',
      'match'
    ])
    expect(insertion.alignment.map((item) => item.operation)).toEqual([
      'match',
      'insertion',
      'match',
      'match'
    ])
  })

  it('uses the LLM only for non-matching evidence and retains its audit trace', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        items: [
          {
            evidenceId: 'W001',
            decision: 'likely_issue',
            feedback: 'three 的开头可能没有清楚读成目标词，建议对照录音复听。'
          }
        ]
      })
    )

    const result = await correctSpeechWithLLM(
      { referenceText: 'three', transcript: 'free' },
      { generate }
    )

    expect(generate).toHaveBeenCalledOnce()
    expect(generate.mock.calls[0][0]).toContain('"evidenceId": "W001"')
    expect(result.correction).toContain('可能需要纠正')
    expect(result.correction).toContain('three 的开头')
    expect(result.trace.rawResponse).toContain('likely_issue')
  })

  it('does not ask the LLM to invent issues when all words match', async () => {
    const generate = vi.fn()

    const result = await correctSpeechWithLLM(
      { referenceText: 'Read this.', transcript: 'read this' },
      { generate }
    )

    expect(generate).not.toHaveBeenCalled()
    expect(result.correction).toContain('单词序列一致')
    expect(result.trace.evidence?.alignment.every((item) => item.operation === 'match')).toBe(true)
  })

  it('rejects unknown, duplicate, or omitted evidence IDs', () => {
    expect(() =>
      parseSpeechCorrectionResponse(
        '{"items":[{"evidenceId":"W999","decision":"uncertain","feedback":"x"}]}',
        ['W001']
      )
    ).toThrow('证据约束')
    expect(() => parseSpeechCorrectionResponse('{"items":[]}', ['W001'])).toThrow('未覆盖')
    expect(() =>
      parseSpeechCorrectionResponse(
        '{"items":[{"evidenceId":"W001","decision":"no_issue","feedback":""},{"evidenceId":"W001","decision":"no_issue","feedback":""}]}',
        ['W001']
      )
    ).toThrow('证据约束')
  })
})
