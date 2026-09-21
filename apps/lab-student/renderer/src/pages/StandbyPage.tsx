import type { JSX } from 'react'
import { Banner } from '@ls101/desktop-ui'
import { GateScreen } from '../components/GateScreen'
import { StudentStatus } from '../components/StudentStatus'
import { useWorkspace } from '../session/workspace'
import styles from './StandbyPage.module.css'

const testLabels: Record<string, string> = {
  identity: '连接与身份',
  storage: '本地存储',
  download: '试卷下载',
  playback: '播放与选择',
  audio: '麦克风与耳机',
  submission: '作答提交',
  duplicate: '重复请求',
  recovery: '异常恢复'
}

export function StandbyPage(): JSX.Element {
  const { view } = useWorkspace()
  return (
    <GateScreen>
      {view.loading ? <h1>正在启动</h1> : <StudentStatus title />}
      {view.testCase && <Banner>部署测试：{testLabels[view.testCase] ?? view.testCase}</Banner>}
      {!view.loading && view.binding && (
        <dl className={styles.details}>
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
    </GateScreen>
  )
}
