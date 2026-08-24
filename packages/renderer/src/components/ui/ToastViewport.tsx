import type { CSSProperties } from 'react'
import { CircleAlert, CircleCheckBig, Info, LoaderCircle, X } from 'lucide-react'
import { Toaster, useSonner } from 'sonner'
import styles from './Toast.module.css'

const visibleToastCount = 4

export function AppToaster(): React.JSX.Element {
  const { toasts } = useSonner()
  const overflowCount = toasts.length - visibleToastCount

  return (
    <>
      <Toaster
        className={styles.viewport}
        closeButton
        containerAriaLabel="通知"
        duration={4000}
        expand
        gap={8}
        icons={{
          close: <X aria-hidden="true" />,
          error: <CircleAlert aria-hidden="true" />,
          info: <Info aria-hidden="true" />,
          loading: <LoaderCircle aria-hidden="true" className={styles.loadingIcon} />,
          success: <CircleCheckBig aria-hidden="true" />
        }}
        offset={{
          bottom: 'var(--space-4)',
          right: 'var(--space-4)'
        }}
        position="bottom-right"
        swipeDirections={['right']}
        style={{ '--width': 'min(360px, calc(100vw - 32px))' } as CSSProperties}
        toastOptions={{
          closeButtonAriaLabel: '关闭通知',
          unstyled: true,
          classNames: {
            actionButton: styles.actionButton,
            closeButton: styles.closeButton,
            content: styles.content,
            default: styles.info,
            description: styles.description,
            error: styles.error,
            icon: styles.icon,
            info: styles.info,
            loading: styles.loading,
            success: styles.success,
            title: styles.title,
            toast: styles.toast,
            warning: styles.warning
          }
        }}
        visibleToasts={visibleToastCount}
      />
      {overflowCount > 0 ? (
        <span
          aria-label={`还有 ${overflowCount} 条通知未显示，当前共 ${toasts.length} 条`}
          className={styles.overflowBadge}
          role="status"
        >
          {overflowCount}+
        </span>
      ) : null}
    </>
  )
}
