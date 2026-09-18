import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Download, FileText, FolderOpen, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { LocalServiceInitialization, LocalServiceStatus } from '@ls101/lab-desktop-host'
import {
  Banner,
  Button,
  CheckField,
  ConfirmModal,
  Field,
  IconButton,
  Modal,
  ModalPanel,
  modalBackdropClassName
} from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import type { TeacherSession } from '../session/session'
import styles from './LocalServiceDialog.module.css'

const STATES: Record<string, string> = {
  'not-installed': '未安装',
  stopped: '已停止',
  uninitialized: '等待初始化',
  running: '运行中',
  unavailable: '不可用'
}

interface ConfirmationRequest {
  operation: string
  title: string
  message: string
  input?: unknown
  danger?: boolean
}

interface LocalServiceDialogProps {
  session: TeacherSession
  close(): void
}

export function LocalServiceDialog({ session, close }: LocalServiceDialogProps): JSX.Element {
  const action = useLabAction()
  const { run } = action
  const [status, setStatus] = useState<LocalServiceStatus | null>(null)
  const [logs, setLogs] = useState<string | null>(null)
  const [archive, setArchive] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [port, setPort] = useState(8443)
  const [pending, setPending] = useState<ConfirmationRequest | null>(null)
  const [initial, setInitial] = useState<LocalServiceInitialization>({
    name: '听说101 机房',
    baseUrl: 'https://',
    password: '',
    activationCode: '',
    port: 8443
  })

  const readStatus = (): Promise<unknown> =>
    run(async () => {
      const next = await session.host.invoke<LocalServiceStatus>('localService.status')
      setStatus(next)
      if (next.port) setPort(next.port)
    })

  useEffect(() => {
    let active = true
    void session.host.invoke<LocalServiceStatus>('localService.status').then((next) => {
      if (!active) return
      setStatus(next)
      if (next.port) setPort(next.port)
    })

    return () => {
      active = false
    }
  }, [session])

  const invoke = (operation: string, input?: unknown): Promise<unknown> =>
    run(async () => {
      const result = await session.host.invoke<LocalServiceStatus>(
        `localService.${operation}`,
        input
      )
      setStatus(operation === 'uninstall' ? result : null)
    })

  const confirm = (request: ConfirmationRequest): void => setPending(request)

  const statusLabel = status ? (STATES[status.state] ?? status.state) : '尚未检查'
  const error = action.error?.message ?? status?.error ?? null

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !action.busy) close()
        }}
        overlayClassName={modalBackdropClassName}
      >
        <ModalPanel title="本机服务" close={() => (action.busy ? undefined : close())}>
          <div className={styles.statusRow}>
            <IconButton
              disabled={action.busy}
              icon={RefreshCw}
              label="检查本机状态"
              onClick={() => void readStatus()}
            />
            <strong>{statusLabel}</strong>
            {status?.releaseVersion ? <span>{status.releaseVersion}</span> : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          {status?.info ? (
            <dl className={styles.details}>
              <dt>服务 ID</dt>
              <dd className={styles.path}>{status.info.serverId}</dd>
              <dt>公钥指纹</dt>
              <dd className={styles.path}>{status.fingerprint}</dd>
            </dl>
          ) : null}

          <div className={styles.actions}>
            <Button
              disabled={
                action.busy || !status || !['not-installed', 'stopped'].includes(status.state)
              }
              icon={Download}
              onClick={() =>
                confirm({
                  operation: 'install',
                  title: '安装本机服务程序',
                  message: '将把本机服务程序安装到系统并注册为系统服务，安装过程需要管理员授权。'
                })
              }
            >
              安装程序
            </Button>
            <Button
              disabled={action.busy || status?.state !== 'stopped'}
              icon={Trash2}
              onClick={() =>
                confirm({
                  operation: 'uninstall',
                  title: '卸载本机服务',
                  message:
                    '将移除本机的系统服务注册和开机启动设置，保留试卷、作答、备份和服务程序。卸载后学生端无法连接本机服务；可重新安装并启动以恢复使用。',
                  danger: true
                })
              }
            >
              卸载服务
            </Button>
            <Button
              disabled={action.busy || status?.state !== 'stopped'}
              icon={Play}
              onClick={() => void invoke('start')}
            >
              启动
            </Button>
            <Button
              disabled={
                action.busy ||
                !status ||
                !['running', 'uninitialized', 'unavailable'].includes(status.state)
              }
              icon={Square}
              onClick={() =>
                confirm({
                  operation: 'stop',
                  title: '停止本机服务',
                  message:
                    '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。',
                  danger: true
                })
              }
            >
              停止
            </Button>
            <Button
              disabled={action.busy || status?.state !== 'running'}
              icon={Download}
              onClick={() =>
                confirm({
                  operation: 'upgrade',
                  title: '检查备份、停止并升级本机服务',
                  message:
                    '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。',
                  danger: true
                })
              }
            >
              升级服务
            </Button>
            <Button
              disabled={action.busy}
              icon={FileText}
              onClick={() =>
                void run(async () => {
                  setLogs(await session.host.invoke<string>('localService.logs'))
                })
              }
            >
              日志
            </Button>
          </div>

          {status && status.state !== 'not-installed' ? (
            <CheckField
              checked={status.autostart}
              disabled={action.busy}
              id="local-service-autostart"
              label="开机启动本机服务"
              onChange={(event) => {
                const enabled = event.target.checked
                void run(async () => {
                  await session.host.invoke('localService.autostart', enabled)
                  setStatus({ ...status, autostart: enabled })
                })
              }}
            />
          ) : null}

          {status?.state === 'running' ? (
            <div className={styles.actions}>
              <Button
                disabled={action.busy}
                onClick={() =>
                  void run(async () => {
                    await session.connectLocal()
                    close()
                  })
                }
                variant="primary"
              >
                连接本机服务
              </Button>
            </div>
          ) : null}

          {status?.state === 'uninitialized' ? (
            <form
              className={styles.form}
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                const input = { ...initial }
                setInitial({ ...initial, password: '', activationCode: '' })
                void invoke('initialize', input)
              }}
            >
              <h3>初始化本机服务</h3>
              <Field htmlFor="local-service-name" label="名称">
                <input
                  id="local-service-name"
                  maxLength={200}
                  required
                  value={initial.name}
                  onChange={(event) => setInitial({ ...initial, name: event.target.value })}
                />
              </Field>
              <Field htmlFor="local-service-url" label="对外地址">
                <input
                  id="local-service-url"
                  required
                  type="url"
                  value={initial.baseUrl}
                  onChange={(event) => setInitial({ ...initial, baseUrl: event.target.value })}
                />
              </Field>
              <Field htmlFor="local-service-port" label="监听端口">
                <input
                  id="local-service-port"
                  max={65535}
                  min={1}
                  required
                  type="number"
                  value={initial.port}
                  onChange={(event) => setInitial({ ...initial, port: Number(event.target.value) })}
                />
              </Field>
              <Field htmlFor="local-service-password" label="管理密码">
                <input
                  autoComplete="new-password"
                  id="local-service-password"
                  required
                  type="password"
                  value={initial.password}
                  onChange={(event) => setInitial({ ...initial, password: event.target.value })}
                />
              </Field>
              {status.license?.state !== 'active' ? (
                <Field htmlFor="local-service-activation" label="服务激活码">
                  <input
                    id="local-service-activation"
                    required
                    type="password"
                    value={initial.activationCode}
                    onChange={(event) =>
                      setInitial({ ...initial, activationCode: event.target.value })
                    }
                  />
                </Field>
              ) : null}
              <div className={styles.actions}>
                <Button disabled={action.busy} type="submit" variant="primary">
                  初始化
                </Button>
              </div>
            </form>
          ) : null}

          {status?.state === 'stopped' ? (
            <section className={styles.section}>
              <Field htmlFor="local-service-listen-port" label="监听端口">
                <input
                  id="local-service-listen-port"
                  max={65535}
                  min={1}
                  type="number"
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value))}
                />
              </Field>
              <Button
                disabled={action.busy || !status.port}
                onClick={() => void invoke('configure', { port })}
              >
                保存监听端口
              </Button>

              <h3>恢复本机备份</h3>
              <div className={styles.actions}>
                <Button
                  disabled={action.busy}
                  icon={FolderOpen}
                  onClick={() =>
                    void run(async () => {
                      setArchive(await session.host.invoke<string>('localService.selectBackup'))
                    })
                  }
                >
                  选择备份
                </Button>
              </div>
              {archive ? <p className={styles.path}>{archive}</p> : null}
              <Field htmlFor="local-service-backup-password" label="备份密码">
                <input
                  id="local-service-backup-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <div className={styles.actions}>
                <Button
                  disabled={action.busy || !archive || !password}
                  onClick={() => {
                    confirm({
                      operation: 'restore',
                      title: '以备份替换本机活动数据目录',
                      message: '当前数据目录将保留，活动数据将回到备份时间点。',
                      input: { archive, password },
                      danger: true
                    })
                    setPassword('')
                  }}
                >
                  恢复备份
                </Button>
                <Button
                  disabled={action.busy}
                  onClick={() =>
                    confirm({
                      operation: 'recover-restore',
                      title: '恢复中断的数据目录切换',
                      message: '将恢复上一次中断的数据目录切换。',
                      danger: true
                    })
                  }
                >
                  恢复中断操作
                </Button>
              </div>
            </section>
          ) : null}

          {logs !== null ? <pre className={styles.logs}>{logs || '暂无日志'}</pre> : null}
        </ModalPanel>
      </Modal>

      <ConfirmModal
        busy={action.busy}
        confirmLabel="确认"
        danger={pending?.danger ?? false}
        message={pending?.message ?? ''}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const current = pending
          setPending(null)
          if (current) void invoke(current.operation, current.input)
        }}
        open={pending !== null}
        title={pending?.title ?? ''}
      />
    </>
  )
}
