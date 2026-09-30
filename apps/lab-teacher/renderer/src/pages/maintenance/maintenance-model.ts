import type { Schema } from '@ls101/lab-contracts'

/** Preserve exact per-device case selections; never rerun successful cases on other devices. */
export function retryTestSelections(
  run: Schema<'TestRun'>
): Array<{ deviceIds: string[]; caseIds: string[] }> {
  const groups = new Map<string, { deviceIds: string[]; caseIds: string[] }>()
  for (const device of run.devices) {
    if (!['succeeded', 'failed', 'cancelled', 'expired'].includes(device.task.status)) continue
    if (device.task.parameters.type !== 'deployment-test') continue
    const caseIds = device.task.parameters.caseIds
      .filter((id) => {
        const automatic = device.cases.find((item) => item.caseId === id)
        const manual = device.confirmation.cases.find((item) => item.caseId === id)
        return (
          automatic?.status === 'failed' ||
          manual?.status === 'failed' ||
          (!automatic && ['failed', 'cancelled', 'expired'].includes(device.task.status))
        )
      })
      .sort()
    if (!caseIds.length) continue
    const key = JSON.stringify(caseIds)
    const group = groups.get(key) ?? { deviceIds: [], caseIds }
    group.deviceIds.push(device.device.id)
    groups.set(key, group)
  }
  return [...groups.values()]
}
