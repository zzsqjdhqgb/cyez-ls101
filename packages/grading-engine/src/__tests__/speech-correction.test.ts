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
  normalizePlainTextResponse,
  SPEECH_CORRECTION_SYSTEM_PROMPT
} from '../speech-correction'

describe('GOP + LLM v4 plain-text speech correction', () => {
  it('selects every low-GOP row and keeps the frozen word contexts', () => {
    const transcript = 'FULL TRANSCRIPT STAYS IN THE REQUEST word one target word four'
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
  })

  it('sends the full frozen evidence, including the transcript and flat rows', () => {
    const evidence = createSpeechCorrectionEvidence({
      transcript: 'one target word',
      assessment: assessment([
        word(0, 'one', [phone(0, 0, 0, 'one', 'W', 'W', 1)]),
        word(1, 'target', [phone(1, 1, 0, 'target', 'T', 'D', -2)]),
        word(2, 'word', [phone(2, 2, 0, 'word', 'W', 'W', 1)])
      ])
    })

    const prompt = buildSpeechCorrectionPrompt(evidence)

    expect(prompt).toContain('保守的中文发音纠错说明')
    expect(prompt).toContain('不要给分数或等级')
    expect(prompt).toContain('"transcript": "one target word"')
    expect(prompt).toContain('"evidence_id": "GOP-0001"')
    expect(prompt).toContain('"context_text": "one target word"')
  })

  it('uses the frozen system prompt and returns the model prose untouched', async () => {
    const prose = [
      '这批低 GOP 证据多集中在弱读音节的中央元音上，属于模型偏好而非确认的错误。',
      '建议对照 target 一词慢速练习 /t/ 与 /d/ 的对立。'
    ].join('\n\n')
    const generate = vi.fn().mockResolvedValue(prose)

    const result = await correctSpeechWithLLM(
      {
        transcript: 'books',
        assessment: assessment([word(0, 'books', [phone(12, 0, 0, 'books', 'B', 'P', -2.277763)])])
      },
      { generate }
    )

    expect(generate).toHaveBeenCalledWith(expect.stringContaining('GOP-0012'), {
      signal: undefined,
      systemPrompt: SPEECH_CORRECTION_SYSTEM_PROMPT,
      temperature: 0,
      maxOutputTokens: 65_535
    })
    expect(result.correction).toBe(prose)
    expect(result.trace.rawResponse).toBe(prose)
    expect(result.trace.prompt).toContain('GOP-0012')
    expect(result.trace.evidence?.rows).toHaveLength(1)
  })

  it('strips accidental markdown code fences and rejects empty responses', () => {
    expect(normalizePlainTextResponse('```text\n第一段。\n\n第二段。\n```\n')).toBe(
      '第一段。\n\n第二段。'
    )
    expect(normalizePlainTextResponse('  直接可用的说明。  ')).toBe('直接可用的说明。')
    expect(() => normalizePlainTextResponse('')).toThrow('为空')
    expect(() => normalizePlainTextResponse('```\n```')).toThrow('为空')
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
    expect(result.correction).not.toContain('**')
    expect(result.trace).not.toHaveProperty('prompt')
    expect(result.trace.evidence?.rows).toEqual([])
  })

  it('echoes uncovered words in evidence and appends the prompt note only when present', () => {
    const coveredEvidence = createSpeechCorrectionEvidence({
      transcript: 'one target word',
      assessment: assessment([
        word(0, 'one', [phone(0, 0, 0, 'one', 'W', 'W', 1)]),
        word(1, 'target', [phone(1, 1, 0, 'target', 'T', 'D', -2)]),
        word(2, 'word', [phone(2, 2, 0, 'word', 'W', 'W', 1)])
      ])
    })
    const coveredPrompt = buildSpeechCorrectionPrompt(coveredEvidence)
    expect(coveredPrompt).not.toContain('补充：')
    // 无缺词时冻结 prompt 保持原样：仍然以证据 JSON 结尾，没有附加说明。
    expect(coveredPrompt.endsWith(JSON.stringify(coveredEvidence, null, 2))).toBe(true)

    const partialEvidence = createSpeechCorrectionEvidence({
      transcript: 'overweigh three',
      assessment: assessment([word(0, 'three', [phone(0, 0, 0, 'three', 'TH', 'S', -2)])], [
        'overweigh'
      ])
    })
    expect(partialEvidence.source_result.uncovered_words).toEqual(['overweigh'])
    const partialPrompt = buildSpeechCorrectionPrompt(partialEvidence)
    expect(partialPrompt).toContain('补充：以下单词不在标准发音词典中')
    expect(partialPrompt).toContain('overweigh')
    expect(partialPrompt).toContain('未参与强制对齐')
    expect(partialPrompt.endsWith(JSON.stringify(partialEvidence, null, 2))).toBe(false)
  })

  it('reproduces the committed frozen evidence payload', () => {
    const base = fixture('stable-gop-demo/result.json') as Record<string, unknown>
    const frozenEvidence = fixture('stable-gop-demo-llm-v3/evidence.json') as {
      rows: unknown[]
      word_contexts: unknown[]
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
      uncovered_words: [] as string[],
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
    expect(buildSpeechCorrectionPrompt(evidence)).toContain('"evidence_id": "GOP-0012"')
  })
})

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

function assessment(
  words: PronunciationAssessmentResult['words'],
  uncoveredWords: string[] = []
): PronunciationAssessmentResult {
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
    uncovered_words: uncoveredWords,
    phones: words.flatMap((item) => item.phones),
    words
  }
}

function fixture(relativePath: string): unknown {
  const path = resolve(import.meta.dirname, '../../../../.gop-research/exam', relativePath)
  return JSON.parse(readFileSync(path, 'utf8'))
}
