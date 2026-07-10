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

  // Validate choicePageGroups if present
  const groupInfo = new Map<number, { totalPages: number; totalChoiceCount: number; choiceIds: number[] }>()
  const choicePageGroups = exam.choicePageGroups as Record<string, unknown>[] | undefined
  if (choicePageGroups !== undefined) {
    if (!Array.isArray(choicePageGroups)) {
      errors.push({ questionIndex: -1, message: 'choicePageGroups must be an array' })
    } else {
      for (let gi = 0; gi < choicePageGroups.length; gi++) {
        const pages = choicePageGroups[gi] as unknown
        if (!Array.isArray(pages) || pages.length === 0) {
          errors.push({ questionIndex: -1, message: `choicePageGroups[${gi}] must be a non-empty array of pages` })
          continue
        }
        const seenIds = new Set<number>()
        let count = 0
        for (let pi = 0; pi < pages.length; pi++) {
          const page = pages[pi] as Record<string, unknown>
          if (!page || !Array.isArray(page.questions)) {
            errors.push({ questionIndex: -1, message: `choicePageGroups[${gi}][${pi}].questions must be an array` })
            continue
          }
          for (const cq of page.questions) {
            const cqObj = cq as Record<string, unknown>
            if (typeof cqObj.id === 'number' && cqObj.id >= 1) {
              if (seenIds.has(cqObj.id)) {
                errors.push({ questionIndex: -1, message: `Duplicate choice question id ${cqObj.id} in choicePageGroups[${gi}]` })
              }
              seenIds.add(cqObj.id)
              count++
            }
          }
        }
        groupInfo.set(gi, { totalPages: pages.length, totalChoiceCount: count, choiceIds: [...seenIds] })
      }
    }
  }

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

    const timeArray = Array.isArray(question.time) ? question.time : [question.time]
    for (let ti = 0; ti < timeArray.length; ti++) {
      const time = timeArray[ti] as Record<string, unknown>
      const timeLabel = timeArray.length > 1 ? `time[${ti}]: ` : ''

      if (!['countdown', 'record', 'content-controlled'].includes(time.type as string)) {
        errors.push({ questionIndex: i, message: `Invalid time type: ${time.type}` })
      }

      if (time.type === 'countdown' && typeof time.seconds !== 'number') {
        errors.push({
          questionIndex: i,
          message: `${timeLabel}countdown must have seconds (number)`
        })
      }

      if (time.type === 'record' && typeof time.duration !== 'number') {
        errors.push({ questionIndex: i, message: `${timeLabel}record must have duration (number)` })
      }

      if (time.type === 'content-controlled' && mediaCount !== 1) {
        errors.push({
          questionIndex: i,
          message: `${timeLabel}content-controlled must have exactly one video or audio node, found ${mediaCount}`
        })
      }

      if (
        typeof time.focusId === 'number' &&
        (time.focusId < 1 || !Number.isInteger(time.focusId))
      ) {
        errors.push({ questionIndex: i, message: `${timeLabel}focusId must be a positive integer` })
      }

      if (time.pageRange !== undefined) {
        if (
          !Array.isArray(time.pageRange) ||
          time.pageRange.length !== 2 ||
          typeof time.pageRange[0] !== 'number' ||
          typeof time.pageRange[1] !== 'number' ||
          !Number.isInteger(time.pageRange[0]) ||
          !Number.isInteger(time.pageRange[1]) ||
          time.pageRange[0] < 0 ||
          time.pageRange[1] < time.pageRange[0]
        ) {
          errors.push({
            questionIndex: i,
            message: `${timeLabel}pageRange must be [start, end] with 0 <= start <= end`
          })
        }
        if (typeof time.focusId === 'number') {
          errors.push({
            questionIndex: i,
            message: `${timeLabel}pageRange and focusId cannot both be set`
          })
        }
      }

      if (time.type === 'countdown' && typeof time.seconds !== 'number') {
        errors.push({
          questionIndex: i,
          message: `${timeLabel}: countdown must have seconds (number)`
        })
      }

      if (time.type === 'record' && typeof time.duration !== 'number') {
        errors.push({
          questionIndex: i,
          message: `${timeLabel}: record must have duration (number)`
        })
      }

      if (time.type === 'content-controlled' && mediaCount !== 1) {
        errors.push({
          questionIndex: i,
          message: `content-controlled must have exactly one video or audio node, found ${mediaCount}`
        })
      }

      if (
        typeof time.focusId === 'number' &&
        (time.focusId < 1 || !Number.isInteger(time.focusId))
      ) {
        errors.push({
          questionIndex: i,
          message: `${timeLabel}: focusId must be a positive integer`
        })
      }
    }

    // If question has choicePages, validate them
    if (question.choicePages !== undefined) {
      if (!Array.isArray(question.choicePages) || question.choicePages.length === 0) {
        errors.push({ questionIndex: i, message: 'choicePages must be a non-empty array' })
      } else {
        const seenChoiceIds = new Set<number>()
        let totalChoiceCount = 0
        for (let pi = 0; pi < question.choicePages.length; pi++) {
          const page = question.choicePages[pi] as Record<string, unknown>
          if (!page || typeof page !== 'object' || !Array.isArray(page.questions)) {
            errors.push({
              questionIndex: i,
              message: `choicePages[${pi}].questions must be an array`
            })
            continue
          }
          const pageQuestions = page.questions as Record<string, unknown>[]
          if (pageQuestions.length === 0) {
            errors.push({
              questionIndex: i,
              message: `choicePages[${pi}].questions must not be empty`
            })
          }
          for (let qi = 0; qi < pageQuestions.length; qi++) {
            const cq = pageQuestions[qi]
            if (typeof cq.id !== 'number' || cq.id < 1) {
              errors.push({
                questionIndex: i,
                message: `choicePages[${pi}].questions[${qi}].id must be a number >= 1`
              })
            } else {
              if (seenChoiceIds.has(cq.id)) {
                errors.push({ questionIndex: i, message: `Duplicate choice question id: ${cq.id}` })
              }
              seenChoiceIds.add(cq.id)
              totalChoiceCount++
            }
            if (typeof cq.stem !== 'string') {
              errors.push({
                questionIndex: i,
                message: `choicePages[${pi}].questions[${qi}].stem must be a string`
              })
            }
            if (!Array.isArray(cq.options) || cq.options.length !== 4) {
              errors.push({
                questionIndex: i,
                message: `choicePages[${pi}].questions[${qi}].options must be an array of 4 strings`
              })
            } else {
              for (let oi = 0; oi < cq.options.length; oi++) {
                if (typeof cq.options[oi] !== 'string') {
                  errors.push({
                    questionIndex: i,
                    message: `choicePages[${pi}].questions[${qi}].options[${oi}] must be a string`
                  })
                }
              }
            }
            const validAnswers = ['A', 'B', 'C', 'D']
            if (typeof cq.answer !== 'string' || !validAnswers.includes(cq.answer)) {
              errors.push({
                questionIndex: i,
                message: `choicePages[${pi}].questions[${qi}].answer must be A, B, C, or D`
              })
            }
          }
        }
        // Validate focusId/pageRange in timers (inline pages)
        const questionTimeArray = Array.isArray(question.time) ? question.time : [question.time]
        for (const tc of questionTimeArray as Record<string, unknown>[]) {
          if (tc && typeof tc.focusId === 'number') {
            if (tc.focusId < 1 || tc.focusId > totalChoiceCount) {
              errors.push({
                questionIndex: i,
                message: `focusId ${tc.focusId} must be between 1 and total choice questions (${totalChoiceCount})`
              })
            }
          }
          if (tc && tc.pageRange !== undefined) {
            const pr = tc.pageRange as number[]
            if (pr[1] >= question.choicePages!.length) {
              errors.push({
                questionIndex: i,
                message: `pageRange end ${pr[1]} must be less than total pages (${question.choicePages!.length})`
              })
            }
          }
        }
      }
    }

    // Validate choicePageGroupId if present
    if (question.choicePageGroupId !== undefined) {
      const gid = question.choicePageGroupId as number
      if (typeof gid !== 'number' || gid < 0 || !Number.isInteger(gid)) {
        errors.push({ questionIndex: i, message: 'choicePageGroupId must be a non-negative integer' })
      } else if (!choicePageGroups) {
        errors.push({ questionIndex: i, message: `choicePageGroupId specified but choicePageGroups is not defined` })
      } else if (!groupInfo.has(gid)) {
        errors.push({ questionIndex: i, message: `choicePageGroupId ${gid} does not match any group in choicePageGroups` })
      }
    }

    // If no inline choicePages, validate focusId/pageRange against the group
    if (question.choicePages === undefined && question.choicePageGroupId !== undefined) {
      const gid = question.choicePageGroupId as number
      const info = groupInfo.get(gid)
      if (info) {
        const questionTimeArray = Array.isArray(question.time) ? question.time : [question.time]
        for (const tc of questionTimeArray as Record<string, unknown>[]) {
          if (tc && typeof tc.focusId === 'number') {
            if (tc.focusId < 1 || tc.focusId > info.totalChoiceCount) {
              errors.push({
                questionIndex: i,
                message: `focusId ${tc.focusId} must be between 1 and total choice questions (${info.totalChoiceCount})`
              })
            }
          }
          if (tc && tc.pageRange !== undefined) {
            const pr = tc.pageRange as number[]
            if (pr[1] >= info.totalPages) {
              errors.push({
                questionIndex: i,
                message: `pageRange end ${pr[1]} must be less than total pages (${info.totalPages})`
              })
            }
          }
        }
      }
    }
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
        const time = q.time
        const timeArray = Array.isArray(time) ? time : [time]
        for (const tc of timeArray as Record<string, unknown>[]) {
          if (tc && tc.type === 'record' && typeof tc.recordIndex === 'number') {
            validRecordIndices.add(tc.recordIndex)
          }
        }
      }

      for (let gi = 0; gi < gradingItems.length; gi++) {
        const item = gradingItems[gi]

        // Check mutual exclusivity: must have either id or choiceId, not both
        const hasId = 'id' in item
        const hasChoiceId = 'choiceId' in item
        if (hasId && hasChoiceId) {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}] cannot have both id and choiceId`
          })
          continue
        }
        if (!hasId && !hasChoiceId) {
          errors.push({
            questionIndex: -1,
            message: `gradingInfo[${gi}] must have either id or choiceId`
          })
          continue
        }

        if (hasChoiceId) {
          // Validate ChoiceGradingInfoItem
          if (typeof item.choiceId !== 'number' || item.choiceId < 1) {
            errors.push({
              questionIndex: -1,
              message: `gradingInfo[${gi}].choiceId must be a number >= 1`
            })
          } else {
            let found = false
            for (const q of questions) {
              const cp = q.choicePages as Record<string, unknown>[] | undefined
              if (cp) {
                for (const page of cp) {
                  const qs = page.questions as Record<string, unknown>[]
                  if (qs && qs.some((cq) => cq.id === item.choiceId)) {
                    found = true
                    break
                  }
                }
                if (found) break
              }
            }
            if (!found && choicePageGroups) {
              for (const pages of choicePageGroups as unknown as Record<string, unknown>[][]) {
                for (const page of pages) {
                  const qs = page.questions as Record<string, unknown>[]
                  if (qs && qs.some((cq) => cq.id === item.choiceId)) {
                    found = true
                    break
                  }
                }
                if (found) break
              }
            }
            if (!found) {
              errors.push({
                questionIndex: -1,
                message: `gradingInfo[${gi}].choiceId ${item.choiceId} does not match any ChoiceQuestion`
              })
            }
          }
          if (typeof item.fullScore !== 'number' || item.fullScore <= 0) {
            errors.push({
              questionIndex: -1,
              message: `gradingInfo[${gi}].fullScore must be a positive number`
            })
          }
          continue
        }

        // Validate RecordingGradingInfoItem (hasId)
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

  // Validate choiceOnly
  if (exam.choiceOnly === true) {
    const questions = exam.questions as Record<string, unknown>[]
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const time = q.time
      const timeArray = Array.isArray(time) ? time : [time]
      for (const tc of timeArray as Record<string, unknown>[]) {
        if (tc && tc.type === 'record') {
          errors.push({
            questionIndex: i,
            message: 'choiceOnly exam cannot have record type timers'
          })
        }
      }
    }
  }

  return errors
}
