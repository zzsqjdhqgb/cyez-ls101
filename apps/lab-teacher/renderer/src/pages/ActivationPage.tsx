import { useState, type FormEvent, type JSX } from 'react'
import { Banner, Button, Field } from '@ls101/desktop-ui'
import { useLabAction } from '@ls101/lab-renderer'
import { GateScreen } from '../components/GateScreen'
import type { TeacherSession } from '../session/session'
import styles from './ActivationPage.module.css'

export function ActivationPage({ session }: { session: TeacherSession }): JSX.Element {
  const [code, setCode] = useState('')
  const action = useLabAction()

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = code.trim()
    setCode('')
    void action.run(() => session.activate(value))
  }

  return (
    <GateScreen title="激活教师端">
      <p className={styles.lead}>请输入项目方提供的激活码以继续使用。</p>
      <form onSubmit={submit}>
        <Field htmlFor="activation-code" label="激活码">
          <input
            autoComplete="off"
            autoFocus
            id="activation-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        {action.error ? <Banner tone="error">{action.error.message}</Banner> : null}
        <div className={styles.actions}>
          <Button disabled={action.busy || !code.trim()} type="submit" variant="primary">
            激活
          </Button>
        </div>
      </form>
    </GateScreen>
  )
}
