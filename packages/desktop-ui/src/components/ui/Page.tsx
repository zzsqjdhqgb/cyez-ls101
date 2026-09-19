import type { JSX, ReactNode } from 'react'
import styles from './Page.module.css'

interface PageProps {
  children: ReactNode
}

interface PageHeaderProps {
  title: string
  actions?: ReactNode
}

export function Page({ children }: PageProps): JSX.Element {
  return <div className={styles.page}>{children}</div>
}

export function PageHeader({ title, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className={styles.header}>
      <h1>{title}</h1>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}
