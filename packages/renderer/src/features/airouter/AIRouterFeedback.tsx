import { Check, CircleAlert, RefreshCw } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '../../components/ui/Button'
import styles from './AIRouterSettingsPage.module.css'

export interface AIRouterFeedbackValue {
  kind: 'success' | 'error'
  text: string
}

export function AIRouterOperationFeedback({
  value,
  className
}: {
  value: AIRouterFeedbackValue | undefined
  className?: string
}): JSX.Element | null {
  if (!value) return null
  const Icon = value.kind === 'error' ? CircleAlert : Check
  return (
    <div
      className={[styles.operationFeedback, className].filter(Boolean).join(' ')}
      data-error={value.kind === 'error' || undefined}
      role={value.kind === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" />
      <span>{value.text}</span>
    </div>
  )
}

export function AIRouterPageLoading({ message }: { message: string }): JSX.Element {
  return (
    <div className={styles.status} role="status" aria-live="polite">
      {message}
    </div>
  )
}

export function AIRouterPageError({
  title,
  message,
  retrying,
  onRetry
}: {
  title: string
  message: string
  retrying: boolean
  onRetry: () => void
}): JSX.Element {
  return (
    <div className={styles.pageError} role="alert">
      <div className={styles.pageErrorIcon}>
        <CircleAlert aria-hidden="true" />
      </div>
      <div className={styles.pageErrorContent}>
        <strong className={styles.pageErrorTitle}>{title}</strong>
        <span className={styles.pageErrorMessage}>{message}</span>
      </div>
      <Button
        aria-busy={retrying}
        disabled={retrying}
        icon={RefreshCw}
        onClick={onRetry}
        size="small"
      >
        {retrying ? '正在重试...' : '重试'}
      </Button>
    </div>
  )
}
