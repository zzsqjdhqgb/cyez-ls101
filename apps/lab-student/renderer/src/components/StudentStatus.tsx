import type { JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import { Banner, IconButton } from '@ls101/desktop-ui'
import { useWorkspace } from '../session/workspace'
import styles from './StudentStatus.module.css'

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

export function StudentStatus({ title = false }: { title?: boolean }): JSX.Element {
  const { gate } = useWorkspace()
  return title ? (
    <h1>{labels[gate]}</h1>
  ) : (
    <span className={styles.status} data-ready={gate === 'ready'} role="status">
      {labels[gate]}
    </span>
  )
}

export function StudentActions(): JSX.Element {
  const { view, controller, action } = useWorkspace()
  return (
    <>
      <div className={styles.identity}>
        <strong>{view.state?.device.number ?? view.computerName}</strong>
        <span>{view.version}</span>
      </div>
      {!view.loading && <StudentStatus />}
      <IconButton
        icon={RefreshCw}
        label="刷新连接"
        disabled={view.loading || action.busy}
        onClick={() => void action.run(() => controller.refresh())}
      />
    </>
  )
}

export function StudentNotice(): JSX.Element | null {
  const { view, action } = useWorkspace()
  const error = action.error?.message ?? view.error
  return error ? <Banner tone="error">{error}</Banner> : null
}
