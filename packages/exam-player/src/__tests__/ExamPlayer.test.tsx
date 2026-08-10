// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExamPlayer } from '../ExamPlayer'
import { fixtureExam } from './loading.test'

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resource')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ExamPlayer', () => {
  it('资源预检完成后收集考生信息并返回完整归档 Blob', async () => {
    const exam = fixtureExam({
      examData: {
        title: '无录音考试',
        resources: {},
        player: {
          pages: [
            {
              id: 'page',
              content: [{ id: 'text', type: 'text', x: 0, y: 0, text: '考试内容' }],
              timeline: [{ type: 'countdown', seconds: 0 }]
            }
          ],
          recordingIndices: []
        }
      },
      submissionTemplate: {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: 'exam-1', examTitle: '无录音考试' },
        schemaUses: [],
        resources: {}
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(exam))
    )
    const onFinish = vi.fn()

    render(
      <ExamPlayer examBaseUrl="https://exam.test/paper/" onExit={vi.fn()} onFinish={onFinish} />
    )

    expect(await screen.findByRole('heading', { name: '无录音考试' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '张三' } })
    fireEvent.change(screen.getByLabelText('考生号'), { target: { value: '1001' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    await waitFor(() => expect(onFinish).toHaveBeenCalledOnce())
    expect(onFinish.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(onFinish.mock.calls[0][0].type).toBe('application/x-ls101-submission')
    expect(await screen.findByRole('heading', { name: '考试完成' })).toBeInTheDocument()
  })

  it('allowExit 控制正式考试状态栏退出入口', async () => {
    const exam = fixtureExam({
      examData: {
        title: '退出测试',
        resources: {},
        player: {
          pages: [
            {
              id: 'page',
              content: [{ id: 'text', type: 'text', x: 0, y: 0, text: '考试内容' }],
              timeline: [{ type: 'countdown', seconds: 60 }]
            }
          ],
          recordingIndices: []
        }
      },
      submissionTemplate: {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: 'exam-1', examTitle: '退出测试' },
        schemaUses: [],
        resources: {}
      }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(exam))
    )
    const onExit = vi.fn()
    render(<ExamPlayer examBaseUrl="https://exam.test/paper/" onExit={onExit} onFinish={vi.fn()} />)
    await screen.findByRole('heading', { name: '退出测试' })
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '李四' } })
    fireEvent.change(screen.getByLabelText('考生号'), { target: { value: '1002' } })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))

    const exit = await screen.findByRole('button', { name: '退出' })
    fireEvent.click(exit)
    expect(screen.getByRole('dialog', { name: '退出考试？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }))
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('清单验证失败时显示错误页且不显示考生表单', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ format: 'invalid' }))
    )
    render(
      <ExamPlayer examBaseUrl="https://exam.test/paper/" onExit={vi.fn()} onFinish={vi.fn()} />
    )

    expect(await screen.findByRole('heading', { name: '考试加载失败' })).toBeInTheDocument()
    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument()
  })

  it('预加载完成前卸载时释放随后创建的资源 URL', async () => {
    let releaseResources = (): void => undefined
    const resourceGate = new Promise<void>((resolve) => {
      releaseResources = resolve
    })
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('manifest.json')) return Response.json(fixtureExam())
      await resourceGate
      return new Response(new Uint8Array([1]))
    })
    vi.stubGlobal('fetch', fetcher)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const { unmount } = render(
      <ExamPlayer examBaseUrl="https://exam.test/paper/" onExit={vi.fn()} onFinish={vi.fn()} />
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    unmount()
    releaseResources()

    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2))
  })
})
