import { useRef, useState, type ChangeEvent, type FormEvent, type JSX } from 'react'
import { Paperclip } from 'lucide-react'
import { Banner, Button, Field } from '@ls101/desktop-ui'
import { admission } from '../../admission'
import { GateScreen } from '../components/GateScreen'
import { StudentStatus } from '../components/StudentStatus'
import { useWorkspace } from '../session/workspace'
import { MaintenancePage } from './MaintenancePage'
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
  const [fileError, setFileError] = useState<string | null>(null)
  const [fingerprint, setFingerprint] = useState('')
  // The native file control cannot be themed (its button keeps the platform appearance even with
  // `appearance: none`), so it stays hidden and this button opens the picker for it.
  const fileInput = useRef<HTMLInputElement>(null)
  // Reading the file is asynchronous, so a slow first selection must not overwrite a later one.
  const selection = useRef(0)
  const gate = admission(view)
  if (!view.loading && gate === 'maintenance') return <MaintenancePage />

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = event.target.files?.[0]
    const current = ++selection.current
    setFileError(null)
    if (!selected) {
      setFile('')
      setFileName('')
      return
    }
    setFileName(selected.name)
    void selected.text().then(
      (content) => {
        if (selection.current === current) setFile(content)
      },
      () => {
        if (selection.current !== current) return
        setFile('')
        setFileName('')
        setFileError('入网文件无法读取，请重新选择。')
      }
    )
  }
  const chooseFile = (): void => {
    const input = fileInput.current
    if (!input) return
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.click()
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (action.busy || !file || !fingerprint.trim()) return
    void action.run(() => controller.enroll(file, fingerprint.trim()))
  }
  return (
    <GateScreen>
      {view.loading ? <h1>正在启动</h1> : <StudentStatus title />}
      {view.testCase && <Banner>部署测试：{testLabels[view.testCase] ?? view.testCase}</Banner>}
      {!view.loading && gate === 'unbound' && (
        <form className={styles.enrollment} onSubmit={submit}>
          <h2>手动入网</h2>
          <p className={styles.intro}>
            从管理员处取得入网文件和服务器公钥指纹，在本机完成入网；入网后等待服务端登记本机设备。
          </p>
          <Field
            htmlFor="enrollment-file"
            label="入网文件"
            hint={fileName ? `已选择：${fileName}` : '管理员签发的 .lsjoin 文件。'}
          >
            <div className={styles.file}>
              <input
                accept=".lsjoin,application/x-ls101-enrollment"
                className={styles.fileInput}
                disabled={action.busy}
                id="enrollment-file"
                onChange={onFileChange}
                ref={fileInput}
                type="file"
                required
              />
              <Button
                disabled={action.busy}
                icon={Paperclip}
                onClick={chooseFile}
                size="small"
                type="button"
                variant="secondary"
              >
                {fileName ? '重新选择' : '选择文件'}
              </Button>
            </div>
          </Field>
          <Field
            htmlFor="enrollment-fingerprint"
            label="服务器公钥指纹"
            hint="形如 sha256: 加 64 位十六进制字符，须与入网文件中的指纹一致。"
          >
            <input
              autoComplete="off"
              disabled={action.busy}
              id="enrollment-fingerprint"
              onChange={(event) => setFingerprint(event.target.value)}
              placeholder="sha256:..."
              value={fingerprint}
              required
            />
          </Field>
          {fileError && <Banner tone="error">{fileError}</Banner>}
          <Button
            disabled={action.busy || !file || !fingerprint.trim()}
            type="submit"
            variant="primary"
          >
            入网
          </Button>
        </form>
      )}
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
