export interface ReviewSamplingGroup<T> {
  id: string
  name: string
  targets: readonly T[]
}

export interface ReviewSamplingRule<T> {
  id: string
  label: string
  defaultCount: number
  groups: readonly ReviewSamplingGroup<T>[]
}

export function createReviewSamplingRules<T>(
  targets: readonly T[],
  schemaOf: (target: T) => { schemaId: string; schemaName: string }
): ReviewSamplingRule<T>[] {
  const schemaGroups = new Map<string, ReviewSamplingGroup<T>>()
  for (const target of targets) {
    const schema = schemaOf(target)
    const group = schemaGroups.get(schema.schemaId)
    if (group) {
      schemaGroups.set(schema.schemaId, { ...group, targets: [...group.targets, target] })
    } else {
      schemaGroups.set(schema.schemaId, {
        id: schema.schemaId,
        name: schema.schemaName,
        targets: [target]
      })
    }
  }

  return [
    {
      id: 'total',
      label: '整场题目数',
      defaultCount: 1,
      groups: [{ id: 'all', name: '全部评分单元', targets }]
    },
    {
      id: 'schema',
      label: '按 Schema 分组',
      defaultCount: 0,
      groups: [...schemaGroups.values()]
    }
  ]
}

export function selectReviewSamples<T>(
  rule: ReviewSamplingRule<T>,
  values: Readonly<Record<string, string>>,
  randomIndex: (upperBound: number) => number = secureRandomIndex
): T[] {
  return rule.groups.flatMap((group) => {
    const value = values[samplingCountKey(rule.id, group.id)] ?? String(rule.defaultCount)
    return sample(group.targets, validCount(value, group.targets.length), randomIndex)
  })
}

export function samplingCountKey(ruleId: string, groupId: string): string {
  return `${ruleId}\u0000${groupId}`
}

function validCount(value: string, max: number): number {
  const count = Number(value)
  return Number.isInteger(count) ? Math.min(Math.max(count, 0), max) : 0
}

function sample<T>(
  targets: readonly T[],
  count: number,
  randomIndex: (upperBound: number) => number
): T[] {
  const shuffled = [...targets]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = randomIndex(index + 1)
    ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
  }
  return shuffled.slice(0, count)
}

function secureRandomIndex(upperBound: number): number {
  const random = new Uint32Array(1)
  crypto.getRandomValues(random)
  return random[0] % upperBound
}
