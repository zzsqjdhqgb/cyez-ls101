import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CMU_PHONE_TO_IPA,
  type PronunciationAssessmentResult,
  type PronunciationPhoneAssessment
} from '../pronunciation'
import {
  buildSpeechCorrectionPrompt,
  correctSpeechWithLLM,
  createSpeechCorrectionEvidence,
  parseSpeechCorrectionResponse,
  SPEECH_CORRECTION_SYSTEM_PROMPT
} from '../speech-correction'

describe('GOP + LLM v3 speech correction', () => {
  it('selects every low-GOP row and sends only complete local word contexts', () => {
    const transcript = 'FULL TRANSCRIPT MUST STAY LOCAL word one target word four'
    const evidence = createSpeechCorrectionEvidence({
      transcript,
      assessment: assessment([
        word(0, 'full', [phone(0, 0, 0, 'full', 'F', 'F', 1)]),
        word(1, 'transcript', [phone(1, 1, 0, 'transcript', 'T', 'T', 1)]),
        word(2, 'target', [
          phone(2, 2, 0, 'target', 'T', 'D', -0.35),
          phone(3, 2, 1, 'target', 'AA', 'AH', -2)
        ]),
        word(3, 'word', [phone(4, 3, 0, 'word', 'W', 'W', 1)]),
        word(4, 'four', [phone(5, 4, 0, 'four', 'F', 'F', 1)])
      ])
    })

    expect(evidence.rows.map((row) => row.evidence_id)).toEqual(['GOP-0003', 'GOP-0002'])
    expect(evidence.selection_policy).toMatchObject({
      gop_log_ratio_lte: -0.35,
      selected_count: 2,
      word_context_count: 1
    })
    expect(evidence.word_contexts[0]).toMatchObject({
      word_index: 2,
      word: 'target',
      context_text: 'full transcript target word four',
      reference_phones: { arpabet: ['T', 'AA'], ipa: ['t', 'ɑː'] },
      observed_phones: { arpabet: ['D', 'AH'], ipa: ['d', 'ʌ'] }
    })
    expect(evidence.word_contexts[0].gop_evidence.map((row) => row.evidence_id)).toEqual([
      'GOP-0002',
      'GOP-0003'
    ])

    const prompt = buildSpeechCorrectionPrompt(evidence)
    expect(prompt).toContain('GOP-0002')
    expect(prompt).toContain('"context_text": "full transcript target word four"')
    expect(prompt).not.toContain(transcript)
  })

  it('uses the frozen system prompt and generation parameters', async () => {
    const evidenceAssessment = assessment([
      word(0, 'books', [phone(12, 0, 0, 'books', 'B', 'P', -2.277763)])
    ])
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary_zh: '该证据值得复听。',
        feedback_items: [
          {
            evidence_ids: ['GOP-0012'],
            decision: 'needs_listening',
            observations: [observation('GOP-0012', 'B', 'P')],
            finding_zh: '对齐窗口的声学赢家与参考音素不同。',
            rationale_zh: '单条证据不能直接确认为错误，建议复听。',
            practice_zh: '对比练习 /b/ 与 /p/，并结合原录音确认。'
          }
        ],
        withheld_differences: [],
        limitations_zh: ['文本模型听不到音频。']
      })
    )

    const result = await correctSpeechWithLLM(
      { transcript: 'books', assessment: evidenceAssessment },
      { generate }
    )

    expect(generate).toHaveBeenCalledWith(expect.stringContaining('GOP-0012'), {
      signal: undefined,
      systemPrompt: SPEECH_CORRECTION_SYSTEM_PROMPT,
      temperature: 0,
      maxOutputTokens: 65_535
    })
    expect(result.correction).toContain('books')
    expect(result.correction).toContain('GOP-0012')
    expect(result.trace.rawResponse).toContain('observations')
  })

  it('skips the LLM when no phone crosses the frozen threshold', async () => {
    const generate = vi.fn()
    const result = await correctSpeechWithLLM(
      {
        transcript: 'three',
        assessment: assessment([
          word(0, 'three', [
            phone(0, 0, 0, 'three', 'TH', 'TH', 2),
            phone(1, 0, 1, 'three', 'R', 'R', 2),
            phone(2, 0, 2, 'three', 'IY', 'IY', 2)
          ])
        ])
      },
      { generate }
    )

    expect(generate).not.toHaveBeenCalled()
    expect(result.correction).toContain('没有生成待纠错证据')
    expect(result.trace).not.toHaveProperty('prompt')
    expect(result.trace.evidence?.rows).toEqual([])
  })

  it('requires exactly-once ID coverage and verbatim ordered observations', () => {
    const evidence = createSpeechCorrectionEvidence({
      transcript: 'three free',
      assessment: assessment([
        word(0, 'three', [phone(0, 0, 0, 'three', 'TH', 'S', -2)]),
        word(1, 'free', [phone(1, 1, 0, 'free', 'F', 'P', -1)])
      ])
    })
    const valid = {
      summary_zh: '两条证据均需保守处理。',
      feedback_items: [
        {
          evidence_ids: ['GOP-0000'],
          decision: 'needs_listening',
          observations: [observation('GOP-0000', 'TH', 'S')],
          finding_zh: '存在声学差异。',
          rationale_zh: '值得复听。',
          practice_zh: '进行音素对比。'
        }
      ],
      withheld_differences: [
        {
          evidence_ids: ['GOP-0001'],
          observations: [observation('GOP-0001', 'F', 'P')],
          reason_zh: '单条证据不足以确认。'
        }
      ],
      limitations_zh: ['文本模型不能听音频。']
    }

    expect(parseSpeechCorrectionResponse(JSON.stringify(valid), evidence)).toEqual(valid)

    const missing = structuredClone(valid)
    missing.withheld_differences = []
    expect(() => parseSpeechCorrectionResponse(JSON.stringify(missing), evidence)).toThrow(
      '全部低 GOP 证据 ID'
    )

    const changedPhone = structuredClone(valid)
    changedPhone.feedback_items[0].observations[0].expected = 'S'
    expect(() => parseSpeechCorrectionResponse(JSON.stringify(changedPhone), evidence)).toThrow(
      '逐字复制 expected'
    )

    const wrongOrder = structuredClone(valid)
    wrongOrder.feedback_items = [
      {
        ...wrongOrder.feedback_items[0],
        evidence_ids: ['GOP-0000', 'GOP-0001'],
        observations: [observation('GOP-0001', 'F', 'P'), observation('GOP-0000', 'TH', 'S')]
      }
    ]
    wrongOrder.withheld_differences = []
    expect(() => parseSpeechCorrectionResponse(JSON.stringify(wrongOrder), evidence)).toThrow(
      '顺序'
    )
  })

  it('reproduces the committed v3 frozen evidence and accepts its response', () => {
    const base = fixture('stable-gop-demo/result.json') as Record<string, unknown>
    const frozenEvidence = fixture('stable-gop-demo-llm-v3/evidence.json') as {
      rows: unknown[]
      word_contexts: unknown[]
    }
    const frozenResult = fixture('stable-gop-demo-llm-v3/result.json') as {
      feedback: unknown
    }
    const baseAssessment = {
      schema_version: 2,
      reference_text: base.transcript,
      audio_duration_ms: base.audio_duration_ms,
      frame_count: base.frame_count,
      recognized_phones: base.recognized_phones,
      recognized_phones_ipa: (base.recognized_phones as string[]).map(
        (phone) => CMU_PHONE_TO_IPA[phone]
      ),
      gop_method: 'viterbi',
      alignment_path_score: base.alignment_path_score,
      acoustic_model: 'charsiu/en_w2v2_fc_10ms research checkpoint',
      acoustic_phone_inventory: 'native uppercase CMU phones',
      reference_source: base.reference_source,
      dictionary_source: base.dictionary_source,
      phones: base.phones,
      words: base.words
    } as PronunciationAssessmentResult

    const evidence = createSpeechCorrectionEvidence({
      transcript: String(base.transcript),
      assessment: baseAssessment
    })

    expect(evidence.rows).toHaveLength(15)
    expect(evidence.word_contexts).toHaveLength(9)
    expect(evidence.rows).toEqual(frozenEvidence.rows)
    expect(evidence.word_contexts).toEqual(frozenEvidence.word_contexts)
    expect(evidence.word_contexts[0]).toMatchObject({
      word: 'books',
      context_text: 'that e books overweigh paper',
      reference_phones: { arpabet: ['B', 'UH', 'K', 'S'] },
      observed_phones: { arpabet: ['P', 'UH', 'K', 'S'] },
      gop_evidence: [{ evidence_id: 'GOP-0012', gop_log_ratio: -2.277763 }]
    })
    expect(() =>
      parseSpeechCorrectionResponse(JSON.stringify(frozenResult.feedback), evidence)
    ).not.toThrow()
  })
})

