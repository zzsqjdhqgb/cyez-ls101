import type { Schema, OperationId } from '@ls101/lab-contracts'
import type { OperationInput, TransportResponse } from '@ls101/lab-client'

export interface BindingSummary {
  serverId: string
  baseUrl: string
  fingerprint: string
  deviceId: string
  contextId: string
  generation: number
  maintenanceLocked: boolean
  versionMismatch: boolean
}
export type SubmissionState =
  | 'queued'
  | 'sending'
  | 'checking'
  | 'retry-required'
  | 'completed'
  | 'manual-resolution'
export interface StudentRecord {
  schemaVersion: 1
  revision: number
  submissionId: string
  originalBinding: BindingSummary
  examId: string
  candidate: Schema<'Candidate'>
  submittedAt: string
  archiveSha256: string
  archiveBytes: number
  state: SubmissionState
  attemptId: string | null
  attemptCount: number
  resultKnowledge: 'never-sent' | 'unknown' | 'not-received' | 'received'
  retryPolicy: 'automatic-first' | 'automatic-maintenance' | 'manual' | 'receipt-only' | 'none'
  pauseReason: string | null
  lastError: string | null
  receipt: Schema<'CompletedReceipt'> | null
  completedAt: string | null
  archivePresent: boolean
}

export interface PracticeIntent {
  submissionId: string
  binding: BindingSummary
  examId: string
  candidate: Schema<'Candidate'>
}

export interface LabHost {
  invoke<T = unknown>(capability: string, input?: unknown): Promise<T>
  onEvent(listener: (event: { type: string; value: unknown }) => void): () => void
}

export interface HostRequest {
  connectionId: string
  operationId: OperationId
  input: OperationInput
  requestId: string
}
export interface HostResult {
  requestId: string
  response: TransportResponse
}

export interface TaskJournal {
  schemaVersion: 1
  contextId: string
  task: Schema<'Task'>
  runtimeId: string
  lease: Schema<'TaskLease'> | null
  result: Schema<'TaskResultInput'> | null
  reported: boolean
  selectedCount?: number
  testCases?: Schema<'CaseResult'>[]
}
