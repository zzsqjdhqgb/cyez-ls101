import { useState, type JSX } from 'react'
import { Download, Play, Square, RefreshCw, FileText, FolderOpen } from 'lucide-react'
import type { LocalServiceStatus, LocalServiceInitialization } from '@ls101/lab-desktop-host'
import type { TeacherController } from './controller'
import { Dialog, Notice } from './ui'
import { useAction } from './hooks'

const states = {
  'not-installed': '未安装',
  stopped: '已停止',
  uninitialized: '等待初始化',
  running: '运行中',
  unavailable: '不可用'
}

export function LocalService({
  controller,
  close
}: {
  controller: TeacherController
  close(): void
}): JSX.Element {
  const [status, setStatus] = useState<LocalServiceStatus | null>(null)
  const [logs, setLogs] = useState<string | null>(null)
  const [archive, setArchive] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [port, setPort] = useState(8443)
  const [confirmation, setConfirmation] = useState<{
    operation: string
    input?: unknown
    title: string
  } | null>(null)
  const [initial, setInitial] = useState<LocalServiceInitialization>({
    name: '听说101 机房',
    baseUrl: 'https://',
    password: '',
    activationCode: '',
    port: 8443
  })
  const action = useAction()
  const readStatus = async (): Promise<void> => {
    const next = await controller.host.invoke<LocalServiceStatus>('localService.status')
    setStatus(next)
    if (next.port) setPort(next.port)
  }
  const invoke = async (operation: string, input?: unknown): Promise<void> => {
    await controller.host.invoke(`localService.${operation}`, input)
    setStatus(null)
  }
  return (
    <Dialog
      title="本机服务"
      close={() => {
        if (!action.busy) close()
      }}
    >
      <div className="actions">
        <button
          title="检查本机状态"
          aria-label="检查本机状态"
          disabled={action.busy}
          onClick={() => action.run(readStatus)}
        >
          <RefreshCw />
        </button>
        <strong>{status ? states[status.state] : '尚未检查'}</strong>
        {status?.releaseVersion && <span>{status.releaseVersion}</span>}
      </div>
      <Notice error={action.error ?? status?.error ?? null} />
      {status?.info && (
        <dl>
          <dt>服务 ID</dt>
          <dd className="path-value">{status.info.serverId}</dd>
          <dt>公钥指纹</dt>
          <dd className="path-value">{status.fingerprint}</dd>
        </dl>
      )}
      <div className="actions">
        <button
          disabled={action.busy || !status || !['not-installed', 'stopped'].includes(status.state)}
          onClick={() => setConfirmation({ operation: 'install', title: '安装本机服务程序' })}
        >
          <Download />
          安装程序
        </button>
        <button
          disabled={action.busy || status?.state !== 'stopped'}
          onClick={() => action.run(() => invoke('start'))}
        >
          <Play />
          启动
        </button>
        <button
          disabled={
            action.busy ||
            !status ||
            !['running', 'uninitialized', 'unavailable'].includes(status.state)
          }
          onClick={() => setConfirmation({ operation: 'stop', title: '停止本机服务' })}
        >
          <Square />
          停止
        </button>
        <button
          disabled={action.busy || status?.state !== 'running'}
          onClick={() =>
            setConfirmation({ operation: 'upgrade', title: '检查备份、停止并升级本机服务' })
          }
        >
          <Download />
          升级服务
        </button>
        <button
          disabled={action.busy}
          onClick={() =>
            action.run(async () => setLogs(await controller.host.invoke('localService.logs')))
          }
        >
          <FileText />
          日志
        </button>
      </div>
      {status && status.state !== 'not-installed' && (
        <label className="check">
          <input
            type="checkbox"
            checked={status.autostart}
            disabled={action.busy}
            onChange={(event) => {
              const enabled = event.target.checked
              action.run(async () => {
                await invoke('autostart', enabled)
                setStatus({ ...status, autostart: enabled })
              })
            }}
          />
          开机启动本机服务
        </label>
      )}
      {status?.state === 'running' && (
        <button
          className="primary"
          disabled={action.busy}
          onClick={() =>
            action.run(async () => {
              await controller.connectLocal()
              close()
            })
          }
        >
          连接本机服务
        </button>
      )}
      {status?.state === 'uninitialized' && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const input = { ...initial }
            setInitial({ ...initial, password: '', activationCode: '' })
            action.run(() => invoke('initialize', input))
          }}
        >
          <h3>初始化本机服务</h3>
          <label>
            名称
            <input
              required
              maxLength={200}
              value={initial.name}
              onChange={(event) => setInitial({ ...initial, name: event.target.value })}
            />
          </label>
          <label>
            对外地址
            <input
              type="url"
              required
              value={initial.baseUrl}
              onChange={(event) => setInitial({ ...initial, baseUrl: event.target.value })}
            />
          </label>
          <label>
            监听端口
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={initial.port}
              onChange={(event) => setInitial({ ...initial, port: Number(event.target.value) })}
            />
          </label>
          <label>
            管理密码
            <input
              type="password"
              required
              autoComplete="new-password"
              value={initial.password}
              onChange={(event) => setInitial({ ...initial, password: event.target.value })}
            />
          </label>
          {status.license?.state !== 'active' && (
            <label>
              服务激活码
              <input
                required
                type="password"
                value={initial.activationCode}
                onChange={(event) => setInitial({ ...initial, activationCode: event.target.value })}
              />
            </label>
          )}
          <button className="primary" disabled={action.busy}>
            初始化
          </button>
        </form>
      )}
      {status?.state === 'stopped' && (
        <section className="settings-band">
          <label>
            监听端口
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </label>
          <button
            disabled={action.busy || !status.port}
            onClick={() => action.run(() => invoke('configure', { port }))}
          >
            保存监听端口
          </button>
          <h3>恢复本机备份</h3>
          <button
            disabled={action.busy}
            onClick={() =>
              action.run(async () =>
                setArchive(await controller.host.invoke('localService.selectBackup'))
              )
            }
          >
            <FolderOpen />
            选择备份
          </button>
          <p className="path-value">{archive}</p>
          <label>
            备份密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              disabled={action.busy || !archive || !password}
              onClick={() => {
                setConfirmation({
                  operation: 'restore',
                  input: { archive, password },
                  title: '以备份替换本机活动数据目录'
                })
                setPassword('')
              }}
            >
              恢复备份
            </button>
            <button
              disabled={action.busy}
              onClick={() =>
                setConfirmation({ operation: 'recover-restore', title: '恢复中断的数据目录切换' })
              }
            >
              恢复中断操作
            </button>
          </div>
        </section>
      )}
      {logs !== null && <pre className="local-logs">{logs || '暂无日志'}</pre>}
      {confirmation && (
        <section className="settings-band" role="alertdialog" aria-label={confirmation.title}>
          <h3>{confirmation.title}</h3>
          {confirmation.operation === 'restore' && (
            <p>当前数据目录将保留，活动数据将回到备份时间点。</p>
          )}
          <div className="actions">
            <button
              className="danger"
              disabled={action.busy}
              onClick={() => {
                const selected = confirmation
                setConfirmation(null)
                action.run(() => invoke(selected.operation, selected.input))
              }}
            >
              确认
            </button>
            <button disabled={action.busy} onClick={() => setConfirmation(null)}>
              取消
            </button>
          </div>
        </section>
      )}
    </Dialog>
  )
}
