import { useState, type JSX } from 'react'
import { Button, Page, PageHeader, Banner } from '@ls101/desktop-ui'
import type { Schema } from '@ls101/lab-contracts'
import { useWorkspace } from '../session/workspace'
import { ActionNotice, RefreshButton, useConfirmation } from '../components/WorkspaceUI'
import { EnrollmentPanel, BackupPanel } from './maintenance/ServiceMaintenance'
import { TestsPanel } from './maintenance/TestsPanel'
import { CleanupPanel } from './maintenance/CleanupPanel'
import styles from './Workspace.module.css'

export function MaintenancePage(): JSX.Element {
  const { session, view } = useWorkspace()
  const service = view.service!
  const [tab, setTab] = useState('enrollment')
  const { action, ask, dialog } = useConfirmation()
  const maintenance = service.mode === 'maintenance'
  const blockers = [
    ...service.blockers,
    ...(action.error?.blockers ?? []).filter(
      (item) =>
        !service.blockers.some(
          (known) => known.kind === item.kind && known.resourceId === item.resourceId
        )
    )
  ]
  return (
    <Page>
      <PageHeader
        title="维护"
        actions={
          <>
            <RefreshButton
              refresh={() => void action.run(() => session.refreshService())}
              disabled={action.busy}
            />
            <Button
              variant="primary"
              disabled={action.busy || (maintenance && service.blockers.length > 0)}
              onClick={() =>
                ask({
                  title: maintenance ? '退出维护模式' : '进入维护模式',
                  message: maintenance
                    ? '将恢复新的练习和作答提交。离线设备及未上传记录不会被清空，也不会自动开始练习。'
                    : '进入后将暂停新的练习和正式收卷。正在进行的本地作答仍需等待保存完成；请通知现场人员。',
                  run: () => session.changeMode(maintenance ? 'normal' : 'maintenance')
                })
              }
            >
              {maintenance ? '退出维护模式' : '进入维护模式'}
            </Button>
          </>
        }
      />
      <Banner tone={maintenance ? 'warning' : 'info'}>
        {maintenance
          ? '维护模式已开启：新的练习和正式收卷已暂停。完成维护任务后，请检查状态并退出维护。'
          : '当前为正常模式。进入维护后可开启入网、部署测试、历史清理和服务备份。'}
      </Banner>
      <ActionNotice action={action} />
      <div className={styles.stats}>
        {[
          ['设备总数', service.deviceSummary.total],
          ['在线设备', service.deviceSummary.online],
          ['离线设备', service.deviceSummary.total - service.deviceSummary.online],
          ['活动练习', service.deviceSummary.practicing],
          ['版本不一致', service.deviceSummary.versionMismatch],
          ['统计未知', service.deviceSummary.unknownStatistics]
        ].map(([label, count]) => (
          <div key={label} className={styles.stat}>
            {label}
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      {blockers.length ? (
        <section className={styles.card}>
          <h2>退出维护前还需处理</h2>
          {blockers.map((blocker) => (
            <div key={`${blocker.kind}:${blocker.resourceId}`} className={styles.actions}>
              <span>{blockerLabel(blocker.kind)}</span>
              <Button
                size="small"
                onClick={() => {
                  setTab(blockerTab(blocker.kind))
                  if (blocker.kind === 'active-task-lease')
                    document
                      .getElementById('maintenance-active-tasks')
                      ?.scrollIntoView({ block: 'nearest' })
                }}
              >
                查看相关任务
              </Button>
            </div>
          ))}
        </section>
      ) : maintenance ? (
        <p className={styles.hint}>
          当前没有阻止退出维护的任务。离线、待上传和异常记录仍需现场核对。
        </p>
      ) : null}
      {service.activeTasks.length ? (
        <details id="maintenance-active-tasks" className={styles.card}>
          <summary>活动任务（{service.activeTasks.length}）</summary>
          <p className={styles.hint}>
            取消后仍在运行的任务会继续阻止退出，直到收到停止结果或执行租约到期。
          </p>
          {service.activeTasks.map((task) => (
            <div key={task.id}>
              {task.deviceId} · {task.parameters.type} · {task.status}
            </div>
          ))}
        </details>
      ) : null}
      <div className={styles.tabs}>
        {[
          ['enrollment', '设备入网'],
          ['tests', '部署测试'],
          ['cleanup', '历史清理'],
          ['backups', '服务备份']
        ].map(([id, label]) => (
          <Button
            key={id}
            aria-pressed={tab === id}
            variant={tab === id ? 'primary' : 'ghost'}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === 'enrollment' ? (
        <EnrollmentPanel />
      ) : tab === 'tests' ? (
        <TestsPanel />
      ) : tab === 'cleanup' ? (
        <CleanupPanel />
      ) : (
        <BackupPanel />
      )}
      {dialog}
    </Page>
  )
}
function blockerLabel(kind: Schema<'Blocker'>['kind']): string {
  return {
    enrollment: '入网批次仍开放，请先关闭入网。',
    'test-run': '部署测试尚未结束。',
    'history-cleanup': '历史清理尚未结束。',
    'active-task-lease': '设备任务仍在执行或等待停止。',
    'backup-pending': '备份等待执行。',
    'backup-running': '备份正在处理。',
    'backup-write-barrier': '备份正在创建数据快照。'
  }[kind]
}
function blockerTab(kind: Schema<'Blocker'>['kind']): string {
  return kind === 'enrollment'
    ? 'enrollment'
    : kind === 'history-cleanup'
      ? 'cleanup'
      : kind.startsWith('backup')
        ? 'backups'
        : 'tests'
}
