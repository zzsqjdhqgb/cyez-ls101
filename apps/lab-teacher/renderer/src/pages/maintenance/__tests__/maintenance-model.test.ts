import { describe, expect, it } from 'vitest'
import type { Schema } from '@ls101/lab-contracts'
import { retryTestSelections } from '../maintenance-model'

function device(
  id: string,
  taskStatus: Schema<'TaskState'>,
  caseIds: string[],
  automatic: Record<string, 'passed' | 'failed' | 'manual-required'> = {},
  manual: Record<string, 'pending' | 'passed' | 'failed'> = {}
): Schema<'TestDeviceResult'> {
  return {
    device: { id, number: id, room: null, seat: null, displayName: null },
    task: {
      id: `task-${id}`,
      deviceId: id,
      status: taskStatus,
      parameters: {
        type: 'deployment-test',
        suiteId: 'suite',
        suiteVersion: '1',
        caseIds,
        testSubmissionId: `submission-${id}`,
        testExamSha256: 'sha256'
      },
      expiresAt: '2026-01-01T01:00:00.000Z',
      revision: 1
    },
    releaseVersion: '1.0.0',
    lastHeartbeatAt: null,
    cases: Object.entries(automatic).map(([caseId, status]) => ({ caseId, status, error: null })),
    confirmation: {
      revision: 1,
      cases: Object.entries(manual).map(([caseId, status]) => ({ caseId, status, note: '' })),
      updatedAt: null
    },
    report: null,
    late: false
  }
}

function run(devices: Schema<'TestDeviceResult'>[]): Schema<'TestRun'> {
  return {
    id: 'run',
    suiteId: 'suite',
    suiteVersion: '1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    status: 'failed',
    retryOf: null,
    devices
  }
}

describe('retryTestSelections', () => {
  it('groups devices by their exact failed case set', () => {
    const result = retryTestSelections(
      run([
        device('a', 'failed', ['audio', 'storage'], { audio: 'failed', storage: 'passed' }),
        device('b', 'failed', ['audio', 'storage'], { audio: 'failed', storage: 'passed' }),
        device('c', 'failed', ['audio', 'storage'], { audio: 'failed', storage: 'failed' }),
        device('d', 'succeeded', ['audio'], { audio: 'failed' })
      ])
    )

    expect(result).toEqual([
      { deviceIds: ['a', 'b', 'd'], caseIds: ['audio'] },
      { deviceIds: ['c'], caseIds: ['audio', 'storage'] }
    ])
  })

  it('only retries terminal tasks and uses the whole case list when no result arrived', () => {
    const result = retryTestSelections(
      run([
        device('failed', 'failed', ['audio', 'storage']),
        device('pending', 'running', ['audio'], { audio: 'failed' }),
        device('manual', 'cancelled', ['audio'], { audio: 'manual-required' }, { audio: 'failed' })
      ])
    )

    expect(result).toEqual([
      { deviceIds: ['failed'], caseIds: ['audio', 'storage'] },
      { deviceIds: ['manual'], caseIds: ['audio'] }
    ])
  })
})
