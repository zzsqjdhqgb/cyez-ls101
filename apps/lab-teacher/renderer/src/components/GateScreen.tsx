import type { JSX, ReactNode } from 'react'
import { TitleBar } from '@ls101/desktop-ui'
import styles from './GateScreen.module.css'

interface GateScreenProps {
  title: string
  actions?: ReactNode
  children?: ReactNode
}

export function GateScreen({ title, actions, children }: GateScreenProps): JSX.Element {
  return (
    <div className={styles.screen}>
      <TitleBar
        sidebarCollapsed={false}
        sidebarVisible={false}
        subtitle="教师端"
        title="曹二听说101"
      />
      <main className={styles.content}>
        <section className={styles.panel} aria-labelledby="gate-title">
          <header className={styles.header}>
            <h1 id="gate-title">{title}</h1>
            {actions ? <div className={styles.actions}>{actions}</div> : null}
          </header>
          {children}
        </section>
      </main>
    </div>
  )
}
