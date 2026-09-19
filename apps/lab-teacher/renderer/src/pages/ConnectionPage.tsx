import { useState, type JSX } from 'react'
import { Monitor, Plus, Server, Settings } from 'lucide-react'
import { Banner, Button, EmptyState, IconButton } from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import { ConnectDialog } from '../components/ConnectDialog'
import { GateScreen } from '../components/GateScreen'
import { LocalServiceDialog } from '../components/LocalServiceDialog'
import { useLocalService } from '../session/local-service'
import type { SavedConnection, TeacherSession, TeacherView } from '../session/session'
import styles from './ConnectionPage.module.css'

const LOCAL_STATE_LABELS: Record<string, string> = {
  'not-installed': '未安装',
  stopped: '已停止',
  uninitialized: '等待初始化',
  running: '运行中',
  unavailable: '不可用'
}

function shortFingerprint(fingerprint: string): string {
  const value = fingerprint.replace(/^sha256:/, '')
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value
}

interface ConnectionPageProps {
  session: TeacherSession
  view: TeacherView
}

export function ConnectionPage({ session, view }: ConnectionPageProps): JSX.Element {
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'connect'; target: SavedConnection } | null
  >(null)
  const [localOpen, setLocalOpen] = useState(false)
  const local = useLocalService()
  const connectAction = useLabAction()

  const localLabel = local.status
    ? (LOCAL_STATE_LABELS[local.status.state] ?? local.status.state)
    : '尚未检查'

  return (
    <GateScreen
      actions={
        <Button icon={Plus} onClick={() => setDialog({ mode: 'add' })}>
          添加服务
        </Button>
      }
      full
      title="连接服务"
    >
      <section aria-labelledby="saved-services" className={styles.section}>
        <h2 id="saved-services">已配置的服务</h2>
        {view.connections.length === 0 ? (
          <EmptyState icon={Server} title="尚未配置任何服务，请添加服务地址" />
        ) : (
          <ul className={styles.list}>
            {view.connections.map((connection) => (
              <li className={styles.row} key={connection.id}>
                <span className={styles.icon}>
                  <Server aria-hidden="true" />
                </span>
                <div className={styles.body}>
                  <strong className={styles.name}>{connection.name}</strong>
                  <span className={styles.endpoint}>{connection.baseUrl}</span>
                  <small className={styles.meta}>
                    公钥指纹 {shortFingerprint(connection.fingerprint)} · 已核对
                  </small>
                </div>
                <div className={styles.rowActions}>
                  <Button
                    disabled={connectAction.busy}
                    onClick={() => setDialog({ mode: 'connect', target: connection })}
                    variant="primary"
                  >
                    连接
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="local-service" className={styles.section}>
        <h2 id="local-service">本机服务</h2>
        <ul className={styles.list}>
          <li className={styles.row}>
            <span className={styles.icon}>
              <Monitor aria-hidden="true" />
            </span>
            <div className={styles.body}>
              <strong className={styles.name}>本机服务</strong>
              <span className={styles.endpoint}>{localLabel}</span>
              <small className={styles.meta}>
                {local.status?.releaseVersion
                  ? `服务版本 ${local.status.releaseVersion}`
                  : '管理安装、启动、备份与日志'}
              </small>
            </div>
            <div className={styles.rowActions}>
              {local.status?.state === 'running' ? (
                <Button
                  disabled={connectAction.busy}
                  onClick={() => void connectAction.run(() => session.connectLocal())}
                  variant="primary"
                >
                  连接本机服务
                </Button>
              ) : null}
              <IconButton icon={Settings} label="本机服务管理" onClick={() => setLocalOpen(true)} />
            </div>
          </li>
        </ul>
      </section>

      {view.error ? <Banner tone="error">{view.error}</Banner> : null}
      {local.error ? <Banner tone="error">{local.error}</Banner> : null}
      {connectAction.error ? <Banner tone="error">{connectAction.error.message}</Banner> : null}

      {dialog ? (
        <ConnectDialog
          close={() => setDialog(null)}
          connections={view.connections}
          existing={dialog.mode === 'connect' ? dialog.target : null}
          session={session}
        />
      ) : null}
      {localOpen ? <LocalServiceDialog close={() => setLocalOpen(false)} /> : null}
    </GateScreen>
  )
}
