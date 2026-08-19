import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { App } from './app/App'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import { builtinInterfaceMaintenance } from './features/interfaces/BuiltinInterfaceRuntime'
import { initializeSchemaApplication } from './features/schemas/SchemaApplicationRuntime'
import './app/register-settings'
import './app/register-placeholder-routes'
import './styles/tokens.css'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

const reactRoot = createRoot(root)

async function renderApplication(): Promise<void> {
  await initializeSchemaApplication()
  await builtinInterfaceMaintenance.initialize()
  await templateApplication.initialize()
  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

function renderStartupError(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : '未知初始化错误'
  reactRoot.render(
    <main className="startupError" role="alert">
      <AlertCircle aria-hidden="true" />
      <h1>应用初始化失败</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" />
        重新加载
      </button>
    </main>
  )
}

void renderApplication().catch(renderStartupError)
