import { useEffect, useState, useSyncExternalStore, type FormEvent, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import { Download, FileText, History, ListChecks, Play, RefreshCw, X } from 'lucide-react'
import { ExamPlayer } from '@ls101/exam-player'
import type { LabHost } from '@ls101/lab-desktop-host'
import { admission, canViewRecords } from './admission'
import { StudentController } from './controller'
import './style.css'

declare global {
  interface Window {
    lab: LabHost
  }
}
const controller = new StudentController(window.lab)
const labels: Record<string, string> = {
  'activation-required': '激活学生端',
  'local-unavailable': '本地存储异常',
  unbound: '等待入网',
  offline: '连接异常',
  'version-mismatch': '软件版本不一致',
  'service-unavailable': '服务暂不可用',
  disabled: '设备已停用',
  maintenance: '机房维护中',
  ready: '正常模式'
}
const recordLabels: Record<string, string> = {
  queued: '等待上传',
  sending: '正在上传',
  checking: '待核对',
  'retry-required': '需要重试',
  completed: '提交完成',
  'manual-resolution': '需要人工处理'
}

export function App(): JSX.Element {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [tab, setTab] = useState<'exams' | 'pending' | 'errors' | 'history'>('exams')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const gate = admission(view)
  const run = (operation: () => Promise<unknown>): void => {
    setError(null)
    setBusy(true)
    void operation()
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason))
      )
      .finally(() => setBusy(false))
  }
  useEffect(() => {
    void controller.start()
    return () => {
      void controller.stop()
    }
  }, [])
  const recordsAllowed = canViewRecords(view)
  const records = view.records.filter((record) =>
    tab === 'history'
      ? record.state === 'completed'
      : tab === 'errors'
        ? record.state !== 'completed' &&
          (record.lastError ||
            record.state === 'retry-required' ||
            record.state === 'manual-resolution')
        : record.state !== 'completed'
  )
  const activate = (event: FormEvent): void => {
    event.preventDefault()
    run(() => controller.activate(code))
  }
  if (view.player)
    return (
      <>
        <ExamPlayer
          examBaseUrl={view.player.baseUrl}
          beforeStart={controller.beforeStart}
          onFinish={controller.finish}
          onPhaseChange={controller.phaseChanged}
          onExit={() => run(() => controller.exitPractice())}
        />
        {gate !== 'ready' && (
          <div className="practice-notice" role="status">
            {labels[gate]}
          </div>
        )}
      </>
    )
  return (
    <div className="app">
      <header className="app-header">
        <strong>
          听说101 <span>学生端</span>
        </strong>
        <div>
          <span className={`status ${gate === 'ready' ? 'healthy' : ''}`}>{labels[gate]}</span>
          <button
            title="刷新连接"
            aria-label="刷新连接"
            disabled={busy}
            onClick={() => run(() => controller.refresh())}
          >
            <RefreshCw />
          </button>
          <button
            title="关闭"
            aria-label="关闭"
            onClick={() => {
              void window.lab.invoke('window.close')
            }}
          >
            <X />
          </button>
        </div>
      </header>
      {(error || view.error) && (
        <div role="alert" className="error-banner">
          {error || view.error}
        </div>
      )}
      {view.loading ? (
        <main className="standby">
          <h1>正在启动</h1>
        </main>
      ) : gate === 'activation-required' ? (
        <main className="standby">
          <form className="activation" onSubmit={activate}>
            <h1>激活学生端</h1>
            <label>
              激活码
              <input
                autoFocus
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !code.trim()} type="submit">
              激活
            </button>
          </form>
        </main>
      ) : gate === 'maintenance' || (!recordsAllowed && gate !== 'ready') ? (
        <main className="standby">
          <h1>{labels[gate]}</h1>
          {view.binding && (
            <dl className="device-details">
              <dt>设备编号</dt>
              <dd>{view.state?.device.number ?? view.binding.deviceId}</dd>
              <dt>机房</dt>
              <dd>{view.state?.device.room ?? '-'}</dd>
              <dt>座位</dt>
              <dd>{view.state?.device.seat ?? '-'}</dd>
              <dt>设备名称</dt>
              <dd>{view.state?.device.displayName ?? view.computerName}</dd>
              <dt>计算机</dt>
              <dd>{view.computerName}</dd>
              <dt>版本</dt>
              <dd>{view.version}</dd>
            </dl>
          )}
        </main>
      ) : (
        <>
          <nav className="tabs" aria-label="学生工作区">
            {(
              [
                ['exams', '试卷', FileText],
                ['pending', '处理中', ListChecks],
                ['errors', '异常', RefreshCw],
                ['history', '历史', History]
              ] as const
            ).map(([id, title, Icon]) => (
              <button
                key={id}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id)
                  setSelection(new Set())
                }}
              >
                <Icon />
                {title}
              </button>
            ))}
          </nav>
          <main className="workspace">
            <div className="section-header">
              <h1>
                {tab === 'exams'
                  ? '可用试卷'
                  : tab === 'history'
                    ? '历史作答'
                    : tab === 'errors'
                      ? '异常作答'
                      : '处理中'}
              </h1>
              {tab !== 'exams' && (
                <button
                  disabled={busy || selection.size === 0}
                  onClick={() => run(() => controller.exportRecords([...selection]))}
                >
                  <Download />
                  导出所选
                </button>
              )}
            </div>
            {tab === 'exams' ? (
              <div className="exam-list">
                {gate !== 'ready' ? (
                  <p className="empty">服务连接恢复后可开始练习</p>
                ) : view.exams.length === 0 ? (
                  <p className="empty">暂无已发布试卷</p>
                ) : (
                  view.exams.map((exam) => (
                    <article className="exam-row" key={exam.examId}>
                      <FileText />
                      <div>
                        <h2>{exam.title}</h2>
                        <p>{exam.pageCount} 页</p>
                      </div>
                      <button
                        className="primary"
                        disabled={busy || view.phase !== 'idle'}
                        onClick={() => run(() => controller.prepare(exam))}
                      >
                        <Play />
                        开始练习
                      </button>
                    </article>
                  ))
                )}
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="选择全部可导出作答"
                          checked={
                            records.some((record) => record.archivePresent) &&
                            records
                              .filter((record) => record.archivePresent)
                              .every((record) => selection.has(record.submissionId))
                          }
                          onChange={(event) =>
                            setSelection(
                              event.target.checked
                                ? new Set(
                                    records
                                      .filter((record) => record.archivePresent)
                                      .map((record) => record.submissionId)
                                  )
                                : new Set()
                            )
                          }
                        />
                      </th>
                      <th>姓名</th>
                      <th>考生号</th>
                      <th>完成时间</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((record) => (
                      <tr key={record.submissionId}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${record.candidate.displayName}`}
                            disabled={!record.archivePresent}
                            checked={selection.has(record.submissionId)}
                            onChange={(event) =>
                              setSelection((current) => {
                                const next = new Set(current)
                                if (event.target.checked) next.add(record.submissionId)
                                else next.delete(record.submissionId)
                                return next
                              })
                            }
                          />
                        </td>
                        <td>{record.candidate.displayName}</td>
                        <td>{record.candidate.candidateId}</td>
                        <td>{new Date(record.submittedAt).toLocaleString()}</td>
                        <td>
                          {recordLabels[record.state]}
                          {record.lastError && <small>{record.lastError}</small>}
                          {record.retryPolicy === 'receipt-only' && <small>原服务回执待核对</small>}
                        </td>
                        <td>
                          {record.state !== 'completed' &&
                            record.retryPolicy !== 'receipt-only' && (
                              <button
                                title="重试提交"
                                aria-label="重试提交"
                                disabled={busy || gate !== 'ready'}
                                onClick={() => run(() => controller.retry(record.submissionId))}
                              >
                                <RefreshCw />
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                    {records.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty">
                          暂无记录
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        </>
      )}
      <footer className="app-footer">
        <span>{view.state?.device.number ?? view.computerName}</span>
        <span>{view.version}</span>
      </footer>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
