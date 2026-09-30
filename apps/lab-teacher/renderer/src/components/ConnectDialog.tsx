import { useState, type FormEvent, type JSX } from 'react'
import {
  Banner,
  Button,
  CheckField,
  Field,
  Modal,
  ModalPanel,
  modalBackdropClassName
} from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import type { SavedConnection, TeacherSession } from '../session/session'
import styles from './ConnectDialog.module.css'

interface ConnectDialogProps {
  session: TeacherSession
  connections: readonly SavedConnection[]
  existing: SavedConnection | null
  close(): void
}

export function ConnectDialog({
  session,
  connections,
  existing,
  close
}: ConnectDialogProps): JSX.Element {
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? 'https://')
  const [fingerprint, setFingerprint] = useState(existing?.fingerprint ?? '')
  const [trusted, setTrusted] = useState(Boolean(existing))
  const [password, setPassword] = useState('')
  const action = useLabAction()
  const prefix = existing ? `connect-${existing.id}` : 'connect-new'

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const secret = password
    setPassword('')
    const target: SavedConnection = existing ?? {
      id:
        connections.find((item) => item.baseUrl === baseUrl && item.fingerprint === fingerprint)
          ?.id ?? crypto.randomUUID(),
      name: baseUrl,
      baseUrl,
      fingerprint
    }
    void action.run(async () => {
      await session.connect(target, secret)
      close()
    })
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !action.busy) close()
      }}
      overlayClassName={modalBackdropClassName}
    >
      <ModalPanel title={existing ? `连接 ${existing.name}` : '添加服务'} close={close}>
        <form onSubmit={submit}>
          {existing ? (
            <dl className={styles.meta}>
              <dt>服务地址</dt>
              <dd>{existing.baseUrl}</dd>
              <dt>公钥指纹</dt>
              <dd className={styles.fingerprint}>{existing.fingerprint}</dd>
            </dl>
          ) : (
            <>
              <Field htmlFor={`${prefix}-url`} label="服务地址">
                <input
                  id={`${prefix}-url`}
                  required
                  type="url"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value)
                    setTrusted(false)
                  }}
                />
              </Field>
              <Field htmlFor={`${prefix}-fingerprint`} label="公钥指纹">
                <input
                  id={`${prefix}-fingerprint`}
                  required
                  value={fingerprint}
                  onChange={(event) => {
                    setFingerprint(event.target.value)
                    setTrusted(false)
                  }}
                />
              </Field>
              <CheckField
                checked={trusted}
                id={`${prefix}-trusted`}
                label="已通过管理员核对公钥指纹"
                onChange={(event) => setTrusted(event.target.checked)}
              />
            </>
          )}
          <Field
            hint={existing ? '管理密码只用于本次连接，不会被保存。' : undefined}
            htmlFor={`${prefix}-password`}
            label="管理密码"
          >
            <input
              autoComplete="current-password"
              id={`${prefix}-password`}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {action.error ? <Banner tone="error">{action.error.message}</Banner> : null}
          <div className={styles.actions}>
            <Button disabled={action.busy} onClick={close} variant="ghost">
              取消
            </Button>
            <Button
              disabled={action.busy || (!existing && !trusted)}
              type="submit"
              variant="primary"
            >
              连接
            </Button>
          </div>
        </form>
      </ModalPanel>
    </Modal>
  )
}
