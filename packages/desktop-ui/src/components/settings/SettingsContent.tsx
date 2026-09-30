import type { JSX, ReactNode } from 'react'
import styles from './SettingsContent.module.css'

interface SettingsContentProps {
  children: ReactNode
}

interface SettingsSectionProps {
  title: string
  description?: string
  children: ReactNode
}

interface SettingsRowProps {
  label: string
  description?: string
  children: ReactNode
}

export function SettingsContent({ children }: SettingsContentProps): JSX.Element {
  return <div className={styles.content}>{children}</div>
}

export function SettingsSection({
  title,
  description,
  children
}: SettingsSectionProps): JSX.Element {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export function SettingsRow({ label, description, children }: SettingsRowProps): JSX.Element {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description ? <p className={styles.rowDescription}>{description}</p> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}
