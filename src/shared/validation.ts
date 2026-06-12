/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/shared/validation.ts
// 纯数据结构合法性检查，与 Electron / React 无关

export interface ValidationError {
  questionIndex: number
  message: string
}

/**
 * 对一个完整的 ExamPackage 进行纯文本结构检查
 * 返回错误数组，空数组表示合法
 */
export function validateExamPackage(pkg: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!pkg || typeof pkg !== 'object') {
    return [{ questionIndex: -1, message: 'Invalid exam package format' }]
  }

  const exam = pkg as Record<string, unknown>

  if (!Array.isArray(exam.questions)) {
    return [{ questionIndex: -1, message: 'questions must be an array' }]
  }

  const questions = exam.questions as unknown[]

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    if (!q || typeof q !== 'object') {
      errors.push({ questionIndex: i, message: 'Question is not an object' })
      continue
    }

    const question = q as Record<string, unknown>

    if (typeof question.id !== 'string') {
      errors.push({ questionIndex: i, message: 'Missing or invalid id' })
    }

    if (!Array.isArray(question.content)) {
      errors.push({ questionIndex: i, message: 'content must be an array' })
      continue
    }

    const content = question.content as unknown[]
    let mediaCount = 0

    for (const node of content) {
      if (!node || typeof node !== 'object') {
        errors.push({ questionIndex: i, message: 'Content node is not an object' })
        continue
      }

      const n = node as Record<string, unknown>

      if (!['text', 'image', 'video', 'audio', 'quad-image'].includes(n.type as string)) {
        errors.push({ questionIndex: i, message: `Invalid content node type: ${n.type}` })
        continue
      }

      if (n.type === 'text' && typeof n.text !== 'string') {
        errors.push({ questionIndex: i, message: 'Text node must have a text string' })
      }

      if (n.type === 'image' && (!n.src || typeof n.src !== 'string')) {
        errors.push({ questionIndex: i, message: 'Image node must have src string' })
      }

      if (n.type === 'video') {
        if (!n.src || typeof n.src !== 'string') {
          errors.push({ questionIndex: i, message: 'Video node must have src string' })
        }
        mediaCount++
      }

      // 修改点：audio 节点强制要求 text 和 src
      if (n.type === 'audio') {
        if (typeof n.src !== 'string') {
          errors.push({ questionIndex: i, message: 'Audio node must have src string' })
        }
        if (typeof n.text !== 'string') {
          errors.push({ questionIndex: i, message: 'Audio node must have text string' })
        }
        mediaCount++
      }

      if (n.type === 'quad-image') {
        if (!Array.isArray(n.images) || n.images.length !== 4) {
          errors.push({
            questionIndex: i,
            message: 'quad-image must have images array of 4 strings'
          })
        }
      }
    }

    // 检查时间控制
    if (!question.time || typeof question.time !== 'object') {
      errors.push({ questionIndex: i, message: 'Missing time control' })
      continue
    }

    const time = question.time as Record<string, unknown>
    if (!['countdown', 'record', 'content-controlled'].includes(time.type as string)) {
      errors.push({ questionIndex: i, message: `Invalid time type: ${time.type}` })
    }

    if (time.type === 'countdown' && typeof time.seconds !== 'number') {
      errors.push({ questionIndex: i, message: 'countdown must have seconds (number)' })
    }

    if (time.type === 'record' && typeof time.duration !== 'number') {
      errors.push({ questionIndex: i, message: 'record must have duration (number)' })
    }

    // content-controlled 下必须有且仅有一个视频或音频节点
    if (time.type === 'content-controlled') {
      if (mediaCount !== 1) {
        errors.push({
          questionIndex: i,
          message: `content-controlled must have exactly one video or audio node, found ${mediaCount}`
        })
      }
    }
    // 不再限制其他时间类型下有音频节点（允许指令音频等）
  }

  // 验证 gradingInfo（如果存在）
  if (exam.gradingInfo !== undefined) {
    if (!Array.isArray(exam.gradingInfo)) {
      errors.push({ questionIndex: -1, message: 'gradingInfo must be an array' })
    } else {
      const gradingItems = exam.gradingInfo as Record<string, unknown>[]
      const seenRecordIndices = new Set<number>()
      let expectedId = 0

      const questions = exam.questions as Record<string, unknown>[]
      const validRecordIndices = new Set<number>()
      for (const q of questions) {
        const time = q.time as Record<string, unknown>
        if (time && time.type === 'record' && typeof time.recordIndex === 'number') {
          validRecordIndices.add(time.recordIndex)
        }
      }

      for (let gi = 0; gi < gradingItems.length; gi++) {
        const item = gradingItems[gi]
        if (typeof item.id !== 'number') {
          errors.push({ questionIndex: -1, message: `gradingInfo[${gi}].id must be a number` })
        } else if (item.id !== expectedId) {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}].id must be ${expectedId}, got ${item.id}`
          })
        }
        expectedId++

        if (!Array.isArray(item.recordIndices)) {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}].recordIndices must be an array`
          })
        } else {
          for (let ri = 0; ri < item.recordIndices.length; ri++) {
            const recordIdx = item.recordIndices[ri]
            if (typeof recordIdx !== 'number' || !Number.isInteger(recordIdx) || recordIdx < 0) {
              errors.push({
                questionIndex: -1,
                message: `gradingInfo[${gi}].recordIndices[${ri}] must be a non-negative integer`
              })
            } else {
              if (!validRecordIndices.has(recordIdx)) {
                errors.push({
                  questionIndex: -1,
                  message: `gradingInfo[${gi}].recordIndices[${ri}] ${recordIdx} does not match any question's recordIndex`
                })
              }
              if (seenRecordIndices.has(recordIdx)) {
                errors.push({
                  questionIndex: -1,
                  message: `gradingInfo[${gi}].recordIndices[${ri}] ${recordIdx} is duplicated`
                })
              }
              seenRecordIndices.add(recordIdx)
            }
          }
        }

        if (typeof item.problemInfo !== 'string') {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}].problemInfo must be a string`
          })
        }
        if (typeof item.gradingInfo !== 'string') {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}].gradingInfo must be a string`
          })
        }
        if (item.fullScore !== undefined) {
          if (typeof item.fullScore !== 'number' || item.fullScore <= 0) {
            errors.push({
              questionIndex: -1,
              message: `gradingInfo[${gi}].fullScore must be a positive number`
            })
          }
        }

        if (item.scoreOptions !== undefined) {
          if (!Array.isArray(item.scoreOptions)) {
            errors.push({
              questionIndex: -1,
              message: `gradingInfo[${gi}].scoreOptions must be an array`
            })
          } else if (item.scoreOptions.length === 0) {
            errors.push({
              questionIndex: -1,
              message: `gradingInfo[${gi}].scoreOptions must not be empty`
            })
          } else {
            for (let si = 0; si < item.scoreOptions.length; si++) {
              const sv = item.scoreOptions[si]
              if (typeof sv !== 'number' || sv < 0) {
                errors.push({
                  questionIndex: -1,
                  message: `gradingInfo[${gi}].scoreOptions[${si}] must be a non-negative number`
                })
              }
              if (si > 0 && sv <= (item.scoreOptions[si - 1] as number)) {
                errors.push({
                  questionIndex: -1,
                  message: `gradingInfo[${gi}].scoreOptions must be strictly increasing`
                })
              }
            }
            const maxOpt = item.scoreOptions[item.scoreOptions.length - 1] as number
            if (typeof item.fullScore === 'number' && maxOpt !== item.fullScore) {
              errors.push({
                questionIndex: -1,
                message: `gradingInfo[${gi}].scoreOptions last value ${maxOpt} must equal fullScore ${item.fullScore}`
              })
            }
          }
        }
      }

      if (seenRecordIndices.size !== validRecordIndices.size) {
        errors.push({
          questionIndex: -1,
          message: `gradingInfo covers ${seenRecordIndices.size} record indices but exam has ${validRecordIndices.size}`
        })
      }
    }
  }

  return errors
}
