import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { logger } from '@ls101/logger/renderer'
import type { LegacyDataInfo, LicenseStatus } from '@ls101/core-types'
import { runStartupPhase } from './startup-phase'
import { waitForStartupCompletionDelay } from './startup-placeholder'
import { enableRendererStartupTimingLogging, markRendererStartupMilestone } from './startup-timing'
import './styles/tokens.css'
import './styles/global.css'

type ActiveApplication = typeof import('./startup-active-application')

type PreparedApplication =
  | { kind: 'license'; status: LicenseStatus }
  | { kind: 'migration'; info: LegacyDataInfo }
  | { kind: 'active'; application: ActiveApplication; showReleaseNotes: boolean }

let reactRoot: Root

export function startApplication(root: HTMLElement, startupLogoAnimation: Promise<void>): void {
  reactRoot = createRoot(root, {
    onUncaughtError: (error, errorInfo) => {
      logger.error('Uncaught React renderer error', error, {
        componentStack: errorInfo.componentStack ?? undefined
      })
    },
    onCaughtError: (error, errorInfo) => {
      logger.error('Caught React renderer error', error, {
        componentStack: errorInfo.componentStack ?? undefined
      })
    },
    onRecoverableError: (error, errorInfo) => {
      logger.warn('Recoverable React renderer error', {
        error: serializeReason(error),
        componentStack: errorInfo.componentStack ?? undefined
      })
    }
  })
  markRendererStartupMilestone('react-root-created')
  installGlobalErrorLogging()
  void renderApplication(startupLogoAnimation).catch(renderStartupError)
}

async function renderApplication(startupLogoAnimation: Promise<void>): Promise<void> {
  const minimumStartupDuration = startupLogoAnimation.then(waitForStartupCompletionDelay)
  const [prepared] = await Promise.all([prepareApplication(), minimumStartupDuration])
  if (prepared.kind === 'license') {
    await renderLicenseActivation(prepared.status)
    return
  }
  if (prepared.kind === 'migration') {
    await completeLegacyDataMigration(prepared.info)
    const application = await loadActiveApplication()
    application.renderActiveApplication(reactRoot, await application.initializeActiveApplication())
    return
  }
  prepared.application.renderActiveApplication(reactRoot, prepared.showReleaseNotes)
}

async function prepareApplication(): Promise<PreparedApplication> {
  const startup = window.startup
  if (!startup) throw new Error('启动服务不可用')
  await runStartupPhase('main-process-readiness', () => startup.whenReady())
  enableRendererStartupTimingLogging()
  markRendererStartupMilestone('main-process-ready')

  const license = window.license
  if (!license) throw new Error('许可证服务不可用')
  const status = await runStartupPhase('license-status', () => license.getStatus())
  if (status.state !== 'active') return { kind: 'license', status }

  const legacyData = window.legacyData
  if (!legacyData) throw new Error('旧数据整理服务不可用')
  const info = await runStartupPhase('legacy-data-status', () => legacyData.getInfo())
  if (info.status !== 'none' && info.status !== 'cleaned') return { kind: 'migration', info }

  const application = await loadActiveApplication()
  return {
    kind: 'active',
    application,
    showReleaseNotes: await application.initializeActiveApplication()
  }
}

async function renderLicenseActivation(status: LicenseStatus): Promise<void> {
  const { LicenseActivationPage } = await import('./features/license/LicenseActivationPage')
  markRendererStartupMilestone('license-interface-render-requested')
  reactRoot.render(
    <StrictMode>
      <LicenseActivationPage
        initialStatus={status}
        onActivated={async () => {
          try {
            const legacyData = window.legacyData
            if (!legacyData) throw new Error('旧数据整理服务不可用')
            const info = await legacyData.getInfo()
            if (info.status !== 'none' && info.status !== 'cleaned') {
              await completeLegacyDataMigration(info)
            }
            const application = await loadActiveApplication()
            application.renderActiveApplication(
              reactRoot,
              await application.initializeActiveApplication()
            )
          } catch (error) {
            renderStartupError(error)
          }
        }}
      />
    </StrictMode>
  )
}

async function completeLegacyDataMigration(initialInfo: LegacyDataInfo): Promise<void> {
  const { LegacyDataMigrationPage } = await import('./features/legacy-data/LegacyDataMigrationPage')
  markRendererStartupMilestone('migration-interface-render-requested')
  return new Promise((resolve) => {
    reactRoot.render(
      <StrictMode>
        <LegacyDataMigrationPage initialInfo={initialInfo} onComplete={resolve} />
      </StrictMode>
    )
  })
}

function loadActiveApplication(): Promise<ActiveApplication> {
  return import('./startup-active-application')
}

function renderStartupError(reason: unknown): void {
  logger.error('Renderer application initialization failed', reason)
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

function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    logger.error('Unhandled renderer error', event.error, {
      filename: event.filename,
      lineNumber: event.lineno,
      columnNumber: event.colno,
      url: window.location.href
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled renderer promise rejection', event.reason, {
      url: window.location.href
    })
  })
}

function serializeReason(reason: unknown): string {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
}
