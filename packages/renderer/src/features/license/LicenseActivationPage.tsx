import { useState, type FormEvent, type JSX } from 'react'
import {
  AlertCircle,
  CalendarClock,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  ShieldX
} from 'lucide-react'
import type { LicenseStatus } from '@ls101/core-types'
import { appIconUrl } from '../../assets'
import { TitleBar } from '../../components/shell/TitleBar'
import { Button } from '../../components/ui/Button'
import styles from './LicenseActivationPage.module.css'

interface LicenseActivationPageProps {
  initialStatus: LicenseStatus
  onActivated(): Promise<void>
}

export function LicenseActivationPage({
  initialStatus,
  onActivated
}: LicenseActivationPageProps): JSX.Element {
  const [status, setStatus] = useState(initialStatus)
  const [invitationCode, setInvitationCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const deadline = formatLicenseDeadline(status.expiresAt)

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const license = window.license
    if (!license) {
      setError('许可证服务不可用，请重新启动应用。')
      return
    }

    setSubmitting(true)
    setError(null)
    let applicationOpened = false
    try {
      const result = await license.activate(invitationCode)
      setStatus(result.status)

      if (result.activated && result.status.state === 'active') {
        await onActivated()
        applicationOpened = true
        return
      }

      if (result.reason === 'expired' || result.status.state === 'expired') {
        setError(null)
      } else {
        setError('邀请码不正确，请检查后重试。')
      }
    } catch {
      setError('暂时无法验证邀请码，请稍后重试。')
    } finally {
      if (!applicationOpened) setSubmitting(false)
    }
  }

  return (
    <div className={styles.screen}>
      <TitleBar sidebarCollapsed={false} sidebarVisible={false} />
      <main className={styles.content}>
        <section className={styles.panel} aria-labelledby="license-title">
          <div className={styles.product}>
            <img src={appIconUrl} alt="" />
            <span>
              <strong>曹二听说101</strong>
              <small>英语听说考试系统</small>
            </span>
          </div>

          {status.state === 'expired' ? (
            <div className={styles.expired}>
              <span className={styles.stateIcon} data-tone="danger">
                <ShieldX aria-hidden="true" />
              </span>
              <div className={styles.heading}>
                <h1 id="license-title">使用权限已到期</h1>
                <p>本阶段的临时许可已经结束，请联系项目负责人获取后续授权。</p>
              </div>
              <div className={styles.deadline}>
                <CalendarClock aria-hidden="true" />
                <span>许可截止时间</span>
                <strong>{deadline}</strong>
              </div>
            </div>
          ) : (
            <>
              <span className={styles.stateIcon} data-tone="accent">
                <ShieldCheck aria-hidden="true" />
              </span>
              <div className={styles.heading}>
                <h1 id="license-title">激活曹二听说101</h1>
                <p>请输入项目方提供的邀请码以继续使用。</p>
              </div>

              <form className={styles.form} onSubmit={(event) => void submit(event)}>
                <label htmlFor="invitation-code">邀请码</label>
                <div className={styles.inputRow}>
                  <KeyRound aria-hidden="true" />
                  <input
                    id="invitation-code"
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    autoFocus
                    disabled={submitting}
                    maxLength={256}
                    spellCheck={false}
                    value={invitationCode}
                    onChange={(event) => setInvitationCode(event.target.value)}
                  />
                </div>

                {error ? (
                  <p className={styles.error} role="alert">
                    <AlertCircle aria-hidden="true" />
                    {error}
                  </p>
                ) : null}

                <Button
                  className={styles.activateButton}
                  disabled={submitting || invitationCode.trim().length === 0}
                  icon={submitting ? LoaderCircle : KeyRound}
                  type="submit"
                  variant="primary"
                >
                  {submitting ? '正在激活' : '激活并进入'}
                </Button>
              </form>

              <div className={styles.deadline}>
                <CalendarClock aria-hidden="true" />
                <span>临时许可有效至</span>
                <strong>{deadline}</strong>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function formatLicenseDeadline(expiresAt: string): string {
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(expiresAt))}（北京时间）`
}
