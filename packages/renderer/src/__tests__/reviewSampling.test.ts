import { describe, expect, it } from 'vitest'
import {
  createReviewSamplingRules,
  samplingCountKey,
  selectReviewSamples
} from '../features/submissions/reviewSampling'

interface Target {
  id: string
  schemaId: string
  schemaName: string
}

const targets: Target[] = [
  { id: 'a-1', schemaId: 'a', schemaName: 'Schema A' },
  { id: 'a-2', schemaId: 'a', schemaName: 'Schema A' },
  { id: 'b-1', schemaId: 'b', schemaName: 'Schema B' }
]

describe('review sampling rules', () => {
  it('builds schema groups by schemaId rather than display name', () => {
    const rules = rulesFor(targets)
    const schemaRule = rules.find((rule) => rule.id === 'schema')

    expect(schemaRule?.groups.map((group) => [group.id, group.targets.length])).toEqual([
      ['a', 2],
      ['b', 1]
    ])
  })

  it('selects independently from every group using registered count values', () => {
    const schemaRule = rulesFor(targets).find((rule) => rule.id === 'schema')
    if (!schemaRule) throw new Error('Missing schema rule')

    const selected = selectReviewSamples(
      schemaRule,
      {
        [samplingCountKey('schema', 'a')]: '1',
        [samplingCountKey('schema', 'b')]: '1'
      },
      () => 0
    )

    expect(selected).toHaveLength(2)
    expect(new Set(selected.map((target) => target.schemaId))).toEqual(new Set(['a', 'b']))
  })
})

function rulesFor(values: readonly Target[]) {
  return createReviewSamplingRules(values, (target) => ({
    schemaId: target.schemaId,
    schemaName: target.schemaName
  }))
}
