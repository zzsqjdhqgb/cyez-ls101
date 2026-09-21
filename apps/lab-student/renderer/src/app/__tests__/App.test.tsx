// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StudentRecord } from '@ls101/lab-desktop-host'
import type { StudentView } from '../../../controller'

const model = vi.hoisted(() => ({
  view: null as StudentView | null,
  listeners: new Set<() => void>(),
  activate: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  exportRecords: vi.fn(async () => {}),
  refresh: vi.fn(async () => {})
}))

vi.mock('../../../controller', () => ({
  StudentController: class {
    getSnapshot = () => model.view!
    subscribe = (listener: () => void) => {
      model.listeners.add(listener)
      return () => model.listeners.delete(listener)
    }
    start = async () => {}
    stop = async () => {}
    activate = model.activate
    prepare = model.prepare
    retry = model.retry
    exportRecords = model.exportRecords
    refresh = model.refresh
  }
}))
vi.mock('@ls101/exam-player', () => ({ ExamPlayer: () => <div>活动播放器</div> }))
vi.mock('../../../deployment-player', () => ({
  DeploymentPlayer: () => <div>部署测试播放器</div>
}))

import { App } from '../App'

function update(patch: Partial<StudentView>): void {
  act(() => {
    model.view = { ...model.view!, ...patch }
    model.listeners.forEach((listener) => listener())
  })
}

function record(id: string, patch: Partial<StudentRecord> = {}): StudentRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    submissionId: id,
    originalBinding: model.view!.binding!,
    examId: 'exam',
    candidate: { displayName: id, candidateId: id },
    submittedAt: '2026-09-21T12:00:00Z',
    archiveSha256: 'a'.repeat(64),
    archiveBytes: 100,
    archivePresent: true,
    state: 'retry-required',
    attemptId: null,
    attemptCount: 1,
    resultKnowledge: 'unknown',
    retryPolicy: 'manual',
    pauseReason: null,
    lastError: '上传失败',
    receipt: null,
    completedAt: null,
    ...patch
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  model.view = {
    loading: false,
    active: true,
    initialized: true,
    binding: {
      serverId: 'server',
      deviceId: 'device',
      contextId: 'context',
      baseUrl: 'https://localhost/',
      fingerprint: 'sha256:abc',
      generation: 1,
      maintenanceLocked: false,
      versionMismatch: false
    },
    connected: true,
    state: {
      availability: 'ready',
      mode: 'normal',
      device: { enabled: true, number: '0001', room: 'A101', seat: '01', displayName: '学生机' }
    } as StudentView['state'],
    version: '0.4.1',
    computerName: 'PC-01',
    phase: 'idle',
    records: [],
    exams: [{ examId: 'exam', title: '练习试卷', pageCount: 2 }] as StudentView['exams'],
    player: null,
    testPlayer: null,
    testCase: null,
    error: null
  }
})
afterEach(cleanup)

it('uses the shared shell and preserves selection boundaries across routes', () => {
  model.view!.records = [record('学生甲')]
  render(<App />)
  expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '可用试卷' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: '处理中' }))
  fireEvent.click(screen.getByLabelText('选择 学生甲'))
  expect(screen.getByRole('button', { name: '导出所选' })).toBeEnabled()
  fireEvent.click(screen.getByRole('link', { name: '异常' }))
  expect(screen.getByLabelText('选择 学生甲')).not.toBeChecked()
  expect(screen.getByRole('button', { name: '导出所选' })).toBeDisabled()
})

it('allows offline local export but prevents practice and retries', async () => {
  model.view!.connected = false
  model.view!.records = [record('学生甲')]
  render(<App />)
  expect(screen.queryByRole('button', { name: '开始练习' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: '异常' }))
  expect(screen.getByRole('button', { name: '重试提交' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('选择 学生甲'))
  fireEvent.click(screen.getByRole('button', { name: '导出所选' }))
  await waitFor(() => expect(model.exportRecords).toHaveBeenCalledWith(['学生甲']))
})

it.each([
  ['maintenance', '机房维护中'],
  ['locked-offline', '连接异常'],
  ['version-mismatch', '软件版本不一致'],
  ['disabled', '设备已停用'],
  ['service-unavailable', '服务暂不可用'],
  ['unbound', '等待入网'],
  ['local-unavailable', '本地存储异常']
])('closes workspace access for %s', (state, title) => {
  render(<App />)
  fireEvent.click(screen.getByRole('link', { name: '历史' }))
  if (state === 'maintenance') update({ state: { ...model.view!.state!, mode: 'maintenance' } })
  if (state === 'locked-offline')
    update({ connected: false, binding: { ...model.view!.binding!, maintenanceLocked: true } })
  if (state === 'version-mismatch')
    update({ binding: { ...model.view!.binding!, versionMismatch: true } })
  if (state === 'disabled')
    update({
      state: { ...model.view!.state!, device: { ...model.view!.state!.device, enabled: false } }
    })
  if (state === 'service-unavailable')
    update({ state: { ...model.view!.state!, availability: 'service-unavailable' } })
  if (state === 'unbound') update({ binding: null })
  if (state === 'local-unavailable') update({ initialized: false })
  expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '导出所选' })).not.toBeInTheDocument()
})

it('activates from the gate and shows action errors', async () => {
  model.view!.active = false
  model.activate.mockRejectedValueOnce(new Error('激活码无效'))
  render(<App />)
  expect(screen.getByRole('button', { name: '激活' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('激活码'), { target: { value: 'test-code' } })
  fireEvent.click(screen.getByRole('button', { name: '激活' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('激活码无效'))
  expect(model.activate).toHaveBeenCalledWith('test-code')
})

it('exports only visible archives after background updates and excludes receipt-only retry', async () => {
  model.view!.records = [record('学生甲'), record('学生乙', { retryPolicy: 'receipt-only' })]
  render(<App />)
  fireEvent.click(screen.getByRole('link', { name: '处理中' }))
  expect(screen.getAllByRole('button', { name: '重试提交' })).toHaveLength(1)
  fireEvent.click(screen.getByLabelText('选择 学生甲'))
  expect(screen.getByLabelText('选择全部可导出作答')).toBePartiallyChecked()
  fireEvent.click(screen.getByLabelText('选择全部可导出作答'))
  update({
    records: [
      record('学生甲', { state: 'completed' }),
      record('学生乙', { retryPolicy: 'receipt-only' })
    ]
  })
  fireEvent.click(screen.getByRole('button', { name: '导出所选' }))
  await waitFor(() => expect(model.exportRecords).toHaveBeenCalledWith(['学生乙']))
  update({ records: [record('学生乙', { archivePresent: false })] })
  expect(screen.getByRole('button', { name: '导出所选' })).toBeDisabled()
  expect(screen.getByLabelText('选择 学生乙')).toBeDisabled()
})

it('keeps an active player mounted across offline and maintenance transitions', () => {
  model.view!.player = { exam: model.view!.exams[0], baseUrl: 'ls101-exam://test/' }
  render(<App />)
  const player = screen.getByText('活动播放器')
  update({ connected: false })
  expect(screen.getByText('活动播放器')).toBe(player)
  expect(screen.getByText('连接异常')).toBeInTheDocument()
  update({ connected: true, state: { ...model.view!.state!, mode: 'maintenance' } })
  expect(screen.getByText('活动播放器')).toBe(player)
  expect(screen.getByText('机房维护中')).toBeInTheDocument()
  update({ player: null })
  expect(screen.getByRole('heading', { name: '机房维护中' })).toBeInTheDocument()
})
