import { useEffect, useState, useSyncExternalStore, type JSX } from 'react'
import { createRoot } from 'react-dom/client'
import {
  FileText,
  Inbox,
  Monitor,
  Settings as SettingsIcon,
  Wrench,
  LogOut,
  RefreshCw
} from 'lucide-react'
import type { LabHost } from '@ls101/lab-desktop-host'
import { TeacherController } from './controller'
import { Devices, Exams, Submissions } from './lists'
import { Maintenance } from './maintenance'
import { Settings } from './settings'
import { Dialog, Notice } from './ui'
import { useAction } from './hooks'
import './style.css'

declare global {
  interface Window {
    lab: LabHost
  }
}
const controller = new TeacherController(window.lab)

export function App(): JSX.Element {
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [tab, setTab] = useState('exams'),
    [code, setCode] = useState(''),
    [baseUrl, setUrl] = useState('https://'),
    [fingerprint, setFingerprint] = useState(''),
    [password, setPassword] = useState(''),
    [trusted, setTrusted] = useState(false)
  const [leavingMaintenance, setLeaving] = useState(false)
  const action = useAction()
  useEffect(() => {
    void controller.start()
  }, [])
  useEffect(() => {
    if (!view.connection) return
    let running = false
    const interval = setInterval(() => {
      if (running) return
      running = true
      void controller
        .refreshService()
        .catch(() => undefined)
        .finally(() => {
          running = false
        })
    }, 5000)
    return () => clearInterval(interval)
  }, [view.connection])
  if (view.loading)
    return (
      <main className="standby">
        <h1>正在启动</h1>
      </main>
    )
  if (!view.active)
    return (
      <main className="standby">
        <form
          className="activation"
          onSubmit={(event) => {
            event.preventDefault()
            action.run(() => controller.activate(code))
          }}
        >
          <h1>听说101 教师端</h1>
          <label>
            激活码
            <input required value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <Notice error={action.error} />
          <button className="primary" disabled={action.busy}>
            激活
          </button>
        </form>
      </main>
    )
  if (!view.connection)
    return (
      <div className="app">
        <header className="app-header">
          <strong>
            听说101 <span>教师端</span>
          </strong>
        </header>
        <main className="connection-page">
          <h1>连接服务</h1>
          {view.connections.length > 0 && (
            <label>
              已保存的服务
              <select
                defaultValue=""
                onChange={(event) => {
                  const target = view.connections.find((item) => item.id === event.target.value)
                  if (target) {
                    setUrl(target.baseUrl)
                    setFingerprint(target.fingerprint)
                    setTrusted(true)
                  }
                }}
              >
                <option value="">选择服务</option>
                {view.connections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} / {item.baseUrl}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const secret = password
              setPassword('')
              setTab('exams')
              action.run(() =>
                controller.connect(
                  {
                    id:
                      view.connections.find(
                        (item) => item.baseUrl === baseUrl && item.fingerprint === fingerprint
                      )?.id ?? crypto.randomUUID(),
                    name: baseUrl,
                    baseUrl,
                    fingerprint
                  },
                  secret
                )
              )
            }}
          >
            <label>
              服务地址
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(event) => {
                  setUrl(event.target.value)
                  setTrusted(false)
                }}
              />
            </label>
            <label>
              公钥指纹
              <input
                required
                value={fingerprint}
                onChange={(event) => {
                  setFingerprint(event.target.value)
                  setTrusted(false)
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={trusted}
                onChange={(event) => setTrusted(event.target.checked)}
              />
              已通过管理员核对公钥指纹
            </label>
            <label>
              管理密码
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Notice error={action.error} />
            <button className="primary" disabled={!trusted || action.busy} type="submit">
              连接
            </button>
          </form>
        </main>
      </div>
    )
  return (
    <div className="app">
      <header className="app-header">
        <strong>
          听说101 <span>教师端</span>
        </strong>
        <div className="service-identity">
          <b>{view.service?.name ?? view.connection.info.name}</b>
          <span>
            {view.target?.baseUrl} / {view.connection.info.releaseVersion}
          </span>
        </div>
        <div className="actions">
          <span className="status">
            {view.service?.mode === 'maintenance' ? '维护模式' : '正常模式'}
          </span>
          <button
            title="刷新服务"
            aria-label="刷新服务"
            onClick={() => action.run(() => controller.refreshService())}
          >
            <RefreshCw />
          </button>
          <button
            onClick={() =>
              view.service?.mode === 'maintenance'
                ? setLeaving(true)
                : action.run(() => controller.changeMode('maintenance'))
            }
          >
            {view.service?.mode === 'maintenance' ? '退出维护' : '进入维护'}
          </button>
          <button
            title="切换服务"
            aria-label="切换服务"
            onClick={() => action.run(() => controller.disconnect())}
          >
            <LogOut />
          </button>
        </div>
      </header>
      <Notice error={action.error} />
      <nav className="tabs">
        {[
          ['exams', '试卷', FileText],
          ['submissions', '作答', Inbox],
          ['devices', '设备', Monitor],
          ['maintenance', '维护', Wrench],
          ['settings', '服务设置', SettingsIcon]
        ].map(([id, label, Icon]) => {
          const Symbol = Icon as typeof FileText
          return (
            <button
              key={id as string}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id as string)}
            >
              <Symbol />
              {label as string}
            </button>
          )
        })}
      </nav>
      <main className="workspace" key={view.connection.epoch}>
        {tab === 'exams' ? (
          <Exams controller={controller} />
        ) : tab === 'submissions' ? (
          <Submissions controller={controller} />
        ) : tab === 'devices' ? (
          <Devices controller={controller} />
        ) : tab === 'maintenance' ? (
          <Maintenance controller={controller} />
        ) : (
          <Settings controller={controller} />
        )}
      </main>
      {leavingMaintenance && (
        <Dialog title="退出维护检查" close={() => setLeaving(false)}>
          <p>
            活动练习 {view.service?.deviceSummary.practicing ?? '-'} / 在线设备{' '}
            {view.service?.deviceSummary.online ?? '-'} / 已注册{' '}
            {view.service?.deviceSummary.total ?? '-'}
          </p>
          {view.service?.blockers.length ? (
            <ul>
              {view.service.blockers.map((item) => (
                <li key={`${item.kind}:${item.resourceId}`}>
                  {item.kind}: {item.resourceId}
                </li>
              ))}
            </ul>
          ) : (
            <p>当前无硬阻塞项</p>
          )}
          <Notice error={action.error} />
          <button
            className="primary"
            disabled={action.busy}
            onClick={() =>
              action.run(async () => {
                await controller.changeMode('normal')
                setLeaving(false)
              })
            }
          >
            确认退出维护
          </button>
        </Dialog>
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
