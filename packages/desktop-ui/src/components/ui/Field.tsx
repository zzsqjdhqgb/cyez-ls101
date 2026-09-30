import type { InputHTMLAttributes, JSX, ReactNode } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  label: string
  htmlFor: string
  hint?: ReactNode
  children: ReactNode
}

export function Field({ label, htmlFor, hint, children }: FieldProps): JSX.Element {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

interface CheckFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export function CheckField({ label, id, ...props }: CheckFieldProps): JSX.Element {
  return (
    <div className={styles.check}>
      <input id={id} type="checkbox" {...props} />
      <label htmlFor={id}>{label}</label>
    </div>
  )
}