function observation(evidenceId: string, expected: string, winner: string) {
  return {
    evidence_id: evidenceId,
    expected,
    expected_ipa: IPA[expected],
    acoustic_winner: winner,
    acoustic_winner_ipa: IPA[winner]
  }
}

const IPA: Readonly<Record<string, string>> = {
  AA: 'ɑː',
  AH: 'ʌ',
  B: 'b',
  D: 'd',
  F: 'f',
  IY: 'iː',
  P: 'p',
  R: 'ɹ',
  S: 's',
  T: 't',
  TH: 'θ',
  W: 'w'
}

function phone(
  index: number,
  wordIndex: number,
  phoneIndex: number,
  surface: string,
  expected: string,
  winner: string,
  gop: number
): PronunciationPhoneAssessment {
  const bestAlternative = winner === expected ? (expected === 'P' ? 'B' : 'P') : winner
  return {
    index,
    word_index: wordIndex,
    phone_index: phoneIndex,
    word: surface,
    expected,
    expected_ipa: IPA[expected],
    acoustic_winner: winner,
    acoustic_winner_ipa: IPA[winner],
    best_alternative: bestAlternative,
    best_alternative_ipa: IPA[bestAlternative],
    expected_log_p: gop < 0 ? -2 : -0.01,
    alternative_log_p: gop < 0 ? -0.01 : -2,
    gop_log_ratio: gop,
    confidence: Math.min(1, Math.abs(gop) / 4),
    start_ms: index * 20,
    end_ms: index * 20 + 20
  }
}

