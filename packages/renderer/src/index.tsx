import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { App } from './app/App'
import { appIconUrl } from './assets'
import startupLogoMarkup from './startup-assets/logo.svg?raw'
import startupLogoMotionCss from './startup-assets/motion.css?inline'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import { builtinInterfaceMaintenance } from './features/interfaces/BuiltinInterfaceRuntime'
import { initializeSchemaApplication } from './features/schemas/SchemaApplicationRuntime'
import {
  applyStartupLogoMotion,
  applyStartupPlaceholderIcon,
  showStartupProgress,
  waitForStartupLogoAnimation,
  waitForStartupProgressDelay
} from './startup-placeholder'
import './app/register-settings'
import './app/register-placeholder-routes'
import './styles/tokens.css'
import './styles/global.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Renderer root element was not found')
}

applyStartupPlaceholderIcon(root, appIconUrl)
applyStartupLogoMotion(root, {
  logoMarkup: startupLogoMarkup,
  motionCss: startupLogoMotionCss
})
const reactRoot = createRoot(root)
const startupLogoAnimation = waitForStartupLogoAnimation(root)

async function renderApplication(): Promise<void> {
  let initializationSettled = false
  const initializationResult = initializeApplicationContent().then(
    () => {
      initializationSettled = true
      return { status: 'fulfilled' as const }
    },
    (reason: unknown) => {
      initializationSettled = true
      return { status: 'rejected' as const, reason }
    }
  )

  await startupLogoAnimation
  await waitForStartupProgressDelay()

  if (!initializationSettled) showStartupProgress(root)

  const result = await initializationResult
  if (result.status === 'rejected') throw result.reason

  reactRoot.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

async function initializeApplicationContent(): Promise<void> {
  await initializeSchemaApplication()
  await builtinInterfaceMaintenance.initialize()
  await templateApplication.initialize()
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
