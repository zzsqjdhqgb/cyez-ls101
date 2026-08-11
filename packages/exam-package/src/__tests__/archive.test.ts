import type { ExamPackage, SchemaDefinition, SubmissionPackage } from '@ls101/core-types'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  decodeExamPackage,
  decodeSubmissionPackage,
  collectSubmissionPackageFiles,
  encodeExamPackage,
  encodeSubmissionPackage,
  ExamPackageArchiveError,
  validateExamPackage,
  validateSubmissionPackage
} from '../index'

const objectiveSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000001',
  sourceDraftId: '20000000-0000-4000-8000-000000000001',
  structureHash: `sha256:${'1'.repeat(64)}`,
  revision: 0,
  structure: {
    questionType: 'objective',
    answerFormat: [{ answerId: 'answer', type: 'text' }],
    templateInputs: [
      { inputId: 'question-description', type: 'text', required: true },
      { inputId: 'analysis', type: 'text', required: true }
    ]
  },
  data: {
    name: 'Objective question',
    description: 'Objective grading schema',
    maxScore: 2,
    answerDescriptions: { answer: 'Student answer' },
    inputDescriptions: {},
    rubricMarkdown: ''
  }
}

const readingSchema: SchemaDefinition = {
  formatVersion: 2,
  schemaId: '10000000-0000-4000-8000-000000000002',
  sourceDraftId: '20000000-0000-4000-8000-000000000002',
  structureHash: `sha256:${'2'.repeat(64)}`,
  revision: 1,
  structure: {
    questionType: 'fixed-reading',
    answerFormat: [{ answerId: 'sentence', type: 'fixed-speech' }],
    templateInputs: [{ inputId: 'question-description', type: 'text', required: true }]
  },
  data: {
    name: 'Reading question',
    description: 'Reading grading schema',
    maxScore: 10,
    answerDescriptions: { sentence: 'Reading recording' },
    inputDescriptions: {},
    rubricMarkdown: 'Grade pronunciation.'
  }
}

function examPackage(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: 'exam-package-1',
    examData: {
      title: 'Archive exam',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [],
            timeline: [{ type: 'record', duration: 1, recordIndex: 0 }]
          }
        ],
        recordingIndices: [0],
        choiceMeta: {
          pages: [{ questionIndices: [0] }],
          questions: [
            {
              choiceIndex: 0,
              stem: 'Question',
              options: [
                { label: 'A', content: 'First' },
                { label: 'B', content: 'Second' }
              ]
            }
          ]
        }
      },
      resources: {
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        }
      }
    },
    answerCapturePlan: {
      strings: [{ stringAnswerIndex: 0, choiceIndex: 0 }],
      audios: [{ audioAnswerIndex: 0, recordIndex: 0 }]
    },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: { examPackageId: 'exam-package-1', examTitle: 'Archive exam' },
      schemaUses: [
        {
          instanceId: 'schema-use:objective',
          schema: objectiveSchema,
          inputs: [
            { inputId: 'question-description', type: 'text', value: 'Choose one.' },
            { inputId: 'analysis', type: 'text', value: 'A' }
          ],
          answers: [{ answerId: 'answer', type: 'text', stringAnswerIndex: 0 }]
        },
        {
          instanceId: 'schema-use:reading',
          schema: readingSchema,
          inputs: [
            {
              inputId: 'question-description',
              type: 'text',
              value: 'Read ![image](resource:picture).'
            }
          ],
          answers: [
            {
              answerId: 'sentence',
              type: 'fixed-speech',
              text: 'Hello.',
              audioAnswerIndex: 0
            }
          ]
        }
      ],
      resources: {
        picture: {
          filename: 'picture.png',
          packagePath: 'resources/picture/picture.png',
          mediaType: 'image/png'
        }
      }
    }
  }
}

function submissionPackage(): SubmissionPackage {
  const exam = examPackage()
  return {
    ...structuredClone(exam.submissionTemplate),
    meta: {
      ...structuredClone(exam.submissionTemplate.meta),
      submissionId: 'submission-1',
      candidate: { candidateId: 'candidate-1', displayName: 'Student' },
      startedAt: '2026-08-10T01:00:00Z',
      submittedAt: '2026-08-10T01:10:00+00:00'
    },
    answers: {
      strings: ['A'],
      audios: [{ resourceKey: 'answer-audio-0', durationMs: 1200 }]
    },
    resources: {
      ...structuredClone(exam.submissionTemplate.resources),
      'answer-audio-0': {
        filename: 'recording-0.ogg',
        packagePath: 'recordings/answer-audio-0/recording-0.ogg',
        mediaType: 'audio/ogg'
      }
    }
  }
}

const pictureBytes = new Uint8Array([1, 2, 3])
const recordingBytes = new Uint8Array([4, 5, 6, 7])

