import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react'
import { Banner, Button, Field } from '@ls101/desktop-ui'
import { admission } from '../../admission'
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
  const { view, controller, action } = useWorkspace()
  const [file, setFile] = useState('')
  const [fileName, setFileName] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const gate = admission(view)
  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const selected = event.target.files?.[0]
    if (!selected) {
      setFile('')
      setFileName('')
      return
    }
    setFileName(selected.name)
    setFile(await selected.text())
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void action.run(() => controller.enroll(file, fingerprint.trim()))
  }
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
      {!view.loading && gate === 'unbound' && (
        <form className={styles.enrollment} onSubmit={submit}>
          <h2>手动入网</h2>
          <Field htmlFor="enrollment-file" label="入网文件">
            <input
              accept=".lsjoin,application/x-ls101-enrollment"
              id="enrollment-file"
              onChange={(event) => void onFileChange(event)}
              type="file"
              required
            />
          </Field>
          {fileName && <small>{fileName}</small>}
          <Field htmlFor="enrollment-fingerprint" label="服务器公钥指纹">
            <input
              autoComplete="off"
              id="enrollment-fingerprint"
              onChange={(event) => setFingerprint(event.target.value)}
              placeholder="sha256:..."
              value={fingerprint}
              required
            />
          </Field>
          <Button
            disabled={action.busy || !file || !fingerprint.trim()}
            type="submit"
            variant="primary"
          >
            入网
          </Button>
        </form>
      )}
    </GateScreen>
  )
}
