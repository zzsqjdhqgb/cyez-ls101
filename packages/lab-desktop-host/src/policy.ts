import { operationDefinitions, type OperationId, type Schema } from '@ls101/lab-contracts'
import type { BindingSummary, StudentRecord } from './shared'

export function checkStudentOperation(
  operation: OperationId,
  current: BindingSummary | null,
  contextId: string | undefined,
  state: Schema<'StudentState'> | null,
  version: string,
  record?: StudentRecord | null
): void {
  const definition = operationDefinitions[operation]
  if (definition.role === 'public' && operation === 'getInfo') return
  if (definition.role !== 'student' || !current || !contextId)
    throw new Error('Student connection required')
  const previous = current.contextId !== contextId
  if (operation === 'getStudentState') return
  if (operation === 'postStudentHeartbeat' && !previous) return
  if (
    !state ||
    state.releaseVersion !== version ||
    !state.device.enabled ||
    current.versionMismatch ||
    state.serverId !== (previous ? record?.originalBinding.serverId : current.serverId)
  )
    throw new Error('Student operation is not admitted')
  const receipt = operation === 'getStudentSubmissionsSubmissionIdReceipt'
  if (previous && !receipt) throw new Error('Previous bindings allow receipt queries only')
  if (
    operation === 'putStudentTasksIdResult' &&
    ['ready', 'maintenance'].includes(state.availability)
  )
    return
  if (receipt || operation === 'putStudentSubmissionsSubmissionId') {
    if (!record || record.receipt || record.originalBinding.contextId !== contextId)
      throw new Error('Submission identity is not eligible')
  }
  const maintenance = operation.includes('Tasks')
  if (maintenance) {
    if (state.mode !== 'maintenance' || state.availability !== 'maintenance')
      throw new Error('Maintenance operation is not admitted')
  } else if (current.maintenanceLocked || state.mode !== 'normal' || state.availability !== 'ready')
    throw new Error('Normal operation is not admitted')
}