describe('ExamPackage ZIP archive', () => {
  it('往返保存 manifest 和考试资源', async () => {
    const exam = examPackage()
    const bytes = await encodeExamPackage(exam, { picture: pictureBytes })
    const entries = unzipSync(bytes)

    expect(Object.keys(entries).sort()).toEqual(['manifest.json', 'resources/picture/picture.png'])
    const decoded = await decodeExamPackage(bytes)
    expect(decoded.exam).toEqual(exam)
    expect(decoded.resources.picture).toEqual(pictureBytes)
  })

  it('拒绝引用不存在播放器输出的捕获计划', () => {
    const exam = examPackage()
    exam.answerCapturePlan.audios[0].recordIndex = 99

    expect(() => validateExamPackage(exam)).toThrowError(ExamPackageArchiveError)
  })

  it('拒绝没有页面的试卷', () => {
    const exam = examPackage()
    exam.examData.player.pages = []

    expect(() => validateExamPackage(exam)).toThrow('Invalid ExamPackage manifest')
  })

  it('拒绝零秒录音动作', () => {
    const exam = examPackage()
    const step = exam.examData.player.pages[0].timeline[0]
    if (step.type === 'record') step.duration = 0

    expect(() => validateExamPackage(exam)).toThrow('Invalid ExamPackage manifest')
  })

  it('校验播放器页面图片的资源引用', () => {
    const valid = examPackage()
    valid.examData.player.pages[0].content.push({
      id: 'image-1',
      type: 'image',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      src: 'resource:picture'
    })
    expect(() => validateExamPackage(valid)).not.toThrow()

    const missing = structuredClone(valid)
    const image = missing.examData.player.pages[0].content[0]
    if (image.type === 'image') image.src = 'resource:missing'
    expect(() => validateExamPackage(missing)).toThrow('Player image references missing resource')
  })

  it('考试资源和作答模板静态附件只能使用 resources 路径', () => {
    const examResource = examPackage()
    examResource.examData.resources.picture.packagePath = 'recordings/picture/picture.png'
    expect(() => validateExamPackage(examResource)).toThrow('Invalid ExamPackage manifest')

    const templateResource = examPackage()
    templateResource.submissionTemplate.resources.picture.packagePath =
      'recordings/picture/picture.png'
    expect(() => validateExamPackage(templateResource)).toThrow('Invalid ExamPackage manifest')
  })

  it('拒绝缺失和多余资源', async () => {
    await expect(encodeExamPackage(examPackage(), {})).rejects.toThrow('Missing resource bytes')
    await expect(
      encodeExamPackage(examPackage(), { picture: pictureBytes, extra: new Uint8Array() })
    ).rejects.toThrow('without a manifest resource entry')
  })
})

