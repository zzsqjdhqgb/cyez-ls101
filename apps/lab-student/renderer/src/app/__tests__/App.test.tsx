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
  enroll: vi.fn(async () => {}),
  prepare: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  exportRecords: vi.fn(async () => {}),
  refresh: vi.fn(async () => {})
}))

vi.mock('../../../controller', () => ({
  StudentController: class {
    getSnapshot = (): StudentView => model.view!
    subscribe = (listener: () => void): (() => void) => {
      model.listeners.add(listener)
      return () => {
        model.listeners.delete(listener)
      }
    }
    start = async (): Promise<void> => {}
    stop = async (): Promise<void> => {}
    activate = model.activate
    enroll = model.enroll
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

/**
 * jsdom refuses an array assignment to `HTMLInputElement.files` and cannot construct a real
 * `FileList`, so the selection is installed on the element with `defineProperty` before the change
 * event — otherwise React hands the handler an empty list. The installed list is invisible to
 * jsdom's own constraint validation, so a click on the submit button never fires `submit` (the
 * `required` file input still looks empty to jsdom); submitting the form directly is what reaches
 * the React handler the click would reach in a browser.
 */
function selectFile(input: HTMLElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

/**
 * Fills the form like an operator would. The button only enables after the asynchronous file read
 * has landed in state, so waiting for it is what makes the submission below see the file content.
 */
async function fillEnrollment(file: File, fingerprint: string): Promise<void> {
  selectFile(screen.getByLabelText('入网文件'), file)
  fireEvent.change(screen.getByLabelText('服务器公钥指纹'), { target: { value: fingerprint } })
  await waitFor(() => expect(screen.getByRole('button', { name: '入网' })).toBeEnabled())
}

function submitEnrollment(): void {
  fireEvent.submit(screen.getByRole('button', { name: '入网' }).closest('form')!)
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

it('offers manual enrollment while waiting for a binding, and only there', () => {
  model.view!.binding = null
  render(<App />)
  expect(screen.getByRole('heading', { name: '等待入网' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '手动入网' })).toBeInTheDocument()
  expect(screen.getByLabelText('入网文件')).toBeInTheDocument()
  expect(screen.getByLabelText('服务器公钥指纹')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '入网' })).toBeDisabled()
  update({ binding: { ...record('unused').originalBinding, versionMismatch: true } })
  expect(screen.queryByRole('heading', { name: '手动入网' })).not.toBeInTheDocument()
})

it('opens the file picker from the themed button, not from the native control', async () => {
  model.view!.binding = null
  const showPicker = vi.fn()
  HTMLInputElement.prototype.showPicker = showPicker
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '选择文件' }))
  expect(showPicker).toHaveBeenCalledTimes(1)
  await fillEnrollment(new File(['header.payload.signature'], 'lab.lsjoin'), 'sha256:abc')
  expect(screen.getByRole('button', { name: '重新选择' })).toBeEnabled()
})

it('submits the selected enrollment file and stays busy until the host answers', async () => {
  model.view!.binding = null
  let complete!: () => void
  model.enroll.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      })
  )
  render(<App />)
  await fillEnrollment(
    new File(['header.payload.signature'], 'lab.lsjoin', { type: 'text/plain' }),
    ' sha256:abc '
  )
  submitEnrollment()
  await waitFor(() =>
    expect(model.enroll).toHaveBeenCalledWith('header.payload.signature', 'sha256:abc')
  )
  // A second submission while the host is still answering must not reach the controller twice.
  await waitFor(() => expect(screen.getByLabelText('入网文件')).toBeDisabled())
  fireEvent.submit(screen.getByLabelText('入网文件').closest('form')!)
  expect(model.enroll).toHaveBeenCalledTimes(1)
  await act(async () => complete())
  await waitFor(() => expect(screen.getByLabelText('入网文件')).toBeEnabled())
})

it('reports a rejected enrollment on the gate', async () => {
  model.view!.binding = null
  model.enroll.mockRejectedValueOnce(new Error('ENROLLMENT_REJECTED'))
  render(<App />)
  await fillEnrollment(new File(['header.payload.signature'], 'lab.lsjoin'), 'sha256:abc')
  submitEnrollment()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ENROLLMENT_REJECTED'))
})

it('asks for another file when the selection cannot be read', async () => {
  model.view!.binding = null
  vi.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('unreadable'))
  render(<App />)
  selectFile(
    screen.getByLabelText('入网文件'),
    new File(['header.payload.signature'], 'lab.lsjoin')
  )
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('入网文件无法读取，请重新选择。')
  )
  expect(screen.getByRole('button', { name: '入网' })).toBeDisabled()
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
