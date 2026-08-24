/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { describe, it, expect } from 'vitest'
import { validateExamPackage } from '../validation'
import type { ValidationError } from '../validation'

function findErr(errors: ValidationError[], msg: string): boolean {
  return errors.some((e) => e.message === msg)
}

describe('validateExamPackage', () => {
  it('rejects null', () => {
    const errors = validateExamPackage(null)
    expect(errors).toHaveLength(1)
    expect(errors[0].questionIndex).toBe(-1)
  })

  it('rejects non-object', () => {
    const errors = validateExamPackage('string')
    expect(errors).toHaveLength(1)
    expect(errors[0].questionIndex).toBe(-1)
  })

  it('rejects missing questions array', () => {
    const errors = validateExamPackage({ title: 'Test' })
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('questions must be an array')
  })

  it('validates a minimal valid exam', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'text', text: 'Hello' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects invalid content node type', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'invalid' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Invalid content node type: invalid')).toBe(true)
  })

  it('rejects text node without text string', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'text' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Text node must have a text string')).toBe(true)
  })

  it('rejects image node without src string', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'image' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Image node must have src string')).toBe(true)
  })

  it('rejects video node without src string', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'video' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Video node must have src string')).toBe(true)
  })

  it('rejects audio node without src', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'audio', text: 'Hello' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Audio node must have src string')).toBe(true)
  })

  it('rejects audio node without text', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'audio', src: 'media/audio.wav' }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(findErr(errors, 'Audio node must have text string')).toBe(true)
  })

  it('rejects quad-image without 4 images', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'quad-image', images: ['a', 'b'] }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(
      findErr(errors, 'quad-image must have images array of 4 strings')
    ).toBe(true)
  })

  it('validates quad-image with 4 images', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'quad-image', images: ['a', 'b', 'c', 'd'] }],
          time: { type: 'countdown', seconds: 60 }
        }
      ]
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects invalid question (not an object)', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: ['not an object']
    })
    expect(findErr(errors, 'Question is not an object')).toBe(true)
  })

  it('rejects missing question id', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [{ content: [], time: { type: 'countdown', seconds: 60 } }]
    })
    expect(findErr(errors, 'Missing or invalid id')).toBe(true)
  })

  it('rejects question without content array', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [{ id: 'q1', time: { type: 'countdown', seconds: 60 } }]
    })
    expect(findErr(errors, 'content must be an array')).toBe(true)
  })

  it('rejects missing time control', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [{ id: 'q1', content: [] }]
    })
    expect(findErr(errors, 'Missing time control')).toBe(true)
  })

  it('rejects invalid time type', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [],
          time: { type: 'invalid' }
        }
      ]
    })
    expect(findErr(errors, 'Invalid time type: invalid')).toBe(true)
  })

  it('rejects countdown without seconds', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [],
          time: { type: 'countdown' }
        }
      ]
    })
    expect(findErr(errors, 'countdown must have seconds (number)')).toBe(true)
  })

  it('rejects record without duration', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [],
          time: { type: 'record' }
        }
      ]
    })
    expect(findErr(errors, 'record must have duration (number)')).toBe(true)
  })

  it('requires exactly one media node for content-controlled', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [],
          time: { type: 'content-controlled' }
        }
      ]
    })
    expect(
      findErr(errors, 'content-controlled must have exactly one video or audio node, found 0')
    ).toBe(true)
  })

  it('validates content-controlled with one video', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'video', src: 'media/test.mp4' }],
          time: { type: 'content-controlled' }
        }
      ]
    })
    expect(errors).toHaveLength(0)
  })

  it('validates content-controlled with one audio', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [{ type: 'audio', src: 'media/test.wav', text: 'test' }],
          time: { type: 'content-controlled' }
        }
      ]
    })
    expect(errors).toHaveLength(0)
  })

  it('rejects content-controlled with multiple media nodes', () => {
    const errors = validateExamPackage({
      title: 'Test',
      questions: [
        {
          id: 'q1',
          content: [
            { type: 'video', src: 'a.mp4' },
            { type: 'audio', src: 'a.wav', text: 'test' }
          ],
          time: { type: 'content-controlled' }
        }
      ]
    })
    expect(
      findErr(errors, 'content-controlled must have exactly one video or audio node, found 2')
    ).toBe(true)
  })

  describe('gradingInfo validation', () => {
    it('rejects non-array gradingInfo', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: 'not array',
        questions: []
      })
      expect(findErr(errors, 'gradingInfo must be an array')).toBe(true)
    })

    it('rejects gradingInfo item with non-number id', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 'string', recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 10 }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(findErr(errors, 'gradingInfo[0].id must be a number')).toBe(true)
    })

    it('rejects non-sequential gradingInfo ids', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [
          { id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 10 },
          { id: 5, recordIndices: [1], problemInfo: '', gradingInfo: '', fullScore: 10 }
        ],
        questions: [
          { id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } },
          { id: 'q2', content: [], time: { type: 'record', duration: 30, recordIndex: 1 } }
        ]
      })
      expect(findErr(errors, 'gradingInfo[1].id must be 1, got 5')).toBe(true)
    })

    it('rejects recordIndex not matching any question', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [99], problemInfo: '', gradingInfo: '', fullScore: 10 }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[0].recordIndices[0] 99 does not match any question\'s recordIndex')
      ).toBe(true)
    })

    it('rejects duplicate recordIndex', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [
          { id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 10 },
          { id: 1, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 10 }
        ],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[1].recordIndices[0] 0 is duplicated')
      ).toBe(true)
    })

    it('rejects missing problemInfo', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], gradingInfo: '', fullScore: 10 }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[0].problemInfo must be a string')
      ).toBe(true)
    })

    it('rejects missing gradingInfo string', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', fullScore: 10 }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[0].gradingInfo must be a string')
      ).toBe(true)
    })

    it('rejects non-positive fullScore', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 0 }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[0].fullScore must be a positive number')
      ).toBe(true)
    })

    it('accepts missing fullScore', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '' }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(
        findErr(errors, 'gradingInfo[0].fullScore must be a positive number')
      ).toBe(false)
    })

    it('rejects incomplete gradingInfo coverage', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 10 }],
        questions: [
          { id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } },
          { id: 'q2', content: [], time: { type: 'record', duration: 30, recordIndex: 1 } }
        ]
      })
      expect(
        findErr(errors, 'gradingInfo covers 1 record indices but exam has 2')
      ).toBe(true)
    })

    it('validates complete and correct gradingInfo', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [
          { id: 0, recordIndices: [0], problemInfo: 'Problem 1', gradingInfo: 'Grading 1', fullScore: 10 },
          { id: 1, recordIndices: [1], problemInfo: 'Problem 2', gradingInfo: 'Grading 2', fullScore: 15 }
        ],
        questions: [
          { id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } },
          { id: 'q2', content: [], time: { type: 'record', duration: 30, recordIndex: 1 } }
        ]
      })
      expect(errors).toHaveLength(0)
    })

    it('rejects non-array scoreOptions', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 5, scoreOptions: 'bad' }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(findErr(errors, 'gradingInfo[0].scoreOptions must be an array')).toBe(true)
    })

    it('rejects empty scoreOptions', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 5, scoreOptions: [] }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(findErr(errors, 'gradingInfo[0].scoreOptions must not be empty')).toBe(true)
    })

    it('rejects non-increasing scoreOptions', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 5, scoreOptions: [0, 1, 0] }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(findErr(errors, 'gradingInfo[0].scoreOptions must be strictly increasing')).toBe(true)
    })

    it('rejects scoreOptions last not equal to fullScore', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 5, scoreOptions: [0, 1, 2] }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(findErr(errors, 'gradingInfo[0].scoreOptions last value 2 must equal fullScore 5')).toBe(true)
    })

    it('validates correct scoreOptions', () => {
      const errors = validateExamPackage({
        title: 'Test',
        gradingInfo: [{ id: 0, recordIndices: [0], problemInfo: '', gradingInfo: '', fullScore: 5, scoreOptions: [0, 2, 5] }],
        questions: [{ id: 'q1', content: [], time: { type: 'record', duration: 30, recordIndex: 0 } }]
      })
      expect(errors).toHaveLength(0)
    })
  })
})
