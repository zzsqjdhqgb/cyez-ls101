import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import './app/register-settings'
import './app/register-placeholder-routes'
import './styles/tokens.css'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

async function renderApplication(): Promise<void> {
  await templateApplication.initialize()
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void renderApplication()