describe('SubmissionPackage ZIP archive', () => {
  it('脱离 ExamPackage 往返保存完整批改快照和全部文件', async () => {
    const submission = submissionPackage()
    const bytes = await encodeSubmissionPackage(submission, {
      picture: pictureBytes,
      'answer-audio-0': recordingBytes
    })
    const decoded = await decodeSubmissionPackage(bytes)

    expect(decoded.submission).toEqual(submission)
    expect(decoded.submission.schemaUses[1].schema).toEqual(readingSchema)
    expect(decoded.files).toEqual({
      picture: pictureBytes,
      'answer-audio-0': recordingBytes
    })
  })

  it('拒绝越界答案索引和缺失音频资源引用', () => {
    const badIndex = submissionPackage()
    const readingAnswer = badIndex.schemaUses[1].answers[0]
    if (readingAnswer.type === 'fixed-speech') readingAnswer.audioAnswerIndex = 4
    expect(() => validateSubmissionPackage(badIndex)).toThrow('outside its answer pool')

    const missingAudio = submissionPackage()
    delete missingAudio.resources['answer-audio-0']
    expect(() => validateSubmissionPackage(missingAudio)).toThrow(
      'Audio answer references missing resource'
    )
  })

  it('要求 SchemaUse 答案 ID 完整唯一，同时允许复用答案池索引', () => {
    const sharedIndex = submissionPackage()
    const use = sharedIndex.schemaUses[1]
    use.schema.structure.answerFormat.push({ answerId: 'sentence-2', type: 'fixed-speech' })
    use.schema.data.answerDescriptions['sentence-2'] = 'Second sentence'
    use.answers.push({
      answerId: 'sentence-2',
      type: 'fixed-speech',
      text: 'World.',
      audioAnswerIndex: 0
    })
    expect(() => validateSubmissionPackage(sharedIndex)).not.toThrow()

    const duplicate = structuredClone(sharedIndex)
    duplicate.schemaUses[1].answers[1].answerId = 'sentence'
    expect(() => validateSubmissionPackage(duplicate)).toThrow('Invalid SubmissionPackage manifest')

    const missing = structuredClone(sharedIndex)
    missing.schemaUses[1].answers.pop()
    expect(() => validateSubmissionPackage(missing)).toThrow('Invalid SubmissionPackage manifest')
  })

  it('从完整考试资源和录音中收集作答归档文件', () => {
    expect(
      collectSubmissionPackageFiles(
        submissionPackage(),
        { picture: pictureBytes, 'player-only': new Uint8Array([8]) },
        { 'answer-audio-0': recordingBytes }
      )
    ).toEqual({ picture: pictureBytes, 'answer-audio-0': recordingBytes })

    expect(() =>
      collectSubmissionPackageFiles(submissionPackage(), { picture: pictureBytes }, {})
    ).toThrow('Missing recording resource')
  })

  it('拒绝重复资源路径和包含路径的文件名', () => {
    const duplicatePath = submissionPackage()
    duplicatePath.resources['answer-audio-0'] = {
      ...duplicatePath.resources.picture,
      filename: 'picture.png'
    }
    expect(() => validateSubmissionPackage(duplicatePath)).toThrow(
      'Invalid SubmissionPackage manifest'
    )

    const pathInFilename = submissionPackage()
    pathInFilename.resources.picture.filename = 'nested/picture.png'
    pathInFilename.resources.picture.packagePath = 'resources/picture/nested%2Fpicture.png'
    expect(() => validateSubmissionPackage(pathInFilename)).toThrow(
      'Invalid SubmissionPackage manifest'
    )
  })

  it('拒绝 URL 规范化后发生碰撞的资源路径', () => {
    const collision = examPackage()
    collision.examData.resources.encoded = {
      filename: 'a.wav',
      packagePath: 'resources/x/%2e%2e/b/a.wav',
      mediaType: 'audio/wav'
    }
    collision.examData.resources.direct = {
      filename: 'a.wav',
      packagePath: 'resources/b/a.wav',
      mediaType: 'audio/wav'
    }

    expect(() => validateExamPackage(collision)).toThrow('Invalid ExamPackage manifest')
  })

  it('按引用用途区分最终作答包中的静态附件和录音', () => {
    const staticAsRecording = submissionPackage()
    staticAsRecording.resources.picture.packagePath = 'recordings/picture/picture.png'
    expect(() => validateSubmissionPackage(staticAsRecording)).toThrow(
      'SchemaUse references non-static resource'
    )

    const recordingAsStatic = submissionPackage()
    recordingAsStatic.resources['answer-audio-0'].packagePath =
      'resources/answer-audio-0/recording-0.ogg'
    expect(() => validateSubmissionPackage(recordingAsStatic)).toThrow(
      'Audio answer resource is outside recordings/'
    )
  })

  it('接受带负时区偏移的时间并拒绝倒置的考试时间', () => {
    const offset = submissionPackage()
    offset.meta.startedAt = '2026-08-10T01:00:00-05:30'
    offset.meta.submittedAt = '2026-08-10T01:10:00-05:30'
    expect(() => validateSubmissionPackage(offset)).not.toThrow()

    const reversed = submissionPackage()
    reversed.meta.submittedAt = '2026-08-10T00:59:59Z'
    expect(() => validateSubmissionPackage(reversed)).toThrow('Invalid SubmissionPackage manifest')
  })

  it('拒绝路径穿越、缺失文件和未知归档文件', async () => {
    const unsafe = submissionPackage()
    unsafe.resources.picture.packagePath = '../picture.png'
    await expect(
      encodeSubmissionPackage(unsafe, {
        picture: pictureBytes,
        'answer-audio-0': recordingBytes
      })
    ).rejects.toThrow('Invalid SubmissionPackage manifest')

    const validBytes = await encodeSubmissionPackage(submissionPackage(), {
      picture: pictureBytes,
      'answer-audio-0': recordingBytes
    })
    const missing = unzipSync(validBytes)
    delete missing['resources/picture/picture.png']
    await expect(decodeSubmissionPackage(zipSync(missing))).rejects.toThrow('Missing resource file')

    const extra = unzipSync(validBytes)
    extra['unexpected.txt'] = strToU8('unexpected')
    await expect(decodeSubmissionPackage(zipSync(extra))).rejects.toThrow(
      'Unexpected file in archive'
    )
  })

  it('拒绝损坏的 ZIP 和 manifest', async () => {
    await expect(decodeSubmissionPackage(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      ExamPackageArchiveError
    )
    await expect(
      decodeSubmissionPackage(zipSync({ 'manifest.json': strToU8('{broken') }))
    ).rejects.toThrow('Invalid UTF-8 JSON file')
  })
})
