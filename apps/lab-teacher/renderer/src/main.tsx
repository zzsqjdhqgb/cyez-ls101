import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@ls101/desktop-ui/styles.css'
import { App } from './app/App'

export function startApplication(root: HTMLElement): void {
  createRoot(root, {
    onUncaughtError: (error) => console.error('[lab-teacher] uncaught renderer error', error),
    onCaughtError: (error) => console.error('[lab-teacher] caught renderer error', error),
    onRecoverableError: (error) => console.warn('[lab-teacher] recoverable renderer error', error)
  }).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
