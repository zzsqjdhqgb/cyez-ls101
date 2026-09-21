import { useState, type FormEvent, type JSX } from 'react'
import { Button, Field } from '@ls101/desktop-ui'
import { GateScreen } from '../components/GateScreen'
import { useWorkspace } from '../session/workspace'
import styles from './StandbyPage.module.css'

export function ActivationPage(): JSX.Element {
  const { controller, action } = useWorkspace()
  const [code, setCode] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void action.run(() => controller.activate(code))
  }
  return (
    <GateScreen>
      <h1>激活学生端</h1>
      <form className={styles.activation} onSubmit={submit}>
        <Field htmlFor="activation-code" label="激活码">
          <input
            autoFocus
            autoComplete="off"
            id="activation-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Button variant="primary" type="submit" disabled={action.busy || !code.trim()}>
          激活
        </Button>
      </form>
    </GateScreen>
  )
}
