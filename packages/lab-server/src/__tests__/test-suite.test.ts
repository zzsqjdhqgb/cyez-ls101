import { describe, expect, it } from 'vitest'
import { decodeExamPackage } from '@ls101/exam-package'
import { TEST_EXAM_BYTES, TEST_EXAM_DIGEST, TEST_SUITE } from '../test-suite'
import { hash } from '../identity'

describe('installed deployment suite', () => {
  it('ships decodable real bitmap/audio resources and matching answer capture', async () => {
    const { exam, resources } = await decodeExamPackage(TEST_EXAM_BYTES)
    expect(hash(TEST_EXAM_BYTES)).toBe(TEST_EXAM_DIGEST)
    const bitmap = Buffer.from(resources.image),
      tone = Buffer.from(resources.tone)
    expect(bitmap.toString('ascii', 0, 2)).toBe('BM')
    expect(bitmap.readUInt32LE(2)).toBe(bitmap.length)
    expect(bitmap.readInt32LE(18)).toBe(96)
    expect(tone.toString('ascii', 0, 4)).toBe('RIFF')
    expect(tone.toString('ascii', 8, 12)).toBe('WAVE')
    expect(tone.readUInt32LE(40)).toBe(tone.length - 44)
    expect(
      exam.examData.player.pages.flatMap((page) => page.timeline).map((step) => step.type)
    ).toEqual(['play', 'countdown', 'record'])
    expect(exam.answerCapturePlan).toEqual({
      strings: [{ stringAnswerIndex: 0, choiceIndex: 0 }],
      audios: [{ audioAnswerIndex: 0, recordIndex: 0 }]
    })
    expect(
      TEST_SUITE.cases.filter((item) => item.requiresManualConfirmation).map((item) => item.id)
    ).toEqual(['playback', 'audio'])
  })
})