function word(
  wordIndex: number,
  text: string,
  phones: PronunciationPhoneAssessment[]
): PronunciationAssessmentResult['words'][number] {
  return {
    word_index: wordIndex,
    text,
    expected_arpabet: phones.map((item) => item.expected),
    expected_ipa: phones.map((item) => item.expected_ipa),
    start_ms: phones[0]?.start_ms ?? 0,
    end_ms: phones.at(-1)?.end_ms ?? 0,
    phones
  }
}

function assessment(words: PronunciationAssessmentResult['words']): PronunciationAssessmentResult {
  return {
    schema_version: 2,
    reference_text: words.map((item) => item.text).join(' '),
    audio_duration_ms: Math.max(1, words.at(-1)?.end_ms ?? 1),
    frame_count: 100,
    recognized_phones: words.flatMap((item) => item.phones.map((phone) => phone.acoustic_winner)),
    recognized_phones_ipa: words.flatMap((item) =>
      item.phones.map((phone) => phone.acoustic_winner_ipa)
    ),
    gop_method: 'viterbi',
    alignment_path_score: -0.5,
    acoustic_model: 'test acoustic model',
    acoustic_phone_inventory: '39 CMU phones',
    reference_source: 'CMUdict test reference',
    dictionary_source: 'test dictionary',
    phones: words.flatMap((item) => item.phones),
    words
  }
}

function fixture(relativePath: string): unknown {
  const path = resolve(import.meta.dirname, '../../../../.gop-research/exam', relativePath)
  return JSON.parse(readFileSync(path, 'utf8'))
}
