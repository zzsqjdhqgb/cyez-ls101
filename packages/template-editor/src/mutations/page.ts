import type { TimelineStep } from '../types'
import { allocateName } from './identifiers'

export function prepareTimelineStep(step: TimelineStep, usedNames: Set<string>): TimelineStep {
  const copy = structuredClone(step)
  return copy.type === 'record'
    ? { ...copy, outputName: allocateName(copy.outputName, 'recording', usedNames) }
    : copy
}

export function removeChoiceOverrides(
  timeline: readonly TimelineStep[],
  blockId: string
): TimelineStep[] {
  return timeline.map((step) => {
    if (!step.choiceViewOverrides || !(blockId in step.choiceViewOverrides)) return step
    const choiceViewOverrides = { ...step.choiceViewOverrides }
    delete choiceViewOverrides[blockId]
    if (Object.keys(choiceViewOverrides).length > 0) return { ...step, choiceViewOverrides }
    const withoutOverrides = { ...step }
    delete withoutOverrides.choiceViewOverrides
    return withoutOverrides
  })
}

export function renameChoiceOverrides(
  timeline: readonly TimelineStep[],
  previous: string,
  next: string
): TimelineStep[] {
  return timeline.map((step) => {
    if (!step.choiceViewOverrides || !(previous in step.choiceViewOverrides)) return step
    const choiceViewOverrides = {
      ...step.choiceViewOverrides,
      [next]: step.choiceViewOverrides[previous]
    }
    delete choiceViewOverrides[previous]
    return { ...step, choiceViewOverrides }
  })
}
