import type { JSX } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { TitleBar } from '@ls101/desktop-ui'
import { StudentActions, StudentNotice } from '../components/StudentStatus'
import { useWorkspace } from '../session/workspace'
import styles from './MaintenancePage.module.css'

export function MaintenancePage(): JSX.Element {
  const { view } = useWorkspace()
  const device = view.state?.device
  const confirmed = view.state?.mode === 'maintenance' && view.state.availability === 'maintenance'
  const number = device?.number || '--'
  const displayName = device?.displayName || view.computerName || '本机终端'

  return (
    <div className={styles.screen}>
      <TitleBar
        sidebarCollapsed={false}
        sidebarVisible={false}
        subtitle="学生端"
        actions={<StudentActions />}
      />
      <main className={styles.main}>
        <div className={styles.notice}>
          <StudentNotice />
        </div>
        <section className={styles.content} aria-labelledby="maintenance-title">
          <div className={styles.message}>
            <div className={styles.eyebrow}>
              <span aria-hidden="true" />
              <span>终端状态</span>
            </div>
            <h1 id="maintenance-title">机房维护中</h1>
            <p className={styles.summary}>本机已接入管理服务器，当前服务状态如下</p>
            <div className={styles.confirmation} role="status" data-confirmed={confirmed}>
              <CheckCircle2 aria-hidden="true" />
              <div>
                <strong>{confirmed ? '维护模式已确认' : '正在核对维护状态'}</strong>
                <span>{view.connected ? '管理服务器连接正常' : '等待管理服务器连接'}</span>
              </div>
            </div>
            <div className={styles.location}>
              <div>
                <span>机房</span>
                <strong>{device?.room || '未分配'}</strong>
              </div>
              <div>
                <span>座位</span>
                <strong>{device?.seat || '未分配'}</strong>
              </div>
            </div>
          </div>

          <aside className={styles.identity} aria-label="终端身份信息">
            <div className={styles.identityLabel}>
              <span>设备编号</span>
              <span>LS101</span>
            </div>
            <div className={styles.number}>{number}</div>
            <strong className={styles.displayName}>{displayName}</strong>
            <dl className={styles.facts}>
              <div>
                <dt>计算机</dt>
                <dd>{view.computerName || '--'}</dd>
              </div>
              <div>
                <dt>学生端版本</dt>
                <dd>{view.version || '--'}</dd>
              </div>
            </dl>
          </aside>
        </section>
      </main>
    </div>
  )
}
