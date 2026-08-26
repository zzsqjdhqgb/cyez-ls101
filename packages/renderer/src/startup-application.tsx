import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { logger } from '@ls101/logger/renderer'
import type { LegacyDataInfo, LicenseStatus } from '@ls101/core-types'
import { App } from './app/App'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import { builtinInterfaceMaintenance } from './features/interfaces/BuiltinInterfaceRuntime'
import { initializeSchemaApplication } from './features/schemas/SchemaApplicationRuntime'
import { LicenseActivationPage } from './features/license/LicenseActivationPage'
import { LegacyDataMigrationPage } from './features/legacy-data/LegacyDataMigrationPage'
import { latestReleaseVersion } from './features/release-notes/release-notes'
import { runStartupPhase } from './startup-phase'
import { waitForStartupCompletionDelay } from './startup-placeholder'
import './app/register-settings'
import './app/register-placeholder-routes'
import './styles/tokens.css'
import './styles/global.css'

type PreparedApplication =
  | { kind: 'license'; status: LicenseStatus }
  | { kind: 'migration'; info: LegacyDataInfo }
  | { kind: 'active'; showReleaseNotes: boolean }

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
  installGlobalErrorLogging()
  void renderApplication(startupLogoAnimation).catch(renderStartupError)
}

async function renderApplication(startupLogoAnimation: Promise<void>): Promise<void> {
  const minimumStartupDuration = startupLogoAnimation.then(waitForStartupCompletionDelay)
  const [prepared] = await Promise.all([prepareApplication(), minimumStartupDuration])
  if (prepared.kind === 'license') {
    renderLicenseActivation(prepared.status)
    return
  }
  if (prepared.kind === 'migration') {
    await completeLegacyDataMigration(prepared.info)
    renderMainApplication(await initializeActiveApplication())
    return
  }
  renderMainApplication(prepared.showReleaseNotes)
}

async function prepareApplication(): Promise<PreparedApplication> {
  const startup = window.startup
  if (!startup) throw new Error('启动服务不可用')
  await runStartupPhase('main-process-readiness', () => startup.whenReady())

  const license = window.license
  if (!license) throw new Error('许可证服务不可用')
  const status = await runStartupPhase('license-status', () => license.getStatus())
  if (status.state !== 'active') return { kind: 'license', status }

  const legacyData = window.legacyData
  if (!legacyData) throw new Error('旧数据整理服务不可用')
  const info = await runStartupPhase('legacy-data-status', () => legacyData.getInfo())
  if (info.status !== 'none' && info.status !== 'cleaned') return { kind: 'migration', info }

  return { kind: 'active', showReleaseNotes: await initializeActiveApplication() }
}

async function initializeActiveApplication(): Promise<boolean> {
  await runStartupPhase('installation-marker', ensureInstallationMarker)
  await initializeApplicationContent()
  return runStartupPhase('release-notes', claimReleaseNotesVersion)
}

function renderMainApplication(showReleaseNotes: boolean): void {
  reactRoot.render(
    <StrictMode>
      <App showReleaseNotesOnStartup={showReleaseNotes} />
    </StrictMode>
  )
}

function renderLicenseActivation(status: LicenseStatus): void {
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
            renderMainApplication(await initializeActiveApplication())
          } catch (error) {
            renderStartupError(error)
          }
        }}
      />
    </StrictMode>
  )
}

async function ensureInstallationMarker(): Promise<void> {
  const appInfo = window.appInfo
  if (!appInfo) throw new Error('应用信息服务不可用')
  await appInfo.ensureInstallationMarker()
}

async function claimReleaseNotesVersion(): Promise<boolean> {
  const appInfo = window.appInfo
  if (!appInfo) throw new Error('应用信息服务不可用')
  return appInfo.claimReleaseNotesVersion(latestReleaseVersion)
}

function completeLegacyDataMigration(initialInfo: LegacyDataInfo): Promise<void> {
  return new Promise((resolve) => {
    reactRoot.render(
      <StrictMode>
        <LegacyDataMigrationPage initialInfo={initialInfo} onComplete={resolve} />
      </StrictMode>
    )
  })
}

async function initializeApplicationContent(): Promise<void> {
  await runStartupPhase('builtin-schemas', initializeSchemaApplication)
  await runStartupPhase('builtin-interfaces', () => builtinInterfaceMaintenance.initialize())
  await runStartupPhase('builtin-templates-and-functions', () => templateApplication.initialize())
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
