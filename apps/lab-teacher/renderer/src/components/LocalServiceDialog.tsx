import { useState, type FormEvent, type JSX } from 'react'
import { Download, FileText, FolderOpen, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import type { LocalServiceInitialization } from '@ls101/lab-desktop-host'
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
import { useLocalService } from '../session/local-service'
import type { TeacherSession } from '../session/session'
import styles from './LocalServiceDialog.module.css'

const STATES: Record<string, string> = {
  'not-installed': '未安装',
  stopped: '已停止',
  uninitialized: '等待初始化',
  running: '运行中',
  unavailable: '不可用'
}

interface ConfirmationDefinition {
  operation: string
  title: string
  message: string
  danger?: boolean
}

type ConfirmationKey = 'install' | 'uninstall' | 'stop' | 'upgrade' | 'restore' | 'recover-restore'

const CONFIRMATIONS: Record<ConfirmationKey, ConfirmationDefinition> = {
  install: {
    operation: 'install',
    title: '安装本机服务程序',
    message: '将把本机服务程序安装到系统并注册为系统服务，安装过程需要管理员授权。'
  },
  uninstall: {
    operation: 'uninstall',
    title: '卸载本机服务',
    message:
      '将移除本机的系统服务注册和开机启动设置，保留试卷、作答、备份和服务程序。卸载后学生端无法连接本机服务；可重新安装并启动以恢复使用。',
    danger: true
  },
  stop: {
    operation: 'stop',
    title: '停止本机服务',
    message:
      '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。',
    danger: true
  },
  upgrade: {
    operation: 'upgrade',
    title: '检查备份、停止并升级本机服务',
    message:
      '请先在设备列表核对离线设备的最后上报状态。离线不表示作答已保存；在线设备仍有活动时无法继续。'
  },
  restore: {
    operation: 'restore',
    title: '以备份替换本机活动数据目录',
    message: '当前数据目录将保留，活动数据将回到备份时间点。',
    danger: true
  },
  'recover-restore': {
    operation: 'recover-restore',
    title: '恢复中断的数据目录切换',
    message: '将恢复上一次中断的数据目录切换。',
    danger: true
  }
}

interface PendingConfirmation {
  key: ConfirmationKey
  input?: unknown
}

interface LocalServiceDialogProps {
  session: TeacherSession
  close(): void
}

export function LocalServiceDialog({ session, close }: LocalServiceDialogProps): JSX.Element {
  const local = useLocalService()
  const connectAction = useLabAction()
  const [logs, setLogs] = useState<string | null>(null)
  const [archive, setArchive] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [port, setPort] = useState(8443)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const [initial, setInitial] = useState<LocalServiceInitialization>({
    name: '听说101 机房',
    baseUrl: 'https://',
    password: '',
    activationCode: '',
    port: 8443
  })

  const status = local.status
  const state = status?.state ?? null
  const busy = local.busy || connectAction.busy
  const error = local.error ?? status?.error ?? connectAction.error?.message ?? null
  const confirmation = pending ? CONFIRMATIONS[pending.key] : null

  const readLogs = (): void => {
    void local.logs().then((value) => setLogs(value))
  }

  const initialize = (event: FormEvent): void => {
    event.preventDefault()
    const input = { ...initial }
    setInitial({ ...initial, password: '', activationCode: '' })
    void local.invoke('initialize', input)
  }

  return (
    <>
      <Modal
        open
        onOpenChange={(open) => {
          if (!open && !busy) close()
        }}
        overlayClassName={modalBackdropClassName}
      >
        <ModalPanel title="本机服务" close={() => (busy ? undefined : close())} width="medium">
          <div className={styles.statusRow}>
            <IconButton
              disabled={busy}
              icon={RefreshCw}
              label="检查本机状态"
              onClick={() => void local.check()}
            />
            <strong>{state ? (STATES[state] ?? state) : '尚未检查'}</strong>
            {status?.releaseVersion ? <span>{status.releaseVersion}</span> : null}
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}
          {local.notice ? <Banner tone="success">{local.notice}</Banner> : null}
          {!status && !error ? (
            <p className={styles.hint}>检查本机状态需要管理员授权，因此不会自动执行。</p>
          ) : null}

          {status?.info ? (
            <dl className={styles.details}>
              <dt>服务 ID</dt>
              <dd className={styles.path}>{status.info.serverId}</dd>
              <dt>公钥指纹</dt>
              <dd className={styles.path}>{status.fingerprint}</dd>
            </dl>
          ) : null}

          {state === 'not-installed' ? (
            <>
              <h3 className={styles.heading}>安装</h3>
              <p className={styles.hint}>
                本机服务尚未安装。安装后需要初始化名称、监听端口与管理密码。
              </p>
              <div className={styles.actions}>
                <Button
                  disabled={busy}
                  icon={Download}
                  onClick={() => setPending({ key: 'install' })}
                  variant="primary"
                >
                  安装程序
                </Button>
              </div>
            </>
          ) : null}

          {state === 'stopped' ? (
            <>
              <h3 className={styles.heading}>服务操作</h3>
              <div className={styles.actions}>
                <Button
                  disabled={busy}
                  icon={Play}
                  onClick={() => void local.invoke('start')}
                  variant="primary"
                >
                  启动
                </Button>
                <Button
                  disabled={busy}
                  icon={Trash2}
                  onClick={() => setPending({ key: 'uninstall' })}
                  variant="danger"
                >
                  卸载服务
                </Button>
              </div>

              <h3 className={styles.heading}>监听端口</h3>
              <div className={styles.inlineRow}>
                <Field htmlFor="local-service-listen-port" label="端口">
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
                  disabled={busy || !status?.port}
                  onClick={() => void local.invoke('configure', { port })}
                >
                  保存监听端口
                </Button>
              </div>

              <h3 className={styles.heading}>备份与恢复</h3>
              <p className={styles.hint}>
                备份不包含快照之后的收卷数据；恢复只在服务停止时执行，活动数据回到备份时间点。
              </p>
              <div className={styles.actions}>
                <Button
                  disabled={busy}
                  icon={FolderOpen}
                  onClick={() =>
                    void local.selectBackup().then((selected) => {
                      if (selected) setArchive(selected)
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
                  disabled={busy || !archive || !password}
                  onClick={() => {
                    setPending({ key: 'restore', input: { archive, password } })
                    setPassword('')
                  }}
                >
                  恢复备份
                </Button>
                <Button disabled={busy} onClick={() => setPending({ key: 'recover-restore' })}>
                  恢复中断操作
                </Button>
              </div>
            </>
          ) : null}

          {state === 'running' ? (
            <>
              <h3 className={styles.heading}>服务操作</h3>
              <div className={styles.actions}>
                <Button
                  disabled={busy}
                  onClick={() => void connectAction.run(() => session.connectLocal())}
                  variant="primary"
                >
                  连接本机服务
                </Button>
                <Button disabled={busy} icon={Square} onClick={() => setPending({ key: 'stop' })}>
                  停止
                </Button>
                <Button
                  disabled={busy}
                  icon={Download}
                  onClick={() => setPending({ key: 'upgrade' })}
                >
                  升级服务
                </Button>
              </div>
            </>
          ) : null}

          {state === 'uninitialized' ? (
            <form className={styles.form} onSubmit={initialize}>
              <h3 className={styles.heading}>初始化本机服务</h3>
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
              {status?.license?.state !== 'active' ? (
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
                <Button disabled={busy} type="submit" variant="primary">
                  初始化
                </Button>
              </div>
            </form>
          ) : null}

          {state === 'unavailable' ? (
            <>
              <h3 className={styles.heading}>服务操作</h3>
              <p className={styles.hint}>
                本机服务控制通道不可用。可以先尝试停止后重新启动；若持续失败，请在服务机检查服务程序。
              </p>
              <div className={styles.actions}>
                <Button disabled={busy} icon={Square} onClick={() => setPending({ key: 'stop' })}>
                  停止
                </Button>
              </div>
            </>
          ) : null}

          {status && state !== 'not-installed' ? (
            <CheckField
              checked={status.autostart}
              disabled={busy}
              id="local-service-autostart"
              label="开机启动本机服务"
              onChange={(event) => void local.invoke('autostart', event.target.checked)}
            />
          ) : null}

          <h3 className={styles.heading}>服务日志</h3>
          <div className={styles.actions}>
            <Button disabled={busy} icon={FileText} onClick={readLogs}>
              读取日志
            </Button>
          </div>
          {logs !== null ? <pre className={styles.logs}>{logs || '暂无日志'}</pre> : null}
        </ModalPanel>
      </Modal>

      <ConfirmModal
        busy={busy}
        confirmLabel="确认"
        danger={confirmation?.danger ?? false}
        message={confirmation?.message ?? ''}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const current = pending
          setPending(null)
          if (current) void local.invoke(CONFIRMATIONS[current.key].operation, current.input)
        }}
        open={pending !== null}
        title={confirmation?.title ?? ''}
      />
    </>
  )
}
